from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional

from app.database import get_db
from app.models.supplier import Supplier
from app.schemas.supplier import SupplierCreate, SupplierUpdate, SupplierOut
from app.core.permissions import admin_or_operations, any_authenticated
from app.core.exceptions import NotFoundError
from app.models.user import User

router = APIRouter()


@router.get("", response_model=list[SupplierOut])
async def list_suppliers(
    supplier_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    q = select(Supplier)
    if supplier_type:
        q = q.where(Supplier.type == supplier_type)
    result = await db.execute(q.order_by(Supplier.name))
    return result.scalars().all()


@router.post("", response_model=SupplierOut, status_code=201)
async def create_supplier(
    body: SupplierCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_or_operations()),
):
    supplier = Supplier(**body.model_dump())
    db.add(supplier)
    await db.commit()
    await db.refresh(supplier)
    return supplier


@router.get("/{supplier_id}", response_model=SupplierOut)
async def get_supplier(
    supplier_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    result = await db.execute(select(Supplier).where(Supplier.id == supplier_id))
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise NotFoundError("Supplier not found")
    return supplier


@router.patch("/{supplier_id}", response_model=SupplierOut)
async def update_supplier(
    supplier_id: str,
    body: SupplierUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_or_operations()),
):
    result = await db.execute(select(Supplier).where(Supplier.id == supplier_id))
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise NotFoundError("Supplier not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(supplier, field, value)
    await db.commit()
    await db.refresh(supplier)
    return supplier
