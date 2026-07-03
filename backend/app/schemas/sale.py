from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List, Any, Dict
from pydantic import BaseModel

from app.models.sale import SaleType, PaymentStatus


class SaleLineItemCreate(BaseModel):
    device_id: Optional[str] = None
    part_id: Optional[str] = None
    quantity: int = 1
    unit_price: Decimal
    notes: Optional[str] = None


class PhoneModelForSale(BaseModel):
    brand: str
    model_name: str
    storage: Optional[str] = None
    colour: Optional[str] = None
    model_config = {"from_attributes": True}


class DeviceForSaleItem(BaseModel):
    imei: str
    grade: str
    model: Optional[PhoneModelForSale] = None
    model_config = {"from_attributes": True}


class SaleLineItemOut(BaseModel):
    id: str
    sale_id: str
    device_id: Optional[str] = None
    part_id: Optional[str] = None
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    notes: Optional[str] = None
    device: Optional[DeviceForSaleItem] = None
    model_config = {"from_attributes": True}


class CustomerForSale(BaseModel):
    id: str
    name: str
    contact: Optional[Dict[str, Any]] = None
    model_config = {"from_attributes": True}


class SaleCreate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    type: SaleType
    salesperson_name: Optional[str] = None
    payment_method: Optional[str] = None
    sales_channel: Optional[str] = None
    tax: Decimal = Decimal("0.00")
    discount: Decimal = Decimal("0.00")
    delivery_fee: Decimal = Decimal("0.00")
    amount_paid: Decimal = Decimal("0.00")
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
    discount: Decimal
    delivery_fee: Decimal
    total: Decimal
    amount_paid: Decimal
    balance: Decimal
    payment_status: PaymentStatus
    date: date
    created_by_user_id: str
    salesperson_name: Optional[str] = None
    payment_method: Optional[str] = None
    sales_channel: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    customer: Optional[CustomerForSale] = None
    line_items: List[SaleLineItemOut] = []
    model_config = {"from_attributes": True}
