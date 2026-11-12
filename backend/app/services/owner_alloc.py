"""Splitting shared figures between stock owners (House + investors).

Rules (used by every report's single-owner view):
- Invoice: each owner's share = their lines' value less their share of the
  invoice discount (split by line value). Delivery fee and tax are House's.
  Payments and the unpaid balance are split in the same proportions, so on an
  invoice mixing owners each owner is paid / owed their part.
- Parts used across owners are settled at once: the phone's owner books an
  expense, the part's owner books revenue (with the part's cost as cost of
  sale). Nothing is left owed between owners. Because the phone's owner already
  expensed that part, it is left out of the phone's cost in that owner's view.
- The combined view (all owners) is unchanged: internal part transfers cancel
  out and phones are valued at their full cost.
"""
from collections import defaultdict
from datetime import date as date_type
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.device import Device
from app.models.sale import Sale, SaleLineItem, PaymentStatus
from app.models.stock_owner import OwnerCharge, get_house_owner_id

Z = Decimal("0.00")
CENT = Decimal("0.01")


def q2(x: Decimal) -> Decimal:
    return (x or Z).quantize(CENT, rounding=ROUND_HALF_UP)


def _apportion(amount: Decimal, weights: dict[str, Decimal]) -> dict[str, Decimal]:
    """Split `amount` by weights, to the cent, summing exactly to `amount`."""
    amount = q2(amount)
    total_w = sum(weights.values(), Z)
    if not weights:
        return {}
    if total_w == 0:
        first = next(iter(weights))
        return {k: (amount if k == first else Z) for k in weights}
    parts = {k: q2(amount * w / total_w) for k, w in weights.items()}
    diff = amount - sum(parts.values(), Z)
    if diff:
        biggest = max(weights, key=lambda k: weights[k])
        parts[biggest] += diff
    return parts


class _View:
    """Read-only overlay of an ORM object: given attributes override the base."""

    def __init__(self, base, **overrides):
        object.__setattr__(self, "_base", base)
        self.__dict__.update(overrides)

    def __getattr__(self, name):
        return getattr(self._base, name)


def split_sale(sale: Sale, house_id: str, lines: Optional[list] = None) -> dict[str, dict]:
    """Per-owner {total, paid, balance, discount, subtotal} for one invoice."""
    lines = sale.line_items if lines is None else lines
    subtotal = sale.subtotal or Z
    discount = sale.discount or Z
    line_owner = lambda li: li.owner_id or house_id  # noqa: E731
    gross: dict[str, Decimal] = defaultdict(Decimal)
    for li in lines:
        gross[line_owner(li)] += li.line_total or Z
    disc = _apportion(discount, dict(gross)) if subtotal and discount else {k: Z for k in gross}
    totals = {k: gross[k] - disc.get(k, Z) for k in gross}
    extra = (sale.delivery_fee or Z) + (sale.tax or Z)
    if extra or house_id not in totals:
        totals[house_id] = totals.get(house_id, Z) + extra
        gross.setdefault(house_id, Z)
        disc.setdefault(house_id, Z)
    # Keep totals exactly equal to the invoice total
    drift = q2(sale.total or Z) - sum(totals.values(), Z)
    if drift and totals:
        totals[max(totals, key=lambda k: totals[k])] += drift
    paid = _apportion(sale.amount_paid or Z, {k: max(v, Z) for k, v in totals.items()})
    return {
        k: {
            "total": totals[k], "paid": paid.get(k, Z), "balance": totals[k] - paid.get(k, Z),
            "discount": disc.get(k, Z), "subtotal": gross.get(k, Z),
        }
        for k in totals
    }


def _status(total: Decimal, paid: Decimal) -> PaymentStatus:
    if paid <= 0:
        return PaymentStatus.UNPAID
    if paid >= total:
        return PaymentStatus.PAID
    return PaymentStatus.PARTIAL


async def charges_by_device(db: AsyncSession, device_ids: Iterable[str]) -> dict[str, Decimal]:
    """Cost of parts from other owners' stock already expensed by each phone's owner."""
    ids = list({d for d in device_ids if d})
    if not ids:
        return {}
    rows = await db.execute(
        select(OwnerCharge.device_id, func.sum(OwnerCharge.amount))
        .where(OwnerCharge.device_id.in_(ids)).group_by(OwnerCharge.device_id)
    )
    return {d: a or Z for d, a in rows.all()}


def owner_device(device, charged: dict[str, Decimal]):
    """Device as seen in its owner's accounts: cost excludes parts already expensed."""
    if device is None:
        return None
    return _View(device, total_cost=device.total_cost - charged.get(device.id, Z))


async def owner_devices(db: AsyncSession, devices: list) -> list:
    charged = await charges_by_device(db, [d.id for d in devices])
    return [owner_device(d, charged) for d in devices]


async def owner_sales(db: AsyncSession, sales: list, owner_id: str) -> list:
    """The given owner's slice of each invoice (only invoices they have a part in).

    Each slice has the owner's lines, total, discount, delivery/tax (House only),
    amount_paid, balance and payment status; other attributes come from the sale.
    """
    if not sales:
        return []
    house_id = await get_house_owner_id(db)
    res = await db.execute(
        select(SaleLineItem)
        .where(SaleLineItem.sale_id.in_([s.id for s in sales]))
        .options(selectinload(SaleLineItem.device).selectinload(Device.model), selectinload(SaleLineItem.part))
    )
    lines_by_sale: dict[str, list] = defaultdict(list)
    for li in res.scalars().all():
        lines_by_sale[li.sale_id].append(li)
    charged = await charges_by_device(
        db, [li.device_id for ls in lines_by_sale.values() for li in ls if (li.owner_id or house_id) == owner_id]
    )
    out = []
    for s in sales:
        lines = lines_by_sale.get(s.id, [])
        split = split_sale(s, house_id, lines)
        mine = split.get(owner_id)
        own_lines = [li for li in lines if (li.owner_id or house_id) == owner_id]
        if mine is None or (not own_lines and mine["total"] == 0):
            continue
        is_house = owner_id == house_id
        out.append(_View(
            s,
            line_items=[_View(li, device=owner_device(li.device, charged)) for li in own_lines],
            subtotal=mine["subtotal"],
            discount=mine["discount"],
            delivery_fee=(s.delivery_fee or Z) if is_house else Z,
            tax=(s.tax or Z) if is_house else Z,
            total=mine["total"],
            amount_paid=mine["paid"],
            balance=mine["balance"],
            payment_status=_status(mine["total"], mine["paid"]),
        ))
    return out


async def owner_balances_by_customer(db: AsyncSession, owner_id: str) -> dict[str, Decimal]:
    """What each customer still owes this owner, across all unpaid invoices."""
    res = await db.execute(select(Sale).where(Sale.total > Sale.amount_paid))
    views = await owner_sales(db, list(res.scalars().all()), owner_id)
    out: dict[str, Decimal] = defaultdict(Decimal)
    for v in views:
        if v.balance > 0:
            out[v.customer_id] += v.balance
    return out


async def inter_owner_parts(
    db: AsyncSession, owner_id: str,
    date_from: Optional[date_type] = None, date_to: Optional[date_type] = None,
) -> dict[str, Decimal]:
    """Parts used across owners in the period, settled immediately:
    `sold` = revenue (and cost of sale) for parts this owner supplied,
    `bought` = expense for parts this owner's phones took from others."""
    q = select(OwnerCharge)
    if date_from:
        q = q.where(OwnerCharge.date >= date_from)
    if date_to:
        q = q.where(OwnerCharge.date <= date_to)
    sold = bought = Z
    for c in (await db.execute(q)).scalars().all():
        if c.payee_owner_id == owner_id:
            sold += c.amount
        if c.payer_owner_id == owner_id:
            bought += c.amount
    return {"sold": sold, "bought": bought}
