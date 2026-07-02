from datetime import datetime
from decimal import Decimal
from typing import Optional, Any, Dict
from pydantic import BaseModel

from app.models.customer import CustomerType


class CustomerCreate(BaseModel):
    name: str
    type: CustomerType = CustomerType.RETAIL
    contact: Optional[Dict[str, Any]] = None
    credit_limit: Decimal = Decimal("0.00")


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[CustomerType] = None
    contact: Optional[Dict[str, Any]] = None
    credit_limit: Optional[Decimal] = None


class CustomerOut(BaseModel):
    id: str
    name: str
    type: CustomerType
    contact: Optional[Dict[str, Any]] = None
    credit_limit: Decimal
    current_balance: Decimal
    created_at: datetime

    model_config = {"from_attributes": True}


class CustomerBalanceOut(BaseModel):
    customer_id: str
    name: str
    credit_limit: Decimal
    current_balance: Decimal
    available_credit: Decimal
