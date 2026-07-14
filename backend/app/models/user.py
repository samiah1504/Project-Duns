import uuid
import enum
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, Enum as SAEnum, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    INVENTORY = "INVENTORY"
    SALES = "SALES"
    ENGINEER = "ENGINEER"
    RECORDS = "RECORDS"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    employee_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), nullable=False)
    assigned_location: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allowed_modules: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # relationships
    devices_in_custody: Mapped[list["Device"]] = relationship(
        "Device", back_populates="custody_user", foreign_keys="Device.custody_user_id"
    )
    refurb_jobs: Mapped[list["RefurbJob"]] = relationship(
        "RefurbJob", back_populates="assigned_engineer", foreign_keys="RefurbJob.assigned_engineer_id"
    )
    sales_created: Mapped[list["Sale"]] = relationship(
        "Sale", back_populates="created_by_user", foreign_keys="Sale.created_by_user_id"
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship("AuditLog", back_populates="user")
    purchase_orders_received: Mapped[list["PurchaseOrder"]] = relationship(
        "PurchaseOrder", back_populates="received_by_user", foreign_keys="PurchaseOrder.received_by_user_id"
    )
    returns_handled: Mapped[list["ReturnRMA"]] = relationship(
        "ReturnRMA", back_populates="handled_by_user", foreign_keys="ReturnRMA.handled_by_user_id"
    )
    return_batches_received: Mapped[list["ReturnBatch"]] = relationship(
        "ReturnBatch", back_populates="received_by_user", foreign_keys="ReturnBatch.received_by_user_id"
    )
    expenses_entered: Mapped[list["Expense"]] = relationship(
        "Expense", back_populates="entered_by", foreign_keys="Expense.entered_by_user_id"
    )
