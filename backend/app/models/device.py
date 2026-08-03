import uuid
import enum
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import String, DateTime, Date, Numeric, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship, column_property
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class DeviceStatus(str, enum.Enum):
    AWAITING_REFURB = "AWAITING_REFURB"
    IN_REFURB = "IN_REFURB"
    AWAITING_QC = "AWAITING_QC"
    FAILED_QC = "FAILED_QC"
    SENT_EXTERNAL = "SENT_EXTERNAL"
    SCRAPPED = "SCRAPPED"
    SELLABLE = "SELLABLE"
    RESERVED = "RESERVED"
    SOLD = "SOLD"
    RETURNED = "RETURNED"
    STOCK_TO_RETURN = "STOCK_TO_RETURN"
    HARVESTED = "HARVESTED"


class DeviceGrade(str, enum.Enum):
    A = "A"
    B = "B"
    C = "C"


class DeviceLocation(str, enum.Enum):
    INTAKE = "INTAKE"
    BENCH = "BENCH"
    SALES_STOCK = "SALES_STOCK"
    EXTERNAL = "EXTERNAL"
    SCRAP = "SCRAP"
    QC = "QC"


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    imei: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    inventory_number: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True, index=True)
    model_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("phone_models.id"), nullable=False
    )
    grade: Mapped[DeviceGrade] = mapped_column(SAEnum(DeviceGrade, create_constraint=False, native_enum=False), nullable=False)
    status: Mapped[DeviceStatus] = mapped_column(
        SAEnum(DeviceStatus, create_constraint=False, native_enum=False), default=DeviceStatus.AWAITING_REFURB, nullable=False
    )
    location: Mapped[DeviceLocation] = mapped_column(
        SAEnum(DeviceLocation, create_constraint=False, native_enum=False), default=DeviceLocation.INTAKE, nullable=False
    )
    custody_user_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    purchase_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    parts_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    external_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    purchase_order_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("purchase_orders.id"), nullable=True
    )
    supplier_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=True
    )
    date_received: Mapped[date | None] = mapped_column(Date, nullable=True)
    sale_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sales.id"), nullable=True
    )
    sale_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    selling_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    selling_price_set_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    selling_price_set_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cost_price_updated_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=True
    )
    cost_price_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    warranty_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    model: Mapped["PhoneModel"] = relationship("PhoneModel", back_populates="devices")
    custody_user: Mapped["User | None"] = relationship(
        "User", back_populates="devices_in_custody", foreign_keys=[custody_user_id]
    )
    purchase_order: Mapped["PurchaseOrder | None"] = relationship(
        "PurchaseOrder", back_populates="devices"
    )
    supplier: Mapped["Supplier | None"] = relationship("Supplier", back_populates="devices")
    sale: Mapped["Sale | None"] = relationship(
        "Sale", back_populates="devices", foreign_keys=[sale_id]
    )
    refurb_jobs: Mapped[list["RefurbJob"]] = relationship("RefurbJob", back_populates="device")
    sale_line_items: Mapped[list["SaleLineItem"]] = relationship(
        "SaleLineItem", back_populates="device"
    )
    returns: Mapped[list["ReturnRMA"]] = relationship(
        "ReturnRMA", back_populates="device", foreign_keys="ReturnRMA.device_id"
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship("AuditLog", back_populates="device")

    @property
    def total_cost(self) -> Decimal:
        return (self.purchase_cost or Decimal("0")) + (self.parts_cost or Decimal("0")) + (self.external_cost or Decimal("0"))
