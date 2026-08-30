from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional, List

from app.database import get_db
from app.models.device import Device, DeviceStatus, DeviceLocation
from app.models.model import PhoneModel
from app.models.audit_log import AuditLog
from app.models.price_change import PriceChange
from app.schemas.device import (
    DeviceCreate, DeviceUpdate, DeviceTransfer, DeviceOut,
    CostPriceUpdate, PriceChangeOut, device_to_out,
)
from app.schemas.audit_log import AuditLogOut
from app.core.auth import get_current_user
from app.core.permissions import inventory_or_admin, any_authenticated, admin_or_operations
from app.models.user import UserRole
from app.core.exceptions import NotFoundError, ConflictError, ForbiddenError
from app.services.device_state_machine import validate_transition
from app.services.audit import write_audit
from app.services.intake import generate_inventory_number
from app.models.audit_log import ReferenceType
from app.models.user import User
from decimal import Decimal

router = APIRouter()


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    status: Optional[DeviceStatus] = None,
    location: Optional[DeviceLocation] = None,
    model_id: Optional[str] = None,
    imei: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(any_authenticated()),
):
    q = select(Device).options(selectinload(Device.model))
    # SALES role sees only sellable stock (backend enforcement)
    if current_user.role == UserRole.SALES and not status:
        q = q.where(Device.status == DeviceStatus.SELLABLE)
    elif status:
        q = q.where(Device.status == status)
    if location:
        q = q.where(Device.location == location)
    if model_id:
        q = q.where(Device.model_id == model_id)
    if imei:
        q = q.where(Device.imei.ilike(f"%{imei}%"))
    result = await db.execute(q.order_by(Device.created_at.desc()))
    devices = result.scalars().all()
    return [device_to_out(d, current_user.role.value) for d in devices]


@router.get("/dashboard-counts")
async def dashboard_counts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    """Return per-status device counts for the dashboard."""
    from sqlalchemy import func as sqlfunc
    result = await db.execute(
        select(Device.status, sqlfunc.count(Device.id).label("cnt"))
        .group_by(Device.status)
    )
    rows = result.all()
    counts = {r.status.value: r.cnt for r in rows}
    return {
        "all": sum(counts.values()),
        "awaiting_refurb": counts.get("AWAITING_REFURB", 0),
        "in_refurb": counts.get("IN_REFURB", 0),
        "awaiting_qc": counts.get("AWAITING_QC", 0),
        "failed_qc": counts.get("FAILED_QC", 0),
        "sellable": counts.get("SELLABLE", 0),
        "reserved": counts.get("RESERVED", 0),
        "sold": counts.get("SOLD", 0),
        "returned": counts.get("RETURNED", 0),
        "stock_to_return": counts.get("STOCK_TO_RETURN", 0),
        "harvested": counts.get("HARVESTED", 0),
        "scrapped": counts.get("SCRAPPED", 0),
    }


@router.get("/sellable", response_model=list[DeviceOut])
async def list_sellable_devices(
    model_id: Optional[str] = None,
    imei: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(any_authenticated()),
):
    """Only SELLABLE devices in SALES_STOCK — the safe counter view."""
    q = select(Device).options(selectinload(Device.model)).where(
        Device.status == DeviceStatus.SELLABLE,
        Device.location == DeviceLocation.SALES_STOCK,
    )
    if model_id:
        q = q.where(Device.model_id == model_id)
    if imei:
        q = q.where(Device.imei.ilike(f"%{imei}%"))
    result = await db.execute(q.order_by(Device.model_id))
    devices = result.scalars().all()
    return [device_to_out(d, current_user.role.value) for d in devices]


@router.get("/pending-cost-entry", response_model=list[DeviceOut])
async def list_pending_cost_entry(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(admin_or_operations()),
):
    """Devices that have no cost price set — visible to ADMIN/OPERATIONS only."""
    q = select(Device).options(selectinload(Device.model)).where(
        (Device.purchase_cost == None) | (Device.purchase_cost == Decimal("0.00"))
    )
    result = await db.execute(q.order_by(Device.created_at.desc()))
    devices = result.scalars().all()
    return [device_to_out(d, current_user.role.value) for d in devices]


@router.post("", response_model=DeviceOut, status_code=201)
async def create_device(
    body: DeviceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    existing = await db.execute(select(Device).where(Device.imei == body.imei))
    if existing.scalar_one_or_none():
        raise ConflictError(f"IMEI {body.imei} already exists")
    inv_num = await generate_inventory_number(db)
    device = Device(**body.model_dump(), inventory_number=inv_num)
    db.add(device)
    await db.flush()
    await write_audit(
        db,
        user_id=current_user.id,
        device_id=device.id,
        to_status=device.status.value,
        to_location=device.location.value,
        reference_type=ReferenceType.TRANSFER,
        notes="Device created",
    )
    await db.commit()
    await db.refresh(device)
    return device_to_out(device, current_user.role.value)


@router.get("/by-inventory/{inv_num}", response_model=DeviceOut)
async def get_device_by_inventory_number(
    inv_num: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(any_authenticated()),
):
    result = await db.execute(select(Device).options(selectinload(Device.model)).where(Device.inventory_number == inv_num))
    device = result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with inventory number {inv_num} not found")
    return device_to_out(device, current_user.role.value)


@router.get("/{imei}", response_model=DeviceOut)
async def get_device(
    imei: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(any_authenticated()),
):
    result = await db.execute(select(Device).options(selectinload(Device.model)).where(Device.imei == imei))
    device = result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with IMEI {imei} not found")
    return device_to_out(device, current_user.role.value)


@router.patch("/{imei}", response_model=DeviceOut)
async def update_device(
    imei: str,
    body: DeviceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    result = await db.execute(select(Device).options(selectinload(Device.model)).where(Device.imei == imei))
    device = result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with IMEI {imei} not found")
    updates = body.model_dump(exclude_none=True)
    if "model_id" in updates:
        pm = await db.get(PhoneModel, updates["model_id"])
        if not pm:
            raise NotFoundError("Phone model not found")
    if "selling_price" in updates:
        new_price = updates["selling_price"]
        if new_price <= Decimal("0"):
            raise ConflictError("Selling price must be positive")
        old_price = device.selling_price
        if old_price != new_price:
            db.add(PriceChange(
                device_id=device.id,
                imei=device.imei,
                user_id=current_user.id,
                user_role=current_user.role.value,
                field="selling_price",
                old_value=old_price,
                new_value=new_price,
                action="update" if old_price is not None else "set",
            ))
            device.selling_price_set_by = current_user.id
            device.selling_price_set_at = datetime.utcnow()
    for field, value in updates.items():
        setattr(device, field, value)
    await write_audit(
        db,
        user_id=current_user.id,
        device_id=device.id,
        reference_type=ReferenceType.ADJUSTMENT,
        notes=f"Device details updated: {', '.join(updates.keys())}",
    )
    await db.commit()
    result = await db.execute(
        select(Device).options(selectinload(Device.model)).where(Device.id == device.id)
    )
    device = result.scalar_one()
    return device_to_out(device, current_user.role.value)


@router.patch("/{imei}/cost-price", response_model=DeviceOut)
async def update_cost_price(
    imei: str,
    body: CostPriceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(admin_or_operations()),
):
    """Update cost price for a device — ADMIN/OPERATIONS only. Writes audit trail."""
    result = await db.execute(select(Device).options(selectinload(Device.model)).where(Device.imei == imei))
    device = result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with IMEI {imei} not found")

    old_value = device.purchase_cost
    device.purchase_cost = body.purchase_cost
    device.cost_price_updated_by = current_user.id
    device.cost_price_updated_at = datetime.utcnow()

    log = PriceChange(
        device_id=device.id,
        imei=device.imei,
        user_id=current_user.id,
        user_role=current_user.role.value,
        field="purchase_cost",
        old_value=old_value,
        new_value=body.purchase_cost,
        action="update" if old_value and old_value != Decimal("0.00") else "set",
        notes=body.notes,
    )
    db.add(log)
    await db.commit()
    await db.refresh(device)
    return device_to_out(device, current_user.role.value)


@router.get("/{imei}/price-history", response_model=list[PriceChangeOut])
async def get_price_history(
    imei: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_or_operations()),
):
    """Price change audit trail — ADMIN/OPERATIONS only."""
    result = await db.execute(select(Device).options(selectinload(Device.model)).where(Device.imei == imei))
    device = result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with IMEI {imei} not found")
    logs = await db.execute(
        select(PriceChange)
        .where(PriceChange.device_id == device.id)
        .order_by(PriceChange.timestamp.desc())
    )
    return logs.scalars().all()


@router.post("/{imei}/transfer", response_model=DeviceOut)
async def transfer_device(
    imei: str,
    body: DeviceTransfer,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    result = await db.execute(select(Device).options(selectinload(Device.model)).where(Device.imei == imei))
    device = result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with IMEI {imei} not found")

    validate_transition(device.status, body.to_status, body.to_location)

    old_status = device.status.value
    old_location = device.location.value
    device.status = body.to_status
    device.location = body.to_location
    if body.custody_user_id is not None:
        device.custody_user_id = body.custody_user_id

    await write_audit(
        db,
        user_id=current_user.id,
        device_id=device.id,
        from_status=old_status,
        to_status=device.status.value,
        from_location=old_location,
        to_location=device.location.value,
        reference_type=ReferenceType.TRANSFER,
        notes=body.notes,
    )
    # Auto-create refurb job when device is moved to AWAITING_REFURB
    if body.to_status == DeviceStatus.AWAITING_REFURB:
        from app.services.refurb import ensure_refurb_job
        await ensure_refurb_job(db, device.id, current_user.id)

    await db.commit()
    await db.refresh(device)
    return device_to_out(device, current_user.role.value)


@router.get("/{imei}/history", response_model=list[AuditLogOut])
async def device_history(
    imei: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    dev_result = await db.execute(select(Device).options(selectinload(Device.model)).where(Device.imei == imei))
    device = dev_result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with IMEI {imei} not found")
    logs_result = await db.execute(
        select(AuditLog)
        .where(AuditLog.device_id == device.id)
        .order_by(AuditLog.timestamp.desc())
    )
    return logs_result.scalars().all()
