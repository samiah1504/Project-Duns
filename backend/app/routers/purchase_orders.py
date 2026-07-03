from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional
from pydantic import BaseModel

from app.database import get_db
from app.models.purchase_order import PurchaseOrder, POStatus
from app.models.device import Device
from app.schemas.purchase_order import PurchaseOrderCreate, PurchaseOrderOut, DeviceForPOOut
from app.core.permissions import inventory_or_admin
from app.core.exceptions import NotFoundError
from app.services.intake import create_purchase_order, receive_purchase_order
from app.models.user import User

router = APIRouter()


class ReceivePOBody(BaseModel):
    notes: Optional[str] = None


@router.get("", response_model=list[PurchaseOrderOut])
async def list_pos(
    status: Optional[POStatus] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    q = select(PurchaseOrder).options(
        selectinload(PurchaseOrder.line_items),
        selectinload(PurchaseOrder.devices),
    )
    if status:
        q = q.where(PurchaseOrder.status == status)
    result = await db.execute(q.order_by(PurchaseOrder.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=PurchaseOrderOut, status_code=201)
async def create_po(
    body: PurchaseOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    po = await create_purchase_order(
        db,
        supplier_id=body.supplier_id,
        line_items_data=body.line_items,
        shipping_cost=body.shipping_cost,
        notes=body.notes,
        order_date=body.date,
        user_id=current_user.id,
    )
    await db.commit()
    result = await db.execute(
        select(PurchaseOrder)
        .where(PurchaseOrder.id == po.id)
        .options(
            selectinload(PurchaseOrder.line_items),
            selectinload(PurchaseOrder.devices).selectinload(Device.model),
        )
    )
    return result.scalar_one()


@router.get("/{po_id}", response_model=PurchaseOrderOut)
async def get_po(
    po_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    result = await db.execute(
        select(PurchaseOrder)
        .where(PurchaseOrder.id == po_id)
        .options(
            selectinload(PurchaseOrder.line_items),
            selectinload(PurchaseOrder.devices).selectinload(Device.model),
        )
    )
    po = result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")
    return po


@router.get("/{po_id}/devices", response_model=list[DeviceForPOOut])
async def get_po_devices(
    po_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    result = await db.execute(
        select(Device)
        .where(Device.purchase_order_id == po_id)
        .options(selectinload(Device.model))
        .order_by(Device.created_at)
    )
    return result.scalars().all()


@router.post("/{po_id}/receive", response_model=PurchaseOrderOut)
async def receive_po(
    po_id: str,
    body: ReceivePOBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    po = await receive_purchase_order(db, po_id=po_id, user_id=current_user.id, notes=body.notes)
    await db.commit()
    result = await db.execute(
        select(PurchaseOrder)
        .where(PurchaseOrder.id == po.id)
        .options(
            selectinload(PurchaseOrder.line_items),
            selectinload(PurchaseOrder.devices).selectinload(Device.model),
        )
    )
    return result.scalar_one()
