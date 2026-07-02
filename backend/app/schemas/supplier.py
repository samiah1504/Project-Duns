from datetime import datetime
from typing import Optional, Any, Dict
from pydantic import BaseModel

from app.models.supplier import SupplierType


class SupplierCreate(BaseModel):
    name: str
    type: SupplierType = SupplierType.SUPPLIER
    contact: Optional[Dict[str, Any]] = None
    bank_details: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[SupplierType] = None
    contact: Optional[Dict[str, Any]] = None
    bank_details: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class SupplierOut(BaseModel):
    id: str
    name: str
    type: SupplierType
    contact: Optional[Dict[str, Any]] = None
    bank_details: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
