from decimal import Decimal
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case

from app.models.device import Device, DeviceStatus
from app.models.part import Part
from app.models.refurb_job import RefurbJob, JobStatus, JobOutcome
from app.models.sale import Sale, SaleType
from app.models.return_rma import ReturnRMA, RestockOutcome
from app.models.user import User
from app.schemas.reports import (
    ReconciliationReport,
    InventoryValuationReport,
    InventoryValuationItem,
    WIPValueReport,
    EngineerPerformanceReport,
    EngineerPerformanceItem,
    SalesSummaryReport,
    ReturnsAnalysisReport,
    ReturnsAnalysisItem,
    LowStockReport,
    LowStockAlert,
    YieldConversionReport,
)


async def get_reconciliation(db: AsyncSession) -> ReconciliationReport:
    counts = {}
    for status in DeviceStatus:
        result = await db.execute(
            select(func.count(Device.id)).where(Device.status == status)
        )
        counts[status] = result.scalar() or 0

    total_received = sum(counts.values())
    sellable = counts.get(DeviceStatus.SELLABLE, 0)
    in_refurb = counts.get(DeviceStatus.IN_REFURB, 0)
    sent_external = counts.get(DeviceStatus.SENT_EXTERNAL, 0)
    scrapped = counts.get(DeviceStatus.SCRAPPED, 0)
    sold = counts.get(DeviceStatus.SOLD, 0)
    reserved = counts.get(DeviceStatus.RESERVED, 0)
    returned = counts.get(DeviceStatus.RETURNED, 0)
    awaiting = counts.get(DeviceStatus.AWAITING_REFURB, 0)

    # Reconciliation formula
    accounted = sellable + in_refurb + sent_external + scrapped + sold + reserved + returned + awaiting
    discrepancy = total_received - accounted

    return ReconciliationReport(
        total_received=total_received,
        sellable=sellable,
        in_refurb=in_refurb + awaiting,
        sent_external=sent_external,
        scrapped=scrapped,
        sold=sold,
        returned_to_stock=0,
        reserved=reserved,
        returned=returned,
        reconciled=(discrepancy == 0),
        discrepancy=discrepancy,
    )


async def get_inventory_valuation(db: AsyncSession) -> InventoryValuationReport:
    result = await db.execute(
        select(Device).where(
            Device.status.in_([
                DeviceStatus.AWAITING_REFURB,
                DeviceStatus.IN_REFURB,
                DeviceStatus.SENT_EXTERNAL,
                DeviceStatus.SELLABLE,
                DeviceStatus.RESERVED,
            ])
        )
    )
    devices = result.scalars().all()

    items = []
    total_value = Decimal("0.00")
    for d in devices:
        tc = d.total_cost
        total_value += tc
        items.append(
            InventoryValuationItem(
                device_id=d.id,
                imei=d.imei,
                model=d.model_id,
                grade=d.grade.value,
                status=d.status.value,
                total_cost=tc,
            )
        )

    return InventoryValuationReport(items=items, total_value=total_value, count=len(items))


async def get_wip_value(db: AsyncSession) -> WIPValueReport:
    result = await db.execute(
        select(Device).where(
            Device.status.in_([DeviceStatus.IN_REFURB, DeviceStatus.SENT_EXTERNAL, DeviceStatus.AWAITING_REFURB])
        )
    )
    devices = result.scalars().all()
    total = sum(d.total_cost for d in devices)
    count = len(devices)
    avg = total / count if count else Decimal("0.00")
    return WIPValueReport(total_wip_value=total, device_count=count, avg_cost_per_device=avg)


async def get_engineer_performance(db: AsyncSession) -> EngineerPerformanceReport:
    result = await db.execute(
        select(User).where(User.role == "ENGINEER")
    )
    engineers = result.scalars().all()

    items = []
    for eng in engineers:
        jobs_result = await db.execute(
            select(RefurbJob).where(
                RefurbJob.assigned_engineer_id == eng.id,
                RefurbJob.status == JobStatus.CLOSED,
            )
        )
        jobs = jobs_result.scalars().all()

        turnarounds = []
        regraded = scrapped = sent_external = 0
        for j in jobs:
            if j.date_closed and j.date_opened:
                delta = (j.date_closed - j.date_opened).days
                turnarounds.append(delta)
            if j.outcome == JobOutcome.REGRADED:
                regraded += 1
            elif j.outcome == JobOutcome.SCRAPPED:
                scrapped += 1
            elif j.outcome == JobOutcome.SENT_EXTERNAL:
                sent_external += 1

        avg_turnaround = sum(turnarounds) / len(turnarounds) if turnarounds else None

        items.append(
            EngineerPerformanceItem(
                engineer_id=eng.id,
                engineer_name=eng.name,
                jobs_completed=len(jobs),
                avg_turnaround_days=avg_turnaround,
                devices_regraded=regraded,
                devices_scrapped=scrapped,
                devices_sent_external=sent_external,
            )
        )

    return EngineerPerformanceReport(engineers=items)


async def get_sales_summary(
    db: AsyncSession,
    period_start: Optional[str] = None,
    period_end: Optional[str] = None,
) -> SalesSummaryReport:
    query = select(Sale)
    result = await db.execute(query)
    sales = result.scalars().all()

    total_invoices = len(sales)
    total_revenue = sum(s.total for s in sales)
    total_tax = sum(s.tax for s in sales)
    total_paid = sum(s.amount_paid for s in sales)
    outstanding = sum(s.balance for s in sales)
    wholesale_rev = sum(s.total for s in sales if s.type == SaleType.WHOLESALE)
    retail_rev = sum(s.total for s in sales if s.type == SaleType.RETAIL)

    return SalesSummaryReport(
        period_start=period_start,
        period_end=period_end,
        total_invoices=total_invoices,
        total_revenue=total_revenue,
        total_tax=total_tax,
        total_paid=total_paid,
        outstanding_balance=outstanding,
        wholesale_revenue=wholesale_rev,
        retail_revenue=retail_rev,
    )


async def get_returns_analysis(db: AsyncSession) -> ReturnsAnalysisReport:
    result = await db.execute(select(ReturnRMA))
    returns = result.scalars().all()

    by_reason: dict = {}
    for r in returns:
        key = r.reason_code.value
        if key not in by_reason:
            by_reason[key] = {"count": 0, "refund_total": Decimal("0.00")}
        by_reason[key]["count"] += 1
        by_reason[key]["refund_total"] += r.refund_amount or Decimal("0.00")

    items = [
        ReturnsAnalysisItem(
            reason_code=k,
            count=v["count"],
            refund_total=v["refund_total"],
        )
        for k, v in by_reason.items()
    ]
    total_refunded = sum(r.refund_amount or Decimal("0.00") for r in returns)

    return ReturnsAnalysisReport(
        total_returns=len(returns),
        items=items,
        total_refunded=total_refunded,
    )


async def get_low_stock_alerts(db: AsyncSession) -> LowStockReport:
    result = await db.execute(
        select(Part).where(Part.quantity_on_hand <= Part.min_stock_level)
    )
    parts = result.scalars().all()

    alerts = [
        LowStockAlert(
            part_id=p.id,
            name=p.name,
            sku=p.sku,
            quantity_on_hand=p.quantity_on_hand,
            min_stock_level=p.min_stock_level,
            shortfall=p.min_stock_level - p.quantity_on_hand,
        )
        for p in parts
    ]
    return LowStockReport(alerts=alerts, total_alerts=len(alerts))


async def get_yield_conversion(db: AsyncSession) -> YieldConversionReport:
    total_result = await db.execute(select(func.count(Device.id)))
    total = total_result.scalar() or 0

    sellable_result = await db.execute(
        select(func.count(Device.id)).where(Device.status == DeviceStatus.SELLABLE)
    )
    sellable = sellable_result.scalar() or 0

    scrapped_result = await db.execute(
        select(func.count(Device.id)).where(Device.status == DeviceStatus.SCRAPPED)
    )
    scrapped = scrapped_result.scalar() or 0

    required_refurb = total - sellable - scrapped
    yield_rate = (sellable / total * 100) if total else 0.0
    scrap_rate = (scrapped / total * 100) if total else 0.0

    return YieldConversionReport(
        total_received=total,
        directly_sellable=sellable,
        required_refurb=max(0, required_refurb),
        scrapped=scrapped,
        yield_rate_percent=round(yield_rate, 2),
        scrap_rate_percent=round(scrap_rate, 2),
    )
