from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from app.models.audit_log import ReferenceType


class AuditLogOut(BaseModel):
    id: str
    device_id: Optional[str] = None
    part_id: Optional[str] = None
    from_location: Optional[str] = None
    to_location: Optional[str] = None
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    user_id: Optional[str] = None
    timestamp: datetime
    reference_type: Optional[ReferenceType] = None
    reference_id: Optional[str] = None
    notes: Optional[str] = None

    model_config = {"from_attributes": True}
