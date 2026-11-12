"""Per-owner stock and accounts (House + investors), plus the combined view.

See app/services/owner_alloc.py for the rules. In short: invoice money is split
by owner; delivery fees, tax and all expenses are House's; refunds belong to
the returned phone's owner; parts used across owners are settled immediately
(revenue for the supplier, expense for the phone's owner) so no one owes anyone.
The combined column uses the same definitions as the CEO dashboard.
"""
from collections import defaultdict
from datetime import date as date_type
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.device import Device, DeviceStatus
from app.models.expense import Expense
from app.models.part import Part
from app.models.refurb_job import RefurbJob
from app.models.return_rma import ReturnRMA
from app.models.sale import Sale, SaleLineItem
from app.models.stock_owner import StockOwner, OwnerCharge, get_house_owner_id
from app.services.owner_alloc import (
    Z, q2, owner_sales, charges_by_device, inter_owner_parts,
)

SELLABLE = {DeviceStatus.SELLABLE, DeviceStatus.RESERVED}
IN_REFURB = {
    DeviceStatus.AWAITING_REFURB, DeviceStatus.IN_REFURB, DeviceStatus.AWAITING_QC,
    DeviceStatus.FAILED_QC, DeviceStatus.SENT_EXTERNAL,
}
OTHER_HELD = {DeviceStatus.RETURNED, DeviceStatus.STOCK_TO_RETURN}


def _blank() -> dict:
    return {
        "phones_sellable": 0, "phones_sellable_value": Z,
        "phones_in_refurb": 0, "phones_in_refurb_value": Z,
        "phones_other": 0, "phones_other_value": Z,
        "parts_units": 0, "parts_value": Z,
        "phones_sold": 0, "phone_revenue": Z, "phone_cost": Z,
        "parts_sold": 0, "parts_revenue": Z, "parts_cost": Z,
        "parts_to_owners_revenue": Z, "parts_to_owners_cost": Z,
        "delivery_and_tax": Z, "refunds": Z,
        "parts_from_owners_expense": Z, "expenses": Z,
        "invoiced": Z, "collected": Z, "owed_by_customers": Z,
    }


def _finish(a: dict) -> dict:
    revenue = a["phone_revenue"] + a["parts_revenue"] + a["parts_to_owners_revenue"] + a["delivery_and_tax"]
    cost = a["phone_cost"] + a["parts_cost"] + a["parts_to_owners_cost"]
    gross = revenue - cost
    net = gross - a["refunds"] - a["parts_from_owners_expense"] - a["expenses"]
    out = {k: (str(q2(v)) if isinstance(v, Decimal) else v) for k, v in a.items()}
    phones_value = a["phones_sellable_value"] + a["phones_in_refurb_value"] + a["phones_other_value"]
    out.update({
        "phones_in_stock": a["phones_sellable"] + a["phones_in_refurb"] + a["phones_other"],
        "phones_in_stock_value": str(q2(phones_value)),
        "stock_value": str(q2(phones_value + a["parts_value"])),
        "revenue": str(q2(revenue)), "cost_of_sales": str(q2(cost)),
        "gross_profit": str(q2(gross)), "net_profit": str(q2(net)),
    })
    return out


async def _stock(db: AsyncSession, house_id: str) -> tuple[dict, dict]:
    """Stock on hand now, per owner (owner cost) and combined (full cost)."""
    per: dict[str, dict] = defaultdict(_blank)
    comb = _blank()
    customer_repair_ids = set((await db.execute(
        select(RefurbJob.device_id).where(RefurbJob.customer_repair.is_(True), RefurbJob.status != "closed")
    )).scalars().all())
    devices = [d for d in (await db.execute(
        select(Device).where(Device.status.in_(SELLABLE | IN_REFURB | OTHER_HELD))
    )).scalars().all() if d.id not in customer_repair_ids]   # a customer's phone is not our stock
    charged = await charges_by_device(db, [d.id for d in devices])
    for d in devices:
        key = "phones_sellable" if d.status in SELLABLE else "phones_in_refurb" if d.status in IN_REFURB else "phones_other"
        for a, value in ((per[d.owner_id or house_id], d.total_cost - charged.get(d.id, Z)), (comb, d.total_cost)):
            a[key] += 1
            a[key + "_value"] += value
    for p in (await db.execute(select(Part))).scalars().all():
        for a in (per[p.owner_id or house_id], comb):
            a["parts_units"] += p.quantity_on_hand
            a["parts_value"] += (p.unit_cost or Z) * p.quantity_on_hand
    return per, comb


def _add_sales(a: dict, sales: list) -> None:
    for s in sales:
        a["delivery_and_tax"] += (s.delivery_fee or Z) + (s.tax or Z)
        a["invoiced"] += s.total or Z
        a["collected"] += s.amount_paid or Z
        subtotal = s.subtotal or Z
        for li in s.line_items:
            share = (s.discount or Z) * li.line_total / subtotal if subtotal else Z
            if li.device_id:
                a["phones_sold"] += 1
                a["phone_revenue"] += li.line_total - share
                a["phone_cost"] += li.device.total_cost if li.device else Z
            else:
                a["parts_sold"] += li.quantity
                a["parts_revenue"] += li.line_total - share
                a["parts_cost"] += (li.unit_cost_at_sale or Z) * li.quantity


async def get_owner_statement(
    db: AsyncSession,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
) -> dict:
    house_id = await get_house_owner_id(db)
    owners = (await db.execute(
        select(StockOwner).order_by(StockOwner.is_house.desc(), StockOwner.name)
    )).scalars().all()
    stock_per, combined = await _stock(db, house_id)

    sq = select(Sale).options(selectinload(Sale.line_items).selectinload(SaleLineItem.device))
    if date_from:
        sq = sq.where(Sale.date >= date_from)
    if date_to:
        sq = sq.where(Sale.date <= date_to)
    sales = list((await db.execute(sq)).scalars().all())
    _add_sales(combined, sales)

    rq = select(ReturnRMA).options(selectinload(ReturnRMA.device)).where(ReturnRMA.refund_amount.isnot(None))
    if date_from:
        rq = rq.where(ReturnRMA.date >= date_from)
    if date_to:
        rq = rq.where(ReturnRMA.date <= date_to)
    refunds_by_owner: dict[str, Decimal] = defaultdict(Decimal)
    for r in (await db.execute(rq)).scalars().all():
        refunds_by_owner[(r.device.owner_id if r.device else None) or house_id] += r.refund_amount or Z
        combined["refunds"] += r.refund_amount or Z

    eq = select(Expense)
    if date_from:
        eq = eq.where(Expense.date >= date_from)
    if date_to:
        eq = eq.where(Expense.date <= date_to)
    expenses = sum((e.amount for e in (await db.execute(eq)).scalars().all()), Z)
    combined["expenses"] = expenses

    # Customers' unpaid balances now (all invoices, not just the period)
    unpaid = list((await db.execute(select(Sale).where(Sale.total > Sale.amount_paid))).scalars().all())
    combined["owed_by_customers"] = sum((s.total - s.amount_paid for s in unpaid), Z)

    rows = []
    for o in owners:
        a = stock_per.get(o.id, _blank())
        _add_sales(a, await owner_sales(db, sales, o.id))
        a["refunds"] = refunds_by_owner.get(o.id, Z)
        if o.id == house_id:
            a["expenses"] = expenses
        parts = await inter_owner_parts(db, o.id, date_from, date_to)
        a["parts_to_owners_revenue"] = parts["sold"]
        a["parts_to_owners_cost"] = parts["sold"]       # supplied at cost
        a["parts_from_owners_expense"] = parts["bought"]
        a["owed_by_customers"] = sum((v.balance for v in await owner_sales(db, unpaid, o.id)), Z)
        if not o.active and all((v == 0 or v == Z) for v in a.values()):
            continue
        rows.append({"owner_id": o.id, "owner": o.name, "is_house": o.is_house, "active": o.active, **_finish(a)})

    # Parts used across owners (settled at once; listed for traceability)
    cq = select(OwnerCharge).options(
        selectinload(OwnerCharge.part), selectinload(OwnerCharge.device),
    ).order_by(OwnerCharge.date.desc(), OwnerCharge.created_at.desc())
    if date_from:
        cq = cq.where(OwnerCharge.date >= date_from)
    if date_to:
        cq = cq.where(OwnerCharge.date <= date_to)
    names = {o.id: o.name for o in owners}
    charges = (await db.execute(cq)).scalars().all()

    return {
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "owners": rows,
        "total": _finish(combined),
        "charges": [
            {
                "date": c.date.isoformat(),
                "supplier_owner": names.get(c.payee_owner_id, "?"),
                "phone_owner": names.get(c.payer_owner_id, "?"),
                "part": c.part.name if c.part else None,
                "quantity": c.quantity,
                "amount": str(q2(c.amount)),
                "imei": c.device.imei if c.device else None,
            }
            for c in charges
        ],
    }
