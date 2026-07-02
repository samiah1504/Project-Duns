import uuid
import enum
from datetime import datetime

from sqlalchemy import String, DateTime, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ReferenceType(str, enum.Enum):
    PO = "PO"
    JOB = "job"
    SALE = "sale"
    RETURN = "return"
    TRANSFER = "transfer"
    ADJUSTMENT = "adjustment"


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    device_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("devices.id"), nullable=True
    )
    part_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("parts.id"), nullable=True
    )
    from_location: Mapped[str | None] = mapped_column(String(50), nullable=True)
    to_location: Mapped[str | None] = mapped_column(String(50), nullable=True)
    from_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    reference_type: Mapped[ReferenceType | None] = mapped_column(
        SAEnum(ReferenceType), nullable=True
    )
    reference_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    device: Mapped["Device | None"] = relationship("Device", back_populates="audit_logs")
    part: Mapped["Part | None"] = relationship("Part", back_populates="audit_logs")
    user: Mapped["User | None"] = relationship("User", back_populates="audit_logs")
