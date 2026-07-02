import uuid
import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, DateTime, Integer, Numeric, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class PartType(str, enum.Enum):
    SCREEN = "screen"
    BATTERY = "battery"
    CHARGING_PORT = "charging_port"
    FLEX = "flex"
    BACK_GLASS = "back_glass"
    OTHER = "other"


class PartSource(str, enum.Enum):
    IMPORTED = "imported"
    HARVESTED = "harvested"


class Part(Base):
    __tablename__ = "parts"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[PartType] = mapped_column(SAEnum(PartType), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True, index=True)
    quantity_on_hand: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"))
    location: Mapped[str | None] = mapped_column(String(50), nullable=True)
    min_stock_level: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    source: Mapped[PartSource] = mapped_column(
        SAEnum(PartSource), default=PartSource.IMPORTED, nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    refurb_job_parts: Mapped[list["RefurbJobPart"]] = relationship(
        "RefurbJobPart", back_populates="part"
    )
    po_line_items: Mapped[list["POLineItem"]] = relationship("POLineItem", back_populates="part")
    sale_line_items: Mapped[list["SaleLineItem"]] = relationship(
        "SaleLineItem", back_populates="part"
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship("AuditLog", back_populates="part")
