from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel

from app.models.purchase_order import POStatus, POLineType, PO_STATUS_LABELS


class POLineItemCreate(BaseModel):
    line_type: POLineType = POLineType.DEVICE
    brand: Optional[str] = None
    model_name_str: Optional[str] = None
    ram_str: Optional[str] = None
    storage_str: Optional[str] = None
    colour_str: Optional[str] = None
    imei: Optional[str] = None          # optional at create; provided at receive time
    model_id: Optional[str] = None
    grade: Optional[str] = "C"
    initial_status: Optional[str] = "awaiting_refurb"
    unit_cost: Decimal = Decimal("0.00")
    selling_price: Optional[Decimal] = None
    quantity: int = 1
    part_id: Optional[str] = None
    notes: Optional[str] = None


class POLineItemUpdate(BaseModel):
    brand: Optional[str] = None
    model_name_str: Optional[str] = None
    ram_str: Optional[str] = None
    storage_str: Optional[str] = None
    colour_str: Optional[str] = None
    grade: Optional[str] = None
    initial_status: Optional[str] = None
    selling_price: Optional[Decimal] = None
    quantity: Optional[int] = None
    notes: Optional[str] = None
    discrepancy_notes: Optional[str] = None
    item_status: Optional[str] = None


class ReceiveLineItemRequest(BaseModel):
    imei: str
    actual_brand: Optional[str] = None
    actual_model_str: Optional[str] = None
    actual_ram_str: Optional[str] = None
    actual_storage_str: Optional[str] = None
    actual_colour_str: Optional[str] = None
    actual_grade: Optional[str] = None
    actual_condition: Optional[str] = "awaiting_refurb"
    selling_price: Optional[Decimal] = None
    notes: Optional[str] = None


class MarkNotReceivedRequest(BaseModel):
    notes: Optional[str] = None


class CloseDiscrepancyRequest(BaseModel):
    notes: Optional[str] = None


class POReceivedDeviceOut(BaseModel):
    id: str
    po_id: str
    line_item_id: str
    device_id: Optional[str] = None
    imei: str
    actual_brand: Optional[str] = None
    actual_model_str: Optional[str] = None
    actual_ram_str: Optional[str] = None
    actual_storage_str: Optional[str] = None
    actual_colour_str: Optional[str] = None
    actual_grade: Optional[str] = None
    actual_condition: Optional[str] = None
    selling_price: Optional[Decimal] = None
    received_by_user_id: Optional[str] = None
    received_at: datetime
    notes: Optional[str] = None
    migrated: bool = False

    model_config = {"from_attributes": True}


class POLineItemOut(BaseModel):
    id: str
    po_id: str
    line_type: POLineType
    imei: Optional[str] = None
    model_id: Optional[str] = None
    grade: Optional[str] = None
    initial_status: Optional[str] = None
    unit_cost: Decimal
    selling_price: Optional[Decimal] = None
    part_id: Optional[str] = None
    quantity: int
    received_qty: int = 0
    outstanding_qty: int = 0
    item_status: str = "pending"
    discrepancy_notes: Optional[str] = None
    notes: Optional[str] = None
    brand: Optional[str] = None
    model_name_str: Optional[str] = None
    ram_str: Optional[str] = None
    storage_str: Optional[str] = None
    colour_str: Optional[str] = None
    received_devices: List[POReceivedDeviceOut] = []

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
    selling_price: Optional[Decimal] = None
    selling_price_status: Optional[str] = None
    date_received: Optional[date] = None
    model: Optional[PhoneModelSimple] = None

    model_config = {"from_attributes": True}


class PurchaseOrderCreate(BaseModel):
    supplier_id: str
    date: Optional[date] = None
    shipping_cost: Decimal = Decimal("0.00")
    notes: Optional[str] = None
    line_items: List[POLineItemCreate] = []


class PurchaseOrderUpdate(BaseModel):
    supplier_id: Optional[str] = None
    date: Optional[date] = None
    shipping_cost: Optional[Decimal] = None
    notes: Optional[str] = None


class PurchaseOrderOut(BaseModel):
    id: str
    po_number: str
    supplier_id: str
    date: date
    shipping_cost: Decimal
    status: str
    status_label: str = ""
    received_by_user_id: Optional[str] = None
    received_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime
    created_by_user_id: Optional[str] = None
    line_items: List[POLineItemOut] = []
    total_ordered: int = 0
    total_received: int = 0

    model_config = {"from_attributes": True}


# Reconciliation schemas
class LineItemReconciliation(BaseModel):
    line_item_id: str
    expected_spec: str
    ordered_qty: int
    received_qty: int
    outstanding_qty: int
    item_status: str
    received_imeis: List[str] = []
    discrepancy_notes: Optional[str] = None


class POReconciliation(BaseModel):
    po_id: str
    po_number: str
    supplier_name: str
    order_date: date
    total_ordered: int
    total_received: int
    total_outstanding: int
    overall_status: str  # exact_match/partial_match/discrepancy/awaiting
    line_items: List[LineItemReconciliation] = []


class ReceivePOBody(BaseModel):
    notes: Optional[str] = None
