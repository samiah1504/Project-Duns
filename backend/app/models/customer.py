import uuid
import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, DateTime, JSON, Numeric, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class CustomerType(str, enum.Enum):
    WHOLESALE = "wholesale"
    RETAIL = "retail"


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[CustomerType] = mapped_column(
        SAEnum(CustomerType), default=CustomerType.RETAIL, nullable=False
    )
    contact: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    credit_limit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    current_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sales: Mapped[list["Sale"]] = relationship("Sale", back_populates="customer")
    returns: Mapped[list["ReturnRMA"]] = relationship("ReturnRMA", back_populates="customer")
    return_batches: Mapped[list["ReturnBatch"]] = relationship("ReturnBatch", back_populates="customer")
