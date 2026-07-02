from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel

from app.models.return_rma import ReturnReasonCode, ReturnResolution, RestockOutcome


class ReturnCreate(BaseModel):
    original_sale_id: Optional[str] = None
    device_id: str
    customer_id: str
    date: Optional[date] = None
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
    original_sale_id: Optional[str] = None
    device_id: str
    customer_id: str
    date: date
    reason_code: ReturnReasonCode
    condition_on_return: Optional[str] = None
    within_warranty: bool
    resolution: Optional[ReturnResolution] = None
    refund_amount: Optional[Decimal] = None
    restock_outcome: Optional[RestockOutcome] = None
    handled_by_user_id: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
