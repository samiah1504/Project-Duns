import uuid
import enum
from datetime import datetime

from sqlalchemy import String, DateTime, JSON, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class SupplierType(str, enum.Enum):
    SUPPLIER = "supplier"
    VENDOR = "vendor"


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    bank_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    type: Mapped[SupplierType] = mapped_column(
        SAEnum(SupplierType), default=SupplierType.SUPPLIER, nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    purchase_orders: Mapped[list["PurchaseOrder"]] = relationship(
        "PurchaseOrder", back_populates="supplier"
    )
    devices: Mapped[list["Device"]] = relationship("Device", back_populates="supplier")
    external_jobs: Mapped[list["RefurbJob"]] = relationship(
        "RefurbJob", back_populates="external_vendor", foreign_keys="RefurbJob.external_vendor_id"
    )
