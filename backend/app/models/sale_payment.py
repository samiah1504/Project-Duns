import uuid
from datetime import datetime, date

from sqlalchemy import String, DateTime, Date, Numeric, Text, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class SalePayment(Base):
    __tablename__ = "sale_payments"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    sale_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("sales.id"), nullable=False
    )
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    payment_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    payment_date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sale: Mapped["Sale"] = relationship("Sale", back_populates="payments")
