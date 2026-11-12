from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.stock_owner import StockOwner, get_house_owner_id
from app.models.user import User
from app.core.permissions import any_authenticated, admin_or_operations
from app.core.exceptions import NotFoundError, ConflictError, BadRequestError

router = APIRouter()


class StockOwnerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    notes: Optional[str] = None


class StockOwnerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    active: Optional[bool] = None
    notes: Optional[str] = None


class StockOwnerOut(BaseModel):
    id: str
    name: str
    is_house: bool
    active: bool
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


async def _name_taken(db: AsyncSession, name: str, exclude_id: Optional[str] = None) -> bool:
    q = select(StockOwner.id).where(func.lower(StockOwner.name) == name.strip().lower())
    if exclude_id:
        q = q.where(StockOwner.id != exclude_id)
    return (await db.execute(q)).first() is not None


@router.get("", response_model=list[StockOwnerOut])
async def list_owners(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    await get_house_owner_id(db)  # make sure House exists
    await db.commit()
    q = select(StockOwner)
    if not include_inactive:
        q = q.where(StockOwner.active.is_(True))
    # House first, then investors alphabetically
    result = await db.execute(q.order_by(StockOwner.is_house.desc(), StockOwner.name))
    return result.scalars().all()


@router.post("", response_model=StockOwnerOut, status_code=201)
async def create_owner(
    body: StockOwnerCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_or_operations()),
):
    if await _name_taken(db, body.name):
        raise ConflictError(f"A stock owner named '{body.name.strip()}' already exists")
    owner = StockOwner(name=body.name.strip(), notes=body.notes, is_house=False)
    db.add(owner)
    await db.commit()
    await db.refresh(owner)
    return owner


@router.patch("/{owner_id}", response_model=StockOwnerOut)
async def update_owner(
    owner_id: str,
    body: StockOwnerUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_or_operations()),
):
    owner = (await db.execute(select(StockOwner).where(StockOwner.id == owner_id))).scalar_one_or_none()
    if not owner:
        raise NotFoundError("Stock owner not found")
    if body.name is not None:
        if await _name_taken(db, body.name, exclude_id=owner.id):
            raise ConflictError(f"A stock owner named '{body.name.strip()}' already exists")
        owner.name = body.name.strip()
    if body.active is not None:
        if owner.is_house and not body.active:
            raise BadRequestError("The House owner cannot be deactivated")
        owner.active = body.active
    if body.notes is not None:
        owner.notes = body.notes
    await db.commit()
    await db.refresh(owner)
    return owner
