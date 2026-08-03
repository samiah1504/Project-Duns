import uuid
import enum
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import String, DateTime, Date, Numeric, Text, ForeignKey, Enum as SAEnum, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class POStatus(str, enum.Enum):
    OPEN = "open"                          # legacy alias for ordered
    ORDERED = "ordered"
    PARTIALLY_RECEIVED = "partially_received"
    RECEIVED = "received"                  # legacy alias for fully_received
    FULLY_RECEIVED = "fully_received"
    CLOSED_DISCREPANCY = "closed_discrepancy"
    CANCELLED = "cancelled"


# Display label for frontend
PO_STATUS_LABELS = {
    "open": "Ordered",
    "ordered": "Ordered",
    "partially_received": "Partially Received",
    "received": "Fully Received",
    "fully_received": "Fully Received",
    "closed_discrepancy": "Closed (Discrepancy)",
    "cancelled": "Cancelled",
}


class POLineItemStatus(str, enum.Enum):
    PENDING = "pending"
    PARTIALLY_RECEIVED = "partially_received"
    FULLY_RECEIVED = "fully_received"
    NOT_RECEIVED = "not_received"
    SHORT_SUPPLIED = "short_supplied"


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
        String(30), default=POStatus.ORDERED.value, nullable=False
    )
    received_by_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_by_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )

    supplier: Mapped["Supplier"] = relationship("Supplier", back_populates="purchase_orders")
    received_by_user: Mapped["User | None"] = relationship(
        "User", back_populates="purchase_orders_received", foreign_keys=[received_by_user_id]
    )
    line_items: Mapped[list["POLineItem"]] = relationship(
        "POLineItem", back_populates="purchase_order", cascade="all, delete-orphan"
    )
    devices: Mapped[list["Device"]] = relationship("Device", back_populates="purchase_order")
    received_devices: Mapped[list["POReceivedDevice"]] = relationship(
        "POReceivedDevice", back_populates="purchase_order"
    )

    @property
    def total_ordered(self) -> int:
        return sum(li.quantity for li in self.line_items if li.line_type == POLineType.DEVICE)

    @property
    def total_received(self) -> int:
        return sum(li.received_qty or 0 for li in self.line_items if li.line_type == POLineType.DEVICE)


class POLineItem(Base):
    __tablename__ = "po_line_items"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    po_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("purchase_orders.id"), nullable=False
    )
    line_type: Mapped[str] = mapped_column(String(10), nullable=False)
    imei: Mapped[str | None] = mapped_column(String(20), nullable=True)  # legacy field
    model_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("phone_models.id"), nullable=True
    )
    grade: Mapped[str | None] = mapped_column(String(5), nullable=True)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    selling_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    part_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("parts.id"), nullable=True
    )
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    received_qty: Mapped[int] = mapped_column(Integer, default=0)
    item_status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False)
    discrepancy_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Inline device details (avoids requiring pre-created phone models)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model_name_str: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ram_str: Mapped[str | None] = mapped_column(String(20), nullable=True)
    storage_str: Mapped[str | None] = mapped_column(String(50), nullable=True)
    colour_str: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Initial device condition / routing at intake
    initial_status: Mapped[str | None] = mapped_column(String(30), nullable=True)

    purchase_order: Mapped["PurchaseOrder"] = relationship(
        "PurchaseOrder", back_populates="line_items"
    )
    model: Mapped["PhoneModel | None"] = relationship("PhoneModel", back_populates="po_line_items")
    part: Mapped["Part | None"] = relationship("Part", back_populates="po_line_items")
    received_devices: Mapped[list["POReceivedDevice"]] = relationship(
        "POReceivedDevice", back_populates="line_item"
    )

    @property
    def outstanding_qty(self) -> int:
        return max(0, self.quantity - (self.received_qty or 0))


class POReceivedDevice(Base):
    """One record per physical device received against a line item."""
    __tablename__ = "po_received_devices"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    po_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("purchase_orders.id"), nullable=False
    )
    line_item_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("po_line_items.id"), nullable=False
    )
    device_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("devices.id"), nullable=True
    )
    imei: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # Actual received spec (may differ from what was ordered)
    actual_brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    actual_model_str: Mapped[str | None] = mapped_column(String(100), nullable=True)
    actual_ram_str: Mapped[str | None] = mapped_column(String(20), nullable=True)
    actual_storage_str: Mapped[str | None] = mapped_column(String(50), nullable=True)
    actual_colour_str: Mapped[str | None] = mapped_column(String(50), nullable=True)
    actual_grade: Mapped[str | None] = mapped_column(String(5), nullable=True)
    actual_condition: Mapped[str | None] = mapped_column(String(30), nullable=True)
    selling_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    received_by_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    migrated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    purchase_order: Mapped["PurchaseOrder"] = relationship(
        "PurchaseOrder", back_populates="received_devices"
    )
    line_item: Mapped["POLineItem"] = relationship(
        "POLineItem", back_populates="received_devices"
    )
    device: Mapped["Device | None"] = relationship("Device", foreign_keys=[device_id])
