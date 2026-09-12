from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel

from app.models.part import PartType, PartSource

# Roles allowed to see part unit cost / stock valuation — same rule as device cost.
PART_COST_ROLES = {"ADMIN", "OPERATIONS"}


class PartCreate(BaseModel):
    name: str
    type: PartType
    sku: Optional[str] = None
    quantity_on_hand: int = 0
    unit_cost: Decimal = Decimal("0.00")
    selling_price: Optional[Decimal] = None
    location: Optional[str] = None
    min_stock_level: int = 0
    source: PartSource = PartSource.IMPORTED
    notes: Optional[str] = None


class PartUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[PartType] = None
    sku: Optional[str] = None
    unit_cost: Optional[Decimal] = None
    selling_price: Optional[Decimal] = None
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
    unit_cost: Optional[Decimal] = None   # None when hidden from caller's role
    selling_price: Optional[Decimal] = None
    location: Optional[str] = None
    min_stock_level: int
    source: PartSource
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


def part_to_out(part, viewer_role: str) -> dict:
    """Build PartOut dict, masking cost for non-privileged roles.

    Selling price is visible to everyone (SALES needs it to sell);
    unit_cost is confidential — ADMIN/OPERATIONS only.
    """
    show_cost = viewer_role in PART_COST_ROLES
    return {
        "id": part.id,
        "name": part.name,
        "type": part.type,
        "sku": part.sku,
        "quantity_on_hand": part.quantity_on_hand,
        "unit_cost": part.unit_cost if show_cost else None,
        "selling_price": part.selling_price,
        "location": part.location,
        "min_stock_level": part.min_stock_level,
        "source": part.source,
        "notes": part.notes,
        "created_at": part.created_at,
    }
