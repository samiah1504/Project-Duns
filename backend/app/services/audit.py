from datetime import datetime
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog, ReferenceType


async def write_audit(
    db: AsyncSession,
    *,
    user_id: Optional[str],
    device_id: Optional[str] = None,
    part_id: Optional[str] = None,
    from_status: Optional[str] = None,
    to_status: Optional[str] = None,
    from_location: Optional[str] = None,
    to_location: Optional[str] = None,
    reference_type: Optional[ReferenceType] = None,
    reference_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> AuditLog:
    entry = AuditLog(
        device_id=device_id,
        part_id=part_id,
        from_status=from_status,
        to_status=to_status,
        from_location=from_location,
        to_location=to_location,
        user_id=user_id,
        timestamp=datetime.utcnow(),
        reference_type=reference_type,
        reference_id=reference_id,
        notes=notes,
    )
    db.add(entry)
    return entry
