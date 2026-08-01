import uuid
import enum
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import String, DateTime, Date, Numeric, Text, ForeignKey, Enum as SAEnum, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class JobStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    AWAITING_QC = "awaiting_qc"
    QC_FAILED = "qc_failed"
    CLOSED = "closed"


class JobOutcome(str, enum.Enum):
    REGRADED = "regraded"
    SENT_EXTERNAL = "sent_external"
    SCRAPPED = "scrapped"


class RefurbJob(Base):
    __tablename__ = "refurb_jobs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    job_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    device_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("devices.id"), nullable=False
    )
    assigned_engineer_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus), default=JobStatus.OPEN, nullable=False
    )
    fault_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_opened: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)
    date_closed: Mapped[date | None] = mapped_column(Date, nullable=True)
    outcome: Mapped[JobOutcome | None] = mapped_column(SAEnum(JobOutcome), nullable=True)
    external_vendor_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=True
    )
    external_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    auto_created: Mapped[bool] = mapped_column(default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    device: Mapped["Device"] = relationship("Device", back_populates="refurb_jobs")
    assigned_engineer: Mapped["User | None"] = relationship(
        "User", back_populates="refurb_jobs", foreign_keys=[assigned_engineer_id]
    )
    external_vendor: Mapped["Supplier | None"] = relationship(
        "Supplier", back_populates="external_jobs", foreign_keys=[external_vendor_id]
    )
    parts_used: Mapped[list["RefurbJobPart"]] = relationship(
        "RefurbJobPart", back_populates="refurb_job", cascade="all, delete-orphan"
    )


class RefurbJobPart(Base):
    __tablename__ = "refurb_job_parts"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    job_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("refurb_jobs.id"), nullable=False
    )
    part_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("parts.id"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_cost_at_time: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    refurb_job: Mapped["RefurbJob"] = relationship("RefurbJob", back_populates="parts_used")
    part: Mapped["Part"] = relationship("Part", back_populates="refurb_job_parts")
