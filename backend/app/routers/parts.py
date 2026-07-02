from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from pydantic import BaseModel

from app.database import get_db
from app.models.part import Part
from app.schemas.part import PartCreate, PartUpdate, PartOut
from app.core.permissions import inventory_or_admin, any_authenticated
from app.core.exceptions import NotFoundError
from app.models.user import User

router = APIRouter()


class StockAdjust(BaseModel):
    delta: int
    notes: Optional[str] = None


@router.get("", response_model=list[PartOut])
async def list_parts(
    low_stock_only: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    q = select(Part)
    if low_stock_only:
        q = q.where(Part.quantity_on_hand <= Part.min_stock_level)
    result = await db.execute(q.order_by(Part.name))
    return result.scalars().all()


@router.post("", response_model=PartOut, status_code=201)
async def create_part(
    body: PartCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    part = Part(**body.model_dump())
    db.add(part)
    await db.commit()
    await db.refresh(part)
    return part


@router.get("/{part_id}", response_model=PartOut)
async def get_part(
    part_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    result = await db.execute(select(Part).where(Part.id == part_id))
    part = result.scalar_one_or_none()
    if not part:
        raise NotFoundError("Part not found")
    return part


@router.patch("/{part_id}", response_model=PartOut)
async def update_part(
    part_id: str,
    body: PartUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    result = await db.execute(select(Part).where(Part.id == part_id))
    part = result.scalar_one_or_none()
    if not part:
        raise NotFoundError("Part not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(part, field, value)
    await db.commit()
    await db.refresh(part)
    return part


@router.post("/{part_id}/adjust-stock", response_model=PartOut)
async def adjust_stock(
    part_id: str,
    body: StockAdjust,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    result = await db.execute(select(Part).where(Part.id == part_id))
    part = result.scalar_one_or_none()
    if not part:
        raise NotFoundError("Part not found")
    from app.core.exceptions import BadRequestError
    new_qty = part.quantity_on_hand + body.delta
    if new_qty < 0:
        raise BadRequestError("Stock adjustment would result in negative quantity")
    part.quantity_on_hand = new_qty
    await db.commit()
    await db.refresh(part)
    return part
