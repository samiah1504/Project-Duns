from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel

from app.models.part import PartType, PartSource


class PartCreate(BaseModel):
    name: str
    type: PartType
    sku: Optional[str] = None
    quantity_on_hand: int = 0
    unit_cost: Decimal = Decimal("0.00")
    location: Optional[str] = None
    min_stock_level: int = 0
    source: PartSource = PartSource.IMPORTED
    notes: Optional[str] = None


class PartUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[PartType] = None
    sku: Optional[str] = None
    unit_cost: Optional[Decimal] = None
    location: Optional[str] = None
    min_stock_level: Optional[int] = None
    source: Optional[PartSource] = None
    notes: Optional[str] = None


class StockAdjustment(BaseModel):
    quantity_delta: int
    notes: Optional[str] = None


class PartOut(BaseModel):
    id: str
    name: str
    type: PartType
    sku: Optional[str] = None
    quantity_on_hand: int
    unit_cost: Decimal
    location: Optional[str] = None
    min_stock_level: int
    source: PartSource
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
