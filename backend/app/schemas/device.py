from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel

from app.models.device import DeviceStatus, DeviceGrade, DeviceLocation

# Roles that are allowed to see cost price
COST_PRICE_ROLES = {"ADMIN", "OPERATIONS"}


class DeviceCreate(BaseModel):
    imei: str
    model_id: str
    grade: DeviceGrade
    status: DeviceStatus = DeviceStatus.AWAITING_REFURB
    location: DeviceLocation = DeviceLocation.INTAKE
    purchase_cost: Decimal = Decimal("0.00")
    purchase_order_id: Optional[str] = None
    supplier_id: Optional[str] = None
    date_received: Optional[date] = None
    notes: Optional[str] = None


class DeviceUpdate(BaseModel):
    grade: Optional[DeviceGrade] = None
    notes: Optional[str] = None
    warranty_expiry: Optional[date] = None


class DeviceTransfer(BaseModel):
    to_status: DeviceStatus
    to_location: DeviceLocation
    custody_user_id: Optional[str] = None
    notes: Optional[str] = None


class CostPriceUpdate(BaseModel):
    purchase_cost: Decimal
    notes: Optional[str] = None


class ModelSummary(BaseModel):
    id: str
    brand: Optional[str] = None
    model_name: Optional[str] = None
    ram: Optional[str] = None
    storage: Optional[str] = None
    colour: Optional[str] = None

    model_config = {"from_attributes": True}


class DeviceOut(BaseModel):
    id: str
    imei: str
    inventory_number: Optional[str] = None
    model_id: str
    model: Optional[ModelSummary] = None
    grade: DeviceGrade
    status: DeviceStatus
    location: DeviceLocation
    custody_user_id: Optional[str] = None
    purchase_cost: Optional[Decimal] = None  # None when hidden from caller
    parts_cost: Optional[Decimal] = None
    external_cost: Optional[Decimal] = None
    total_cost: Optional[Decimal] = None
    selling_price: Optional[Decimal] = None
    selling_price_set_by: Optional[str] = None
    selling_price_set_at: Optional[datetime] = None
    selling_price_status: Optional[str] = None  # 'set' | 'required'
    purchase_order_id: Optional[str] = None
    supplier_id: Optional[str] = None
    date_received: Optional[date] = None
    sale_id: Optional[str] = None
    sale_price: Optional[Decimal] = None
    warranty_expiry: Optional[date] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PriceChangeOut(BaseModel):
    id: str
    device_id: str
    imei: str
    user_id: str
    user_role: str
    field: str
    old_value: Optional[Decimal] = None
    new_value: Optional[Decimal] = None
    action: str
    notes: Optional[str] = None
    timestamp: datetime

    model_config = {"from_attributes": True}


def device_to_out(device, viewer_role: str) -> dict:
    """Build DeviceOut dict, masking cost fields for non-privileged roles."""
    show_cost = viewer_role in COST_PRICE_ROLES
    d = {
        "id": device.id,
        "imei": device.imei,
        "inventory_number": device.inventory_number,
        "model_id": device.model_id,
        "model": {
            "id": device.model.id,
            "brand": device.model.brand,
            "model_name": device.model.model_name,
            "ram": device.model.ram,
            "storage": device.model.storage,
            "colour": device.model.colour,
        } if getattr(device, "model", None) else None,
        "grade": device.grade,
        "status": device.status,
        "location": device.location,
        "custody_user_id": device.custody_user_id,
        "selling_price": device.selling_price,
        "selling_price_set_by": device.selling_price_set_by,
        "selling_price_set_at": device.selling_price_set_at,
        "selling_price_status": "set" if device.selling_price is not None else "required",
        "purchase_order_id": device.purchase_order_id,
        "supplier_id": device.supplier_id,
        "date_received": device.date_received,
        "sale_id": device.sale_id,
        "sale_price": device.sale_price,
        "warranty_expiry": device.warranty_expiry,
        "notes": device.notes,
        "created_at": device.created_at,
        "updated_at": device.updated_at,
    }
    if show_cost:
        d["purchase_cost"] = device.purchase_cost
        d["parts_cost"] = device.parts_cost
        d["external_cost"] = device.external_cost
        d["total_cost"] = device.total_cost
    else:
        d["purchase_cost"] = None
        d["parts_cost"] = None
        d["external_cost"] = None
        d["total_cost"] = None
    return d
