from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from pydantic import BaseModel

from app.database import get_db
from app.models.purchase_order import PurchaseOrder, POStatus
from app.schemas.purchase_order import PurchaseOrderCreate, PurchaseOrderOut
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
    q = select(PurchaseOrder)
    if status:
        q = q.where(PurchaseOrder.status == status)
    result = await db.execute(q.order_by(PurchaseOrder.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=PurchaseOrderOut, status_code=201)
async def create_po(
    body: PurchaseOrderCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    po = await create_purchase_order(
        db,
        supplier_id=body.supplier_id,
        line_items_data=body.line_items,
        shipping_cost=body.shipping_cost,
        notes=body.notes,
        order_date=body.date,
    )
    await db.commit()
    await db.refresh(po)
    return po


@router.get("/{po_id}", response_model=PurchaseOrderOut)
async def get_po(
    po_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")
    return po


@router.post("/{po_id}/receive", response_model=PurchaseOrderOut)
async def receive_po(
    po_id: str,
    body: ReceivePOBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    po = await receive_purchase_order(db, po_id=po_id, user_id=current_user.id, notes=body.notes)
    await db.commit()
    await db.refresh(po)
    return po
