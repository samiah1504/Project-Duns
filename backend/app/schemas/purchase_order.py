from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel

from app.models.purchase_order import POStatus, POLineType


class POLineItemCreate(BaseModel):
    line_type: POLineType
    imei: Optional[str] = None
    model_id: Optional[str] = None
    grade: Optional[str] = None
    unit_cost: Decimal = Decimal("0.00")
    part_id: Optional[str] = None
    quantity: int = 1
    notes: Optional[str] = None


class POLineItemOut(BaseModel):
    id: str
    po_id: str
    line_type: POLineType
    imei: Optional[str] = None
    model_id: Optional[str] = None
    grade: Optional[str] = None
    unit_cost: Decimal
    part_id: Optional[str] = None
    quantity: int
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class PurchaseOrderCreate(BaseModel):
    supplier_id: str
    date: Optional[date] = None
    shipping_cost: Decimal = Decimal("0.00")
    notes: Optional[str] = None
    line_items: List[POLineItemCreate] = []


class PurchaseOrderOut(BaseModel):
    id: str
    po_number: str
    supplier_id: str
    date: date
    shipping_cost: Decimal
    status: POStatus
    received_by_user_id: Optional[str] = None
    received_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime
    line_items: List[POLineItemOut] = []

    model_config = {"from_attributes": True}


class ReceivePORequest(BaseModel):
    notes: Optional[str] = None
