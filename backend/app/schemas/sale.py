from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel

from app.models.sale import SaleType, PaymentStatus


class SaleLineItemCreate(BaseModel):
    device_id: Optional[str] = None
    part_id: Optional[str] = None
    quantity: int = 1
    unit_price: Decimal
    notes: Optional[str] = None


class SaleLineItemOut(BaseModel):
    id: str
    sale_id: str
    device_id: Optional[str] = None
    part_id: Optional[str] = None
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class SaleCreate(BaseModel):
    customer_id: str
    type: SaleType
    tax: Decimal = Decimal("0.00")
    date: Optional[date] = None
    notes: Optional[str] = None
    line_items: List[SaleLineItemCreate]


class AddPaymentRequest(BaseModel):
    amount: Decimal
    notes: Optional[str] = None


class SaleOut(BaseModel):
    id: str
    invoice_number: str
    customer_id: str
    type: SaleType
    subtotal: Decimal
    tax: Decimal
    total: Decimal
    amount_paid: Decimal
    balance: Decimal
    payment_status: PaymentStatus
    date: date
    created_by_user_id: str
    notes: Optional[str] = None
    created_at: datetime
    line_items: List[SaleLineItemOut] = []

    model_config = {"from_attributes": True}
