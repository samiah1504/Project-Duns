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
from app.core.exceptions import NotFoundError, BadRequestError
from app.services.audit import write_audit
from app.models.user import User

router = APIRouter()


class StockAdjust(BaseModel):
    delta: int
    notes: Optional[str] = None


@router.get("", response_model=list[PartOut])
async def list_parts(
    low_stock_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(any_authenticated()),
):
    q = select(Part)
    if low_stock_only:
        q = q.where(Part.quantity_on_hand <= Part.min_stock_level)
    result = await db.execute(q.order_by(Part.name))
    return [part_to_out(p, current_user.role.value) for p in result.scalars().all()]


@router.get("/stock-valuation")
async def parts_stock_valuation(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_or_operations()),
):
    """Total Parts & Accessories stock value = Σ quantity_on_hand × unit_cost.

    Valuation uses COST price, never selling price. ADMIN/OPERATIONS only.
    """
    result = await db.execute(select(Part))
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
    part = Part(**body.model_dump())
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
    for field, value in body.model_dump(exclude_none=True).items():
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
