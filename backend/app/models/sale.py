import uuid
import enum
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import String, DateTime, Date, Numeric, Text, ForeignKey, Enum as SAEnum, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class SaleType(str, enum.Enum):
    WHOLESALE = "wholesale"
    RETAIL = "retail"


class PaymentStatus(str, enum.Enum):
    PAID = "paid"
    PARTIAL = "partial"
    ON_ACCOUNT = "on_account"
    UNPAID = "unpaid"


class PaymentMethod(str, enum.Enum):
    CASH = "cash"
    TRANSFER = "transfer"
    POS = "pos"
    CREDIT = "credit"


class SalesChannel(str, enum.Enum):
    WALK_IN = "walk_in"
    WHATSAPP = "whatsapp"
    INSTAGRAM = "instagram"


class Sale(Base):
    __tablename__ = "sales"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    invoice_number: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False, index=True
    )
    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("customers.id"), nullable=False
    )
    type: Mapped[SaleType] = mapped_column(SAEnum(SaleType, create_constraint=False, native_enum=False), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    payment_status: Mapped[PaymentStatus] = mapped_column(
        SAEnum(PaymentStatus, create_constraint=False, native_enum=False), default=PaymentStatus.UNPAID, nullable=False
    )
    date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=False
    )
    salesperson_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sales_channel: Mapped[str | None] = mapped_column(String(50), nullable=True)
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False, server_default="0")
    delivery_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False, server_default="0")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    customer: Mapped["Customer"] = relationship("Customer", back_populates="sales")
    created_by_user: Mapped["User"] = relationship(
        "User", back_populates="sales_created", foreign_keys=[created_by_user_id]
    )
    line_items: Mapped[list["SaleLineItem"]] = relationship(
        "SaleLineItem", back_populates="sale", cascade="all, delete-orphan"
    )
    devices: Mapped[list["Device"]] = relationship(
        "Device", back_populates="sale", foreign_keys="Device.sale_id"
    )
    returns: Mapped[list["ReturnRMA"]] = relationship(
        "ReturnRMA", back_populates="original_sale", foreign_keys="ReturnRMA.original_sale_id"
    )
    return_batches: Mapped[list["ReturnBatch"]] = relationship(
        "ReturnBatch", back_populates="original_sale", foreign_keys="ReturnBatch.original_sale_id"
    )
    payments: Mapped[list["SalePayment"]] = relationship(
        "SalePayment", back_populates="sale", cascade="all, delete-orphan", order_by="SalePayment.created_at"
    )

    @property
    def balance(self) -> Decimal:
        return (self.total or Decimal("0")) - (self.amount_paid or Decimal("0"))


class SaleLineItem(Base):
    __tablename__ = "sale_line_items"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    sale_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sales.id"), nullable=False
    )
    device_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("devices.id"), nullable=True
    )
    part_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("parts.id"), nullable=True
    )
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    sale: Mapped["Sale"] = relationship("Sale", back_populates="line_items")
    device: Mapped["Device | None"] = relationship("Device", back_populates="sale_line_items")
    part: Mapped["Part | None"] = relationship("Part", back_populates="sale_line_items")
