from datetime import date as date_type, datetime
from decimal import Decimal
from typing import Optional, Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.orm import selectinload

from app.models.device import Device, DeviceStatus
from app.models.expense import Expense
from app.models.part import Part
from app.models.purchase_order import PurchaseOrder, POLineItem, POLineType
from app.models.refurb_job import RefurbJob, RefurbJobPart, JobStatus, JobOutcome
from app.models.sale import Sale, SaleType, PaymentStatus
from app.models.return_rma import ReturnRMA, RestockOutcome
from app.models.user import User
from app.schemas.expense import ExpensesSummaryReport, ExpenseSummaryItem
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


# ── Existing reports (unchanged) ─────────────────────────────────────────────

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
    result = await db.execute(select(User).where(User.role == "ENGINEER"))
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


async def get_expenses_summary(
    db: AsyncSession,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
) -> ExpensesSummaryReport:
    q = select(Expense)
    if date_from:
        q = q.where(Expense.date >= date_from)
    if date_to:
        q = q.where(Expense.date <= date_to)
    result = await db.execute(q)
    expenses = result.scalars().all()

    totals_by_title: dict[str, dict] = {}
    for e in expenses:
        key = e.title
        if key not in totals_by_title:
            totals_by_title[key] = {"count": 0, "total": Decimal("0.00")}
        totals_by_title[key]["count"] += 1
        totals_by_title[key]["total"] += e.amount

    items = [
        ExpenseSummaryItem(title=k, count=v["count"], total=v["total"])
        for k, v in sorted(totals_by_title.items(), key=lambda x: x[1]["total"], reverse=True)
    ]
    grand_total = sum(e.amount for e in expenses)

    return ExpensesSummaryReport(
        period_start=date_from.isoformat() if date_from else None,
        period_end=date_to.isoformat() if date_to else None,
        total_expenses=grand_total if expenses else Decimal("0.00"),
        expense_count=len(expenses),
        items=items,
    )


# ── New reports ───────────────────────────────────────────────────────────────

async def get_inventory_report(
    db: AsyncSession,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
    status_filter: Optional[str] = None,
    grade_filter: Optional[str] = None,
) -> dict:
    q = select(Device)
    if date_from:
        q = q.where(Device.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.where(Device.created_at <= datetime.combine(date_to, datetime.max.time()))
    if status_filter:
        q = q.where(Device.status == status_filter)
    if grade_filter:
        q = q.where(Device.grade == grade_filter)

    result = await db.execute(q)
    devices = result.scalars().all()

    by_status: dict[str, int] = {}
    by_grade: dict[str, int] = {}
    for d in devices:
        s = d.status.value
        g = d.grade.value
        by_status[s] = by_status.get(s, 0) + 1
        by_grade[g] = by_grade.get(g, 0) + 1

    return {
        "total": len(devices),
        "sellable": by_status.get("SELLABLE", 0),
        "awaiting_refurb": by_status.get("AWAITING_REFURB", 0),
        "in_refurb": by_status.get("IN_REFURB", 0),
        "sent_external": by_status.get("SENT_EXTERNAL", 0),
        "scrapped": by_status.get("SCRAPPED", 0),
        "reserved": by_status.get("RESERVED", 0),
        "sold": by_status.get("SOLD", 0),
        "returned": by_status.get("RETURNED", 0),
        "by_status": [{"status": k, "count": v} for k, v in sorted(by_status.items())],
        "by_grade": [{"grade": k, "count": v} for k, v in sorted(by_grade.items())],
    }


async def get_purchase_report(
    db: AsyncSession,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
    supplier_id: Optional[str] = None,
) -> dict:
    q = (
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.line_items), selectinload(PurchaseOrder.supplier))
        .order_by(PurchaseOrder.date.desc())
    )
    if date_from:
        q = q.where(PurchaseOrder.date >= date_from)
    if date_to:
        q = q.where(PurchaseOrder.date <= date_to)
    if supplier_id:
        q = q.where(PurchaseOrder.supplier_id == supplier_id)

    result = await db.execute(q)
    orders = result.scalars().all()

    total_phones = 0
    total_value = Decimal("0.00")
    by_supplier: dict[str, dict] = {}

    history = []
    for po in orders:
        po_devices = sum(li.quantity for li in po.line_items if li.line_type == POLineType.DEVICE)
        po_value = po.shipping_cost + sum(li.unit_cost * li.quantity for li in po.line_items)
        total_phones += po_devices
        total_value += po_value
        sup_name = po.supplier.name if po.supplier else "Unknown"
        if sup_name not in by_supplier:
            by_supplier[sup_name] = {"po_count": 0, "total_value": Decimal("0.00"), "phone_count": 0}
        by_supplier[sup_name]["po_count"] += 1
        by_supplier[sup_name]["total_value"] += po_value
        by_supplier[sup_name]["phone_count"] += po_devices
        history.append({
            "po_number": po.po_number,
            "supplier": sup_name,
            "date": po.date.isoformat(),
            "status": po.status.value,
            "phones": po_devices,
            "value": str(po_value),
        })

    return {
        "total_pos": len(orders),
        "total_phones_purchased": total_phones,
        "total_purchase_value": str(total_value),
        "by_supplier": [
            {"supplier": k, "po_count": v["po_count"], "phone_count": v["phone_count"], "total_value": str(v["total_value"])}
            for k, v in sorted(by_supplier.items(), key=lambda x: x[1]["total_value"], reverse=True)
        ],
        "history": history,
    }


async def get_sales_detail_report(
    db: AsyncSession,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
    user_id: Optional[str] = None,
) -> dict:
    q = select(Sale).options(selectinload(Sale.customer))
    if date_from:
        q = q.where(Sale.date >= date_from)
    if date_to:
        q = q.where(Sale.date <= date_to)
    if user_id:
        q = q.where(Sale.created_by_user_id == user_id)
    q = q.order_by(Sale.date.desc())
    result = await db.execute(q)
    sales = result.scalars().all()

    total_revenue = sum(s.total for s in sales)
    total_paid = sum(s.amount_paid for s in sales)
    outstanding = sum(s.balance for s in sales)

    by_customer: dict[str, dict] = {}
    by_salesperson: dict[str, dict] = {}
    by_status: dict[str, int] = {}

    for s in sales:
        cname = s.customer.name if s.customer else "Unknown"
        if cname not in by_customer:
            by_customer[cname] = {"count": 0, "total": Decimal("0.00"), "balance": Decimal("0.00")}
        by_customer[cname]["count"] += 1
        by_customer[cname]["total"] += s.total
        by_customer[cname]["balance"] += s.balance

        sp = s.salesperson_name or "Unassigned"
        if sp not in by_salesperson:
            by_salesperson[sp] = {"count": 0, "total": Decimal("0.00")}
        by_salesperson[sp]["count"] += 1
        by_salesperson[sp]["total"] += s.total

        ps = s.payment_status.value
        by_status[ps] = by_status.get(ps, 0) + 1

    history = [
        {
            "invoice_number": s.invoice_number,
            "date": s.date.isoformat(),
            "customer": s.customer.name if s.customer else "",
            "salesperson": s.salesperson_name or "",
            "type": s.type.value,
            "total": str(s.total),
            "amount_paid": str(s.amount_paid),
            "balance": str(s.balance),
            "payment_status": s.payment_status.value,
        }
        for s in sales
    ]

    return {
        "total_invoices": len(sales),
        "total_revenue": str(total_revenue),
        "total_paid": str(total_paid),
        "outstanding_balance": str(outstanding),
        "by_payment_status": [{"status": k, "count": v} for k, v in by_status.items()],
        "by_customer": [
            {"customer": k, "count": v["count"], "total": str(v["total"]), "balance": str(v["balance"])}
            for k, v in sorted(by_customer.items(), key=lambda x: x[1]["total"], reverse=True)
        ],
        "by_salesperson": [
            {"salesperson": k, "count": v["count"], "total": str(v["total"])}
            for k, v in sorted(by_salesperson.items(), key=lambda x: x[1]["total"], reverse=True)
        ],
        "history": history,
    }


async def get_refurb_report(
    db: AsyncSession,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
    engineer_id: Optional[str] = None,
) -> dict:
    q = (
        select(RefurbJob)
        .options(selectinload(RefurbJob.parts_used).selectinload(RefurbJobPart.part),
                 selectinload(RefurbJob.assigned_engineer))
    )
    if date_from:
        q = q.where(RefurbJob.date_opened >= date_from)
    if date_to:
        q = q.where(RefurbJob.date_opened <= date_to)
    if engineer_id:
        q = q.where(RefurbJob.assigned_engineer_id == engineer_id)
    q = q.order_by(RefurbJob.date_opened.desc())
    result = await db.execute(q)
    jobs = result.scalars().all()

    open_count = sum(1 for j in jobs if j.status.value == "open")
    in_progress = sum(1 for j in jobs if j.status.value == "in_progress")
    closed_count = sum(1 for j in jobs if j.status.value == "closed")
    regraded = sum(1 for j in jobs if j.outcome == JobOutcome.REGRADED)
    sent_external = sum(1 for j in jobs if j.outcome == JobOutcome.SENT_EXTERNAL)
    scrapped = sum(1 for j in jobs if j.outcome == JobOutcome.SCRAPPED)

    total_parts_cost = Decimal("0.00")
    total_external_cost = Decimal("0.00")
    parts_consumed: dict[str, dict] = {}
    turnarounds = []

    for j in jobs:
        total_external_cost += j.external_cost or Decimal("0.00")
        if j.date_closed and j.date_opened:
            turnarounds.append((j.date_closed - j.date_opened).days)
        for p in j.parts_used:
            cost = p.unit_cost_at_time * p.quantity
            total_parts_cost += cost
            pname = p.part.name if p.part else "Unknown"
            if pname not in parts_consumed:
                parts_consumed[pname] = {"qty": 0, "cost": Decimal("0.00")}
            parts_consumed[pname]["qty"] += p.quantity
            parts_consumed[pname]["cost"] += cost

    avg_turnaround = round(sum(turnarounds) / len(turnarounds), 1) if turnarounds else None

    history = [
        {
            "job_number": j.job_number,
            "date_opened": j.date_opened.isoformat(),
            "date_closed": j.date_closed.isoformat() if j.date_closed else None,
            "status": j.status.value,
            "outcome": j.outcome.value if j.outcome else None,
            "engineer": j.assigned_engineer.name if j.assigned_engineer else "Unassigned",
            "external_cost": str(j.external_cost),
        }
        for j in jobs
    ]

    return {
        "total_jobs": len(jobs),
        "open": open_count,
        "in_progress": in_progress,
        "closed": closed_count,
        "regraded": regraded,
        "sent_external": sent_external,
        "scrapped": scrapped,
        "total_parts_cost": str(total_parts_cost),
        "total_external_cost": str(total_external_cost),
        "avg_turnaround_days": avg_turnaround,
        "parts_consumed": [
            {"name": k, "qty": v["qty"], "cost": str(v["cost"])}
            for k, v in sorted(parts_consumed.items(), key=lambda x: x[1]["cost"], reverse=True)
        ],
        "history": history,
    }


async def get_returns_detail_report(
    db: AsyncSession,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
) -> dict:
    q = select(ReturnRMA).options(selectinload(ReturnRMA.customer), selectinload(ReturnRMA.device))
    if date_from:
        q = q.where(ReturnRMA.date >= date_from)
    if date_to:
        q = q.where(ReturnRMA.date <= date_to)
    q = q.order_by(ReturnRMA.date.desc())
    result = await db.execute(q)
    returns = result.scalars().all()

    total_refunded = sum(r.refund_amount or Decimal("0.00") for r in returns)
    repaired = sum(1 for r in returns if r.resolution and r.resolution.value == "repair_and_return")
    restocked = sum(1 for r in returns if r.restock_outcome and r.restock_outcome.value == "sellable")
    scrapped = sum(1 for r in returns if r.restock_outcome and r.restock_outcome.value == "scrapped")

    by_customer: dict[str, dict] = {}
    by_reason: dict[str, int] = {}
    for r in returns:
        cname = r.customer.name if r.customer else "Unknown"
        if cname not in by_customer:
            by_customer[cname] = {"count": 0, "refunded": Decimal("0.00")}
        by_customer[cname]["count"] += 1
        by_customer[cname]["refunded"] += r.refund_amount or Decimal("0.00")

        reason = r.reason_code.value
        by_reason[reason] = by_reason.get(reason, 0) + 1

    history = [
        {
            "rma_number": r.rma_number,
            "date": r.date.isoformat(),
            "customer": r.customer.name if r.customer else "",
            "device_imei": r.device.imei if r.device else "",
            "reason": r.reason_code.value,
            "resolution": r.resolution.value if r.resolution else "",
            "refund_amount": str(r.refund_amount or Decimal("0.00")),
            "restock_outcome": r.restock_outcome.value if r.restock_outcome else "",
        }
        for r in returns
    ]

    return {
        "total_returns": len(returns),
        "total_refunded": str(total_refunded),
        "repaired_and_returned": repaired,
        "restocked": restocked,
        "scrapped_after_return": scrapped,
        "by_reason": [{"reason": k, "count": v} for k, v in sorted(by_reason.items(), key=lambda x: x[1], reverse=True)],
        "by_customer": [
            {"customer": k, "count": v["count"], "refunded": str(v["refunded"])}
            for k, v in sorted(by_customer.items(), key=lambda x: x[1]["count"], reverse=True)
        ],
        "history": history,
    }


async def get_operations_summary(
    db: AsyncSession,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
) -> dict:
    # Sales
    sq = select(Sale)
    if date_from:
        sq = sq.where(Sale.date >= date_from)
    if date_to:
        sq = sq.where(Sale.date <= date_to)
    sales_res = await db.execute(sq)
    sales = sales_res.scalars().all()
    total_revenue = sum(s.total for s in sales)
    total_received = sum(s.amount_paid for s in sales)
    outstanding_bal = sum(s.balance for s in sales)

    # Purchases
    pq = select(PurchaseOrder).options(selectinload(PurchaseOrder.line_items))
    if date_from:
        pq = pq.where(PurchaseOrder.date >= date_from)
    if date_to:
        pq = pq.where(PurchaseOrder.date <= date_to)
    po_res = await db.execute(pq)
    pos = po_res.scalars().all()
    stock_purchased = sum(
        po.shipping_cost + sum(li.unit_cost * li.quantity for li in po.line_items)
        for po in pos
    )

    # Refurb costs
    rq = select(RefurbJob).options(selectinload(RefurbJob.parts_used))
    if date_from:
        rq = rq.where(RefurbJob.date_opened >= date_from)
    if date_to:
        rq = rq.where(RefurbJob.date_opened <= date_to)
    rj_res = await db.execute(rq)
    jobs = rj_res.scalars().all()
    parts_cost = sum(
        p.unit_cost_at_time * p.quantity
        for j in jobs for p in j.parts_used
    )
    external_cost = sum(j.external_cost or Decimal("0.00") for j in jobs)

    # Expenses
    eq = select(func.sum(Expense.amount))
    if date_from:
        eq = eq.where(Expense.date >= date_from)
    if date_to:
        eq = eq.where(Expense.date <= date_to)
    exp_res = await db.execute(eq)
    warehouse_expenses = exp_res.scalar() or Decimal("0.00")

    # Refunds
    ret_q = select(func.sum(ReturnRMA.refund_amount))
    if date_from:
        ret_q = ret_q.where(ReturnRMA.date >= date_from)
    if date_to:
        ret_q = ret_q.where(ReturnRMA.date <= date_to)
    ret_res = await db.execute(ret_q)
    refunds_issued = ret_res.scalar() or Decimal("0.00")

    # Current inventory snapshot (no date filter — current state)
    inv_res = await db.execute(
        select(Device).where(Device.status.in_([DeviceStatus.SELLABLE, DeviceStatus.RESERVED]))
    )
    in_stock_devices = inv_res.scalars().all()
    stock_value = sum(d.total_cost for d in in_stock_devices)

    refurb_res = await db.execute(
        select(func.count(Device.id)).where(
            Device.status.in_([DeviceStatus.IN_REFURB, DeviceStatus.AWAITING_REFURB, DeviceStatus.SENT_EXTERNAL])
        )
    )
    in_refurb_count = refurb_res.scalar() or 0

    sold_res = await db.execute(select(func.count(Device.id)).where(Device.status == DeviceStatus.SOLD))
    sold_count = sold_res.scalar() or 0

    returned_res = await db.execute(select(func.count(Device.id)).where(Device.status == DeviceStatus.RETURNED))
    returned_count = returned_res.scalar() or 0

    total_money_out = stock_purchased + parts_cost + external_cost + warehouse_expenses + refunds_issued
    gross_profit = total_revenue - stock_purchased - parts_cost - external_cost
    net_profit = gross_profit - warehouse_expenses - refunds_issued

    return {
        "money_in": {
            "total_sales": str(total_revenue),
            "total_payments_received": str(total_received),
        },
        "money_out": {
            "stock_purchased": str(stock_purchased),
            "parts_cost": str(parts_cost),
            "external_repair_cost": str(external_cost),
            "warehouse_expenses": str(warehouse_expenses),
            "refunds_issued": str(refunds_issued),
            "total": str(total_money_out),
        },
        "inventory": {
            "stock_value": str(stock_value),
            "phones_in_stock": len(in_stock_devices),
            "phones_in_refurb": in_refurb_count,
            "phones_sold": sold_count,
            "phones_returned": returned_count,
        },
        "financial": {
            "estimated_gross_profit": str(gross_profit),
            "estimated_net_profit": str(net_profit),
            "outstanding_customer_balances": str(outstanding_bal),
        },
    }


async def get_my_sales_dashboard(
    db: AsyncSession,
    user_id: str,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
) -> dict:
    from datetime import date as dt_date
    today = dt_date.today()

    async def _count_sales(d_from: dt_date, d_to: dt_date):
        q = select(Sale).where(
            Sale.created_by_user_id == user_id,
            Sale.date >= d_from,
            Sale.date <= d_to,
        )
        r = await db.execute(q)
        ss = r.scalars().all()
        return len(ss), sum(s.total for s in ss), sum(s.amount_paid for s in ss), sum(s.balance for s in ss)

    from datetime import timedelta
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)

    today_count, today_value, _, _ = await _count_sales(today, today)
    week_count, week_value, _, _ = await _count_sales(week_start, today)
    month_count, month_value, _, _ = await _count_sales(month_start, today)

    # All-time for this user (filtered if given)
    q = select(Sale).options(selectinload(Sale.customer)).where(Sale.created_by_user_id == user_id)
    if date_from:
        q = q.where(Sale.date >= date_from)
    if date_to:
        q = q.where(Sale.date <= date_to)
    q = q.order_by(Sale.date.desc())
    res = await db.execute(q)
    all_sales = res.scalars().all()

    pending = [s for s in all_sales if s.payment_status.value in ("unpaid", "partial", "on_account")]

    return {
        "today": {"count": today_count, "value": str(today_value)},
        "this_week": {"count": week_count, "value": str(week_value)},
        "this_month": {"count": month_count, "value": str(month_value)},
        "total_invoices": len(all_sales),
        "total_value": str(sum(s.total for s in all_sales)),
        "total_paid": str(sum(s.amount_paid for s in all_sales)),
        "outstanding_balance": str(sum(s.balance for s in all_sales)),
        "pending_invoices": len(pending),
        "history": [
            {
                "invoice_number": s.invoice_number,
                "date": s.date.isoformat(),
                "customer": s.customer.name if s.customer else "",
                "total": str(s.total),
                "amount_paid": str(s.amount_paid),
                "balance": str(s.balance),
                "payment_status": s.payment_status.value,
            }
            for s in all_sales
        ],
    }


async def get_my_refurb_dashboard(
    db: AsyncSession,
    user_id: str,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
) -> dict:
    q = (
        select(RefurbJob)
        .options(selectinload(RefurbJob.parts_used).selectinload(RefurbJobPart.part))
        .where(RefurbJob.assigned_engineer_id == user_id)
    )
    if date_from:
        q = q.where(RefurbJob.date_opened >= date_from)
    if date_to:
        q = q.where(RefurbJob.date_opened <= date_to)
    q = q.order_by(RefurbJob.date_opened.desc())
    result = await db.execute(q)
    jobs = result.scalars().all()

    open_count = sum(1 for j in jobs if j.status.value == "open")
    in_progress = sum(1 for j in jobs if j.status.value == "in_progress")
    closed_count = sum(1 for j in jobs if j.status.value == "closed")
    regraded = sum(1 for j in jobs if j.outcome == JobOutcome.REGRADED)
    sent_external = sum(1 for j in jobs if j.outcome == JobOutcome.SENT_EXTERNAL)
    scrapped = sum(1 for j in jobs if j.outcome == JobOutcome.SCRAPPED)

    parts_consumed: dict[str, int] = {}
    total_parts_cost = Decimal("0.00")
    turnarounds = []
    for j in jobs:
        if j.date_closed and j.date_opened:
            turnarounds.append((j.date_closed - j.date_opened).days)
        for p in j.parts_used:
            pname = p.part.name if p.part else "Unknown"
            parts_consumed[pname] = parts_consumed.get(pname, 0) + p.quantity
            total_parts_cost += p.unit_cost_at_time * p.quantity

    avg_turnaround = round(sum(turnarounds) / len(turnarounds), 1) if turnarounds else None

    return {
        "total_jobs": len(jobs),
        "open": open_count,
        "in_progress": in_progress,
        "closed": closed_count,
        "regraded": regraded,
        "sent_external": sent_external,
        "scrapped": scrapped,
        "avg_turnaround_days": avg_turnaround,
        "total_parts_cost": str(total_parts_cost),
        "parts_consumed": [{"name": k, "qty": v} for k, v in sorted(parts_consumed.items(), key=lambda x: x[1], reverse=True)],
        "history": [
            {
                "job_number": j.job_number,
                "date_opened": j.date_opened.isoformat(),
                "date_closed": j.date_closed.isoformat() if j.date_closed else None,
                "status": j.status.value,
                "outcome": j.outcome.value if j.outcome else None,
            }
            for j in jobs
        ],
    }
