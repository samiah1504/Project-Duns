from datetime import datetime
from datetime import date as date_type
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel

from app.models.return_rma import (
    ReturnReasonCode, ReturnResolution, RestockOutcome, ReturnBatchStatus,
)


# ── Item-level schemas ────────────────────────────────────────────────────────

class ReturnItemCreate(BaseModel):
    device_id: str
    reason_code: ReturnReasonCode
    condition_on_return: Optional[str] = None
    within_warranty: bool = False
    resolution: Optional[ReturnResolution] = None
    refund_amount: Optional[Decimal] = None
    restock_outcome: Optional[RestockOutcome] = None
    replacement_device_id: Optional[str] = None
    notes: Optional[str] = None


class ReturnItemResolve(BaseModel):
    resolution: ReturnResolution
    refund_amount: Optional[Decimal] = None
    restock_outcome: Optional[RestockOutcome] = None
    replacement_device_id: Optional[str] = None
    notes: Optional[str] = None


class DeviceSnapshot(BaseModel):
    id: str
    imei: str
    inventory_number: Optional[str] = None
    grade: str
    status: str

    model_config = {"from_attributes": True}


class ReturnItemOut(BaseModel):
    id: str
    rma_number: str
    batch_id: Optional[str] = None
    original_sale_id: Optional[str] = None
    device_id: str
    customer_id: str
    date: date_type
    reason_code: ReturnReasonCode
    condition_on_return: Optional[str] = None
    within_warranty: bool
    resolution: Optional[ReturnResolution] = None
    refund_amount: Optional[Decimal] = None
    restock_outcome: Optional[RestockOutcome] = None
    replacement_device_id: Optional[str] = None
    handled_by_user_id: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    device: Optional[DeviceSnapshot] = None

    model_config = {"from_attributes": True}


# ── Batch-level schemas ───────────────────────────────────────────────────────

class ReturnBatchCreate(BaseModel):
    original_sale_id: Optional[str] = None
    customer_id: str
    date: Optional[date_type] = None
    notes: Optional[str] = None
    items: List[ReturnItemCreate]


class ReturnBatchStatusUpdate(BaseModel):
    status: ReturnBatchStatus


class ReturnBatchOut(BaseModel):
    id: str
    batch_number: str
    original_sale_id: Optional[str] = None
    customer_id: str
    date: date_type
    received_by_user_id: Optional[str] = None
    notes: Optional[str] = None
    status: ReturnBatchStatus
    created_at: datetime
    items: List[ReturnItemOut] = []

    model_config = {"from_attributes": True}


# ── Legacy single-RMA schemas (kept for backward compatibility) ───────────────

class ReturnCreate(BaseModel):
    original_sale_id: Optional[str] = None
    device_id: str
    customer_id: str
    date: Optional[date_type] = None
    reason_code: ReturnReasonCode
    condition_on_return: Optional[str] = None
    within_warranty: bool = False
    notes: Optional[str] = None


class ResolveReturnRequest(BaseModel):
    resolution: ReturnResolution
    refund_amount: Optional[Decimal] = None
    restock_outcome: Optional[RestockOutcome] = None
    notes: Optional[str] = None


class ReturnOut(BaseModel):
    id: str
    rma_number: str
    batch_id: Optional[str] = None
    original_sale_id: Optional[str] = None
    device_id: str
    customer_id: str
    date: date_type
    reason_code: ReturnReasonCode
    condition_on_return: Optional[str] = None
    within_warranty: bool
    resolution: Optional[ReturnResolution] = None
    refund_amount: Optional[Decimal] = None
    restock_outcome: Optional[RestockOutcome] = None
    replacement_device_id: Optional[str] = None
    handled_by_user_id: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
