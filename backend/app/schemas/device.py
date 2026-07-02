from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel

from app.models.device import DeviceStatus, DeviceGrade, DeviceLocation


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


class DeviceOut(BaseModel):
    id: str
    imei: str
    model_id: str
    grade: DeviceGrade
    status: DeviceStatus
    location: DeviceLocation
    custody_user_id: Optional[str] = None
    purchase_cost: Decimal
    parts_cost: Decimal
    external_cost: Decimal
    total_cost: Decimal
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
