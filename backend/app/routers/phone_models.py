from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, Any, Dict
from datetime import datetime
from pydantic import BaseModel

from app.database import get_db
from app.models.model import PhoneModel
from app.core.permissions import inventory_or_admin, any_authenticated
from app.core.exceptions import NotFoundError
from app.models.user import User

router = APIRouter()


class PhoneModelCreate(BaseModel):
    brand: str
    model_name: str
    ram: Optional[str] = None
    storage: Optional[str] = None
    colour: Optional[str] = None
    default_specs: Optional[Dict[str, Any]] = None


class PhoneModelOut(BaseModel):
    id: str
    brand: str
    model_name: str
    ram: Optional[str] = None
    storage: Optional[str] = None
    colour: Optional[str] = None
    default_specs: Optional[Dict[str, Any]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[PhoneModelOut])
async def list_models(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    result = await db.execute(select(PhoneModel).order_by(PhoneModel.brand, PhoneModel.model_name))
    return result.scalars().all()


@router.post("", response_model=PhoneModelOut, status_code=201)
async def create_model(
    body: PhoneModelCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    pm = PhoneModel(**body.model_dump())
    db.add(pm)
    await db.commit()
    await db.refresh(pm)
    return pm


@router.get("/{model_id}", response_model=PhoneModelOut)
async def get_model(
    model_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    result = await db.execute(select(PhoneModel).where(PhoneModel.id == model_id))
    pm = result.scalar_one_or_none()
    if not pm:
        raise NotFoundError("Phone model not found")
    return pm
