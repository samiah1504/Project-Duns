import uuid
import enum
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import String, DateTime, Date, Numeric, Text, ForeignKey, Enum as SAEnum, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ReturnReasonCode(str, enum.Enum):
    DOA = "DOA"
    FAULT_DEVELOPED = "fault_developed"
    WRONG_ITEM = "wrong_item"
    NOT_AS_DESCRIBED = "not_as_described"
    BUYER_REMORSE = "buyer_remorse"
    WARRANTY_CLAIM = "warranty_claim"


class ReturnResolution(str, enum.Enum):
    REFUND = "refund"
    REPLACE = "replace"
    REPAIR_AND_RETURN = "repair_and_return"
    RESTOCK = "restock"
    REJECT = "reject"
    SCRAP = "scrap"


class RestockOutcome(str, enum.Enum):
    SELLABLE = "sellable"
    REFURB = "refurb"
    SCRAPPED = "scrapped"
    AWAITING_REFURB = "awaiting_refurb"


class ReturnBatchStatus(str, enum.Enum):
    DRAFT = "draft"
    RECEIVED = "received"
    UNDER_INSPECTION = "under_inspection"
    PARTIALLY_RESOLVED = "partially_resolved"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ReturnBatch(Base):
    """Header record for a bulk return — one batch can contain many devices."""
    __tablename__ = "return_batches"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    batch_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    original_sale_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sales.id"), nullable=True
    )
    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("customers.id"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)
    received_by_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[ReturnBatchStatus] = mapped_column(
        SAEnum(ReturnBatchStatus), nullable=False, default=ReturnBatchStatus.RECEIVED
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    items: Mapped[list["ReturnRMA"]] = relationship(
        "ReturnRMA", back_populates="batch", cascade="all, delete-orphan"
    )
    original_sale: Mapped["Sale | None"] = relationship(
        "Sale", foreign_keys=[original_sale_id], back_populates="return_batches"
    )
    customer: Mapped["Customer"] = relationship("Customer", back_populates="return_batches")
    received_by_user: Mapped["User | None"] = relationship(
        "User", back_populates="return_batches_received", foreign_keys=[received_by_user_id]
    )


class ReturnRMA(Base):
    """One returned device — always belongs to a batch (single-device returns get their own batch)."""
    __tablename__ = "return_rmas"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    rma_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    batch_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("return_batches.id"), nullable=True
    )
    original_sale_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sales.id"), nullable=True
    )
    device_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("devices.id"), nullable=False
    )
    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("customers.id"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)
    reason_code: Mapped[ReturnReasonCode] = mapped_column(
        SAEnum(ReturnReasonCode), nullable=False
    )
    condition_on_return: Mapped[str | None] = mapped_column(Text, nullable=True)
    within_warranty: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    resolution: Mapped[ReturnResolution | None] = mapped_column(
        SAEnum(ReturnResolution), nullable=True
    )
    refund_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    restock_outcome: Mapped[RestockOutcome | None] = mapped_column(
        SAEnum(RestockOutcome), nullable=True
    )
    replacement_device_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("devices.id"), nullable=True
    )
    handled_by_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    batch: Mapped["ReturnBatch | None"] = relationship("ReturnBatch", back_populates="items")
    original_sale: Mapped["Sale | None"] = relationship(
        "Sale", back_populates="returns", foreign_keys=[original_sale_id]
    )
    device: Mapped["Device"] = relationship(
        "Device", back_populates="returns", foreign_keys=[device_id]
    )
    replacement_device: Mapped["Device | None"] = relationship(
        "Device", foreign_keys=[replacement_device_id]
    )
    customer: Mapped["Customer"] = relationship("Customer", back_populates="returns")
    handled_by_user: Mapped["User | None"] = relationship(
        "User", back_populates="returns_handled", foreign_keys=[handled_by_user_id]
    )
