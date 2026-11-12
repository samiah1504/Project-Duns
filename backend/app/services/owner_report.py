"""Per-owner stock and accounts (House + investors), with the all-owners total.

Accounting rules
- A phone or part belongs to the owner it was received for; its sale revenue and
  cost of sale go to that owner (snapshot on the sale line).
- Invoice discount is shared across the invoice's lines in proportion to value.
  Delivery fees and tax on invoices go to the House, as do all expenses.
- Refunds go to the owner of the returned phone.
- A part from another owner's stock used in a phone is costed into the phone
  (counted once, when the phone is sold). The settlement section shows what
  each owner owes / is owed for such parts; across all owners it nets to zero.
- The all-owners totals use the same definitions as the CEO dashboard.
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

Z = Decimal("0.00")

SELLABLE = {DeviceStatus.SELLABLE, DeviceStatus.RESERVED}
IN_REFURB = {
    DeviceStatus.AWAITING_REFURB, DeviceStatus.IN_REFURB, DeviceStatus.AWAITING_QC,
    DeviceStatus.FAILED_QC, DeviceStatus.SENT_EXTERNAL,
}
OTHER_HELD = {DeviceStatus.RETURNED, DeviceStatus.STOCK_TO_RETURN}


def _money(x: Decimal) -> str:
    return str((x or Z).quantize(Decimal("0.01")))


def _blank() -> dict:
    return {
        "phones_sellable": 0, "phones_sellable_value": Z,
        "phones_in_refurb": 0, "phones_in_refurb_value": Z,
        "phones_other": 0, "phones_other_value": Z,
        "parts_units": 0, "parts_value": Z,
        "phones_sold": 0, "phone_revenue": Z, "phone_cost": Z,
        "parts_sold": 0, "parts_revenue": Z, "parts_cost": Z,
        "delivery_and_tax": Z, "refunds": Z, "expenses": Z,
        "owes_other_owners": Z, "owed_by_other_owners": Z,
    }


async def get_owner_statement(
    db: AsyncSession,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
) -> dict:
    house_id = await get_house_owner_id(db)
    owners = (await db.execute(
        select(StockOwner).order_by(StockOwner.is_house.desc(), StockOwner.name)
    )).scalars().all()
    acc: dict[str, dict] = defaultdict(_blank)
    own = lambda oid: oid or house_id  # noqa: E731 — rows from before owners default to House

    # ── Stock on hand (now) ────────────────────────────────────────────────
    # A customer's phone in for repair & return is not our stock
    customer_repair_ids = set((await db.execute(
        select(RefurbJob.device_id).where(RefurbJob.customer_repair.is_(True), RefurbJob.status != "closed")
    )).scalars().all())
    devices = (await db.execute(
        select(Device).where(Device.status.in_(SELLABLE | IN_REFURB | OTHER_HELD))
    )).scalars().all()
    for d in devices:
        if d.id in customer_repair_ids:
            continue
        a = acc[own(d.owner_id)]
        key = "phones_sellable" if d.status in SELLABLE else "phones_in_refurb" if d.status in IN_REFURB else "phones_other"
        a[key] += 1
        a[key + "_value"] += d.total_cost
    for p in (await db.execute(select(Part))).scalars().all():
        a = acc[own(p.owner_id)]
        a["parts_units"] += p.quantity_on_hand
        a["parts_value"] += (p.unit_cost or Z) * p.quantity_on_hand

    # ── Sales in the period ────────────────────────────────────────────────
    sq = select(Sale).options(selectinload(Sale.line_items).selectinload(SaleLineItem.device))
    if date_from:
        sq = sq.where(Sale.date >= date_from)
    if date_to:
        sq = sq.where(Sale.date <= date_to)
    for s in (await db.execute(sq)).scalars().all():
        subtotal = s.subtotal or Z
        discount = s.discount or Z
        acc[house_id]["delivery_and_tax"] += (s.delivery_fee or Z) + (s.tax or Z)
        for li in s.line_items:
            share = (discount * li.line_total / subtotal) if subtotal else Z
            revenue = li.line_total - share
            if li.device_id:
                a = acc[own(li.owner_id or (li.device.owner_id if li.device else None))]
                a["phones_sold"] += 1
                a["phone_revenue"] += revenue
                a["phone_cost"] += li.device.total_cost if li.device else Z
            else:
                a = acc[own(li.owner_id)]
                a["parts_sold"] += li.quantity
                a["parts_revenue"] += revenue
                a["parts_cost"] += (li.unit_cost_at_sale or Z) * li.quantity

    # ── Refunds (owner of the returned phone) ──────────────────────────────
    rq = select(ReturnRMA).options(selectinload(ReturnRMA.device)).where(ReturnRMA.refund_amount.isnot(None))
    if date_from:
        rq = rq.where(ReturnRMA.date >= date_from)
    if date_to:
        rq = rq.where(ReturnRMA.date <= date_to)
    for r in (await db.execute(rq)).scalars().all():
        acc[own(r.device.owner_id if r.device else None)]["refunds"] += r.refund_amount or Z

    # ── Expenses: all paid by the House ────────────────────────────────────
    eq = select(Expense)
    if date_from:
        eq = eq.where(Expense.date >= date_from)
    if date_to:
        eq = eq.where(Expense.date <= date_to)
    acc[house_id]["expenses"] += sum((e.amount for e in (await db.execute(eq)).scalars().all()), Z)

    # ── Settlement between owners (parts used across owners) ───────────────
    cq = select(OwnerCharge).options(
        selectinload(OwnerCharge.part), selectinload(OwnerCharge.device),
    ).order_by(OwnerCharge.date.desc(), OwnerCharge.created_at.desc())
    if date_from:
        cq = cq.where(OwnerCharge.date >= date_from)
    if date_to:
        cq = cq.where(OwnerCharge.date <= date_to)
    charges = (await db.execute(cq)).scalars().all()
    names = {o.id: o.name for o in owners}
    pair: dict[tuple[str, str], Decimal] = defaultdict(Decimal)
    for c in charges:
        acc[c.payer_owner_id]["owes_other_owners"] += c.amount
        acc[c.payee_owner_id]["owed_by_other_owners"] += c.amount
        pair[(c.payer_owner_id, c.payee_owner_id)] += c.amount

    # Net each pair (A owes B 100, B owes A 30 → A owes B 70)
    balances = []
    done = set()
    for (payer, payee), amt in pair.items():
        if (payee, payer) in done:
            continue
        done.add((payer, payee))
        net = amt - pair.get((payee, payer), Z)
        if net == 0:
            continue
        frm, to = (payer, payee) if net > 0 else (payee, payer)
        balances.append({"from": names.get(frm, "?"), "from_id": frm, "to": names.get(to, "?"),
                         "to_id": to, "amount": _money(abs(net))})

    # ── Assemble ───────────────────────────────────────────────────────────
    def finish(a: dict) -> dict:
        revenue = a["phone_revenue"] + a["parts_revenue"] + a["delivery_and_tax"]
        cost = a["phone_cost"] + a["parts_cost"]
        gross = revenue - cost
        net = gross - a["refunds"] - a["expenses"]
        out = {k: (_money(v) if isinstance(v, Decimal) else v) for k, v in a.items()}
        out.update({
            "phones_in_stock": a["phones_sellable"] + a["phones_in_refurb"] + a["phones_other"],
            "phones_in_stock_value": _money(a["phones_sellable_value"] + a["phones_in_refurb_value"] + a["phones_other_value"]),
            "stock_value": _money(a["phones_sellable_value"] + a["phones_in_refurb_value"]
                                  + a["phones_other_value"] + a["parts_value"]),
            "revenue": _money(revenue), "cost_of_sales": _money(cost),
            "gross_profit": _money(gross), "net_profit": _money(net),
            "settlement_net": _money(a["owed_by_other_owners"] - a["owes_other_owners"]),
        })
        return out

    rows = []
    total = _blank()
    for o in owners:
        a = acc.get(o.id, _blank())
        if not o.active and all((v == 0 or v == Z) for v in a.values()):
            continue
        for k, v in a.items():
            total[k] += v
        rows.append({"owner_id": o.id, "owner": o.name, "is_house": o.is_house, "active": o.active, **finish(a)})

    total_out = finish(total)
    # Between owners the settlement cancels out overall
    total_out["owes_other_owners"] = total_out["owed_by_other_owners"] = total_out["settlement_net"] = _money(Z)

    return {
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "owners": rows,
        "total": total_out,
        "balances": balances,
        "charges": [
            {
                "date": c.date.isoformat(),
                "payer": names.get(c.payer_owner_id, "?"),
                "payee": names.get(c.payee_owner_id, "?"),
                "part": c.part.name if c.part else None,
                "quantity": c.quantity,
                "unit_cost": _money(c.unit_cost),
                "amount": _money(c.amount),
                "imei": c.device.imei if c.device else None,
                "notes": c.notes,
            }
            for c in charges
        ],
    }
