"""Stock ownership: who owns each purchase order, phone and part.

The business ("House") and each investor are stock owners. Ownership is set when
stock is received and never changes, so each owner's stock and accounts stay
separate while the totals across all owners give the overall picture.
"""
import uuid
from datetime import datetime, date as date_type
from decimal import Decimal

from sqlalchemy import String, DateTime, Date, Numeric, Text, Integer, Boolean, ForeignKey, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class StockOwner(Base):
    __tablename__ = "stock_owners"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    # Exactly one owner is the House (the business itself); it pays all expenses.
    is_house: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class OwnerCharge(Base):
    """A part from one owner's stock used in another owner's phone.

    The part's cost goes into the phone's cost (so it reduces the phone owner's
    profit once, when the phone is sold). This record is the settlement between
    the two owners: `payer` (the phone's owner) owes `payee` (the part's owner)
    `amount`, which the payee books as a part sale at cost.
    """
    __tablename__ = "owner_charges"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    date: Mapped[date_type] = mapped_column(Date, default=date_type.today, nullable=False)
    payer_owner_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("stock_owners.id"), nullable=False)
    payee_owner_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("stock_owners.id"), nullable=False)
    part_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("parts.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    device_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("devices.id"), nullable=False)
    refurb_job_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey("refurb_jobs.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    payer: Mapped["StockOwner"] = relationship("StockOwner", foreign_keys=[payer_owner_id])
    payee: Mapped["StockOwner"] = relationship("StockOwner", foreign_keys=[payee_owner_id])
    part: Mapped["Part"] = relationship("Part")
    device: Mapped["Device"] = relationship("Device")


async def get_house_owner_id(db) -> str:
    """ID of the House owner (created at startup). Used as the default owner."""
    from sqlalchemy import select
    result = await db.execute(
        select(StockOwner.id).where(StockOwner.is_house.is_(True)).order_by(StockOwner.created_at).limit(1)
    )
    house_id = result.scalar_one_or_none()
    if not house_id:
        owner = StockOwner(name="House", is_house=True)
        db.add(owner)
        await db.flush()
        house_id = owner.id
    return house_id


async def resolve_owner_id(db, owner_id: str | None) -> str:
    """Validate an owner id from a request, defaulting to House."""
    from sqlalchemy import select
    from app.core.exceptions import BadRequestError
    if not owner_id:
        return await get_house_owner_id(db)
    result = await db.execute(select(StockOwner).where(StockOwner.id == owner_id))
    owner = result.scalar_one_or_none()
    if not owner:
        raise BadRequestError("Stock owner not found")
    if not owner.active:
        raise BadRequestError(f"Stock owner {owner.name} is inactive")
    return owner.id
