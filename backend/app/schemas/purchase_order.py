from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel

from app.models.purchase_order import POStatus, POLineType


class POLineItemCreate(BaseModel):
    line_type: POLineType = POLineType.DEVICE
    # Inline device details — auto-creates / finds PhoneModel on save
    brand: Optional[str] = None
    model_name_str: Optional[str] = None
    ram_str: Optional[str] = None
    storage_str: Optional[str] = None
    colour_str: Optional[str] = None
    imei: Optional[str] = None
    model_id: Optional[str] = None   # explicit FK override (optional)
    grade: Optional[str] = "C"
    initial_status: Optional[str] = "awaiting_refurb"  # awaiting_refurb | sellable | scrapped
    unit_cost: Decimal = Decimal("0.00")
    # Part fields
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
    initial_status: Optional[str] = None
    unit_cost: Decimal
    part_id: Optional[str] = None
    quantity: int
    notes: Optional[str] = None
    brand: Optional[str] = None
    model_name_str: Optional[str] = None
    ram_str: Optional[str] = None
    storage_str: Optional[str] = None
    colour_str: Optional[str] = None

    model_config = {"from_attributes": True}


class PhoneModelSimple(BaseModel):
    id: str
    brand: str
    model_name: str
    ram: Optional[str] = None
    storage: Optional[str] = None
    colour: Optional[str] = None

    model_config = {"from_attributes": True}


class DeviceForPOOut(BaseModel):
    id: str
    imei: str
    inventory_number: Optional[str] = None
    grade: str
    status: str
    location: str
    purchase_cost: Decimal
    date_received: Optional[date] = None
    model: Optional[PhoneModelSimple] = None

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
    devices: List[DeviceForPOOut] = []

    model_config = {"from_attributes": True}


class ReceivePORequest(BaseModel):
    notes: Optional[str] = None
