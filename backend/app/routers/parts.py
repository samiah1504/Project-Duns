from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from pydantic import BaseModel
from decimal import Decimal

from app.database import get_db
from app.models.part import Part
from app.models.audit_log import ReferenceType
from app.schemas.part import PartCreate, PartUpdate, PartOut, part_to_out, PART_COST_ROLES
from app.core.permissions import inventory_or_admin, any_authenticated, admin_or_operations
from app.core.exceptions import NotFoundError, BadRequestError, ConflictError
from app.models.stock_owner import resolve_owner_id
from app.services.audit import write_audit
from app.models.user import User

router = APIRouter()


async def _sku_taken(db: AsyncSession, sku: Optional[str], owner_id: str, exclude_id: Optional[str] = None) -> bool:
    """SKUs are unique per stock owner (each owner can stock the same part)."""
    if not sku:
        return False
    q = select(Part.id).where(Part.sku == sku, Part.owner_id == owner_id)
    if exclude_id:
        q = q.where(Part.id != exclude_id)
    return (await db.execute(q)).first() is not None


class StockAdjust(BaseModel):
    delta: int
    notes: Optional[str] = None


@router.get("", response_model=list[PartOut])
async def list_parts(
    low_stock_only: bool = False,
    owner_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(any_authenticated()),
):
    q = select(Part)
    if owner_id:
        q = q.where(Part.owner_id == owner_id)
    if low_stock_only:
        q = q.where(Part.quantity_on_hand <= Part.min_stock_level)
    result = await db.execute(q.order_by(Part.name))
    return [part_to_out(p, current_user.role.value) for p in result.scalars().all()]


@router.get("/stock-valuation")
async def parts_stock_valuation(
    owner_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_or_operations()),
):
    """Total Parts & Accessories stock value = Σ quantity_on_hand × unit_cost.

    Valuation uses COST price, never selling price. ADMIN/OPERATIONS only.
    Optionally for one stock owner; all owners otherwise.
    """
    q = select(Part)
    if owner_id:
        q = q.where(Part.owner_id == owner_id)
    result = await db.execute(q)
    parts = result.scalars().all()
    total_units = sum(p.quantity_on_hand for p in parts)
    total_value = sum(
        (p.unit_cost or Decimal("0")) * p.quantity_on_hand for p in parts
    )
    return {
        "total_items": len(parts),
        "total_units": total_units,
        "total_value": str(total_value),
        "items": [
            {
                "id": p.id,
                "name": p.name,
                "owner_id": p.owner_id,
                "quantity_on_hand": p.quantity_on_hand,
                "unit_cost": str(p.unit_cost or Decimal("0")),
                "stock_value": str((p.unit_cost or Decimal("0")) * p.quantity_on_hand),
            }
            for p in parts
        ],
    }


@router.post("", response_model=PartOut, status_code=201)
async def create_part(
    body: PartCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    data = body.model_dump()
    data["owner_id"] = await resolve_owner_id(db, data.get("owner_id"))
    if await _sku_taken(db, data.get("sku"), data["owner_id"]):
        raise ConflictError(f"SKU {data['sku']} already exists for this stock owner")
    part = Part(**data)
    db.add(part)
    await db.flush()
    if part.quantity_on_hand:
        await write_audit(
            db,
            user_id=current_user.id,
            part_id=part.id,
            reference_type=ReferenceType.ADJUSTMENT,
            notes=f"Part created with opening stock {part.quantity_on_hand} x {part.name}",
        )
    await db.commit()
    await db.refresh(part)
    return part_to_out(part, current_user.role.value)


@router.get("/{part_id}", response_model=PartOut)
async def get_part(
    part_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(any_authenticated()),
):
    result = await db.execute(select(Part).where(Part.id == part_id))
    part = result.scalar_one_or_none()
    if not part:
        raise NotFoundError("Part not found")
    return part_to_out(part, current_user.role.value)


@router.patch("/{part_id}", response_model=PartOut)
async def update_part(
    part_id: str,
    body: PartUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    result = await db.execute(select(Part).where(Part.id == part_id))
    part = result.scalar_one_or_none()
    if not part:
        raise NotFoundError("Part not found")
    updates = body.model_dump(exclude_none=True)
    if "sku" in updates and await _sku_taken(db, updates["sku"], part.owner_id, exclude_id=part.id):
        raise ConflictError(f"SKU {updates['sku']} already exists for this stock owner")
    # owner_id is deliberately not updatable: ownership never changes
    for field, value in updates.items():
        setattr(part, field, value)
    await db.commit()
    await db.refresh(part)
    return part_to_out(part, current_user.role.value)


@router.post("/{part_id}/adjust-stock", response_model=PartOut)
async def adjust_stock(
    part_id: str,
    body: StockAdjust,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    result = await db.execute(select(Part).where(Part.id == part_id))
    part = result.scalar_one_or_none()
    if not part:
        raise NotFoundError("Part not found")
    new_qty = part.quantity_on_hand + body.delta
    if new_qty < 0:
        raise BadRequestError("Stock adjustment would result in negative quantity")
    part.quantity_on_hand = new_qty
    reason = f" — reason: {body.notes}" if body.notes else ""
    await write_audit(
        db,
        user_id=current_user.id,
        part_id=part.id,
        reference_type=ReferenceType.ADJUSTMENT,
        notes=(
            f"Manual stock adjustment {body.delta:+d} x {part.name} "
            f"(now {new_qty}){reason}"
        ),
    )
    await db.commit()
    await db.refresh(part)
    return part_to_out(part, current_user.role.value)


@router.get("/{part_id}/movements")
async def part_movements(
    part_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    """Stock movement history for one part, from the shared audit trail."""
    from app.models.audit_log import AuditLog
    result = await db.execute(select(Part).where(Part.id == part_id))
    if not result.scalar_one_or_none():
        raise NotFoundError("Part not found")
    logs = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.part_id == part_id)
            .order_by(AuditLog.timestamp.desc())
            .limit(100)
        )
    ).scalars().all()
    return [
        {
            "id": l.id,
            "timestamp": l.timestamp,
            "type": l.reference_type,
            "reference": l.reference_id,
            "notes": l.notes,
            "user_id": l.user_id,
        }
        for l in logs
    ]
