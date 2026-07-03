import uuid
import enum
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import String, DateTime, Date, Numeric, Text, ForeignKey, Enum as SAEnum, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class POStatus(str, enum.Enum):
    OPEN = "open"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class POLineType(str, enum.Enum):
    DEVICE = "device"
    PART = "part"


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    po_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    supplier_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)
    shipping_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    status: Mapped[POStatus] = mapped_column(
        SAEnum(POStatus), default=POStatus.OPEN, nullable=False
    )
    received_by_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    supplier: Mapped["Supplier"] = relationship("Supplier", back_populates="purchase_orders")
    received_by_user: Mapped["User | None"] = relationship(
        "User", back_populates="purchase_orders_received", foreign_keys=[received_by_user_id]
    )
    line_items: Mapped[list["POLineItem"]] = relationship(
        "POLineItem", back_populates="purchase_order", cascade="all, delete-orphan"
    )
    devices: Mapped[list["Device"]] = relationship("Device", back_populates="purchase_order")


class POLineItem(Base):
    __tablename__ = "po_line_items"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    po_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("purchase_orders.id"), nullable=False
    )
    line_type: Mapped[POLineType] = mapped_column(SAEnum(POLineType), nullable=False)
    imei: Mapped[str | None] = mapped_column(String(20), nullable=True)
    model_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("phone_models.id"), nullable=True
    )
    grade: Mapped[str | None] = mapped_column(String(5), nullable=True)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    part_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("parts.id"), nullable=True
    )
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Inline device details (avoids requiring pre-created phone models)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model_name_str: Mapped[str | None] = mapped_column(String(100), nullable=True)
    storage_str: Mapped[str | None] = mapped_column(String(50), nullable=True)
    colour_str: Mapped[str | None] = mapped_column(String(50), nullable=True)

    purchase_order: Mapped["PurchaseOrder"] = relationship(
        "PurchaseOrder", back_populates="line_items"
    )
    model: Mapped["PhoneModel | None"] = relationship("PhoneModel", back_populates="po_line_items")
    part: Mapped["Part | None"] = relationship("Part", back_populates="po_line_items")
