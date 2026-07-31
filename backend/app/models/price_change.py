import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, DateTime, Numeric, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class PriceChange(Base):
    __tablename__ = "price_changes"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    device_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("devices.id"), nullable=False
    )
    imei: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id"), nullable=False
    )
    user_role: Mapped[str] = mapped_column(String(30), nullable=False)
    field: Mapped[str] = mapped_column(String(50), nullable=False)  # 'selling_price' | 'purchase_cost'
    old_value: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    new_value: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    action: Mapped[str] = mapped_column(String(30), nullable=False)  # 'set' | 'update' | 'clear'
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    device: Mapped["Device"] = relationship("Device", foreign_keys=[device_id])
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
