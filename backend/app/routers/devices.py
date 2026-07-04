from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional

from app.database import get_db
from app.models.device import Device, DeviceStatus, DeviceLocation
from app.models.audit_log import AuditLog
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceTransfer, DeviceOut
from app.schemas.audit_log import AuditLogOut
from app.core.auth import get_current_user
from app.core.permissions import inventory_or_admin, any_authenticated
from app.core.exceptions import NotFoundError, ConflictError
from app.services.device_state_machine import validate_transition
from app.services.audit import write_audit
from app.services.intake import generate_inventory_number
from app.models.audit_log import ReferenceType
from app.models.user import User

router = APIRouter()


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    status: Optional[DeviceStatus] = None,
    location: Optional[DeviceLocation] = None,
    model_id: Optional[str] = None,
    imei: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    q = select(Device)
    if status:
        q = q.where(Device.status == status)
    if location:
        q = q.where(Device.location == location)
    if model_id:
        q = q.where(Device.model_id == model_id)
    if imei:
        q = q.where(Device.imei.ilike(f"%{imei}%"))
    result = await db.execute(q.order_by(Device.created_at.desc()))
    return result.scalars().all()


@router.get("/sellable", response_model=list[DeviceOut])
async def list_sellable_devices(
    model_id: Optional[str] = None,
    imei: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    """Only SELLABLE devices in SALES_STOCK — the safe counter view."""
    q = select(Device).where(
        Device.status == DeviceStatus.SELLABLE,
        Device.location == DeviceLocation.SALES_STOCK,
    )
    if model_id:
        q = q.where(Device.model_id == model_id)
    if imei:
        q = q.where(Device.imei.ilike(f"%{imei}%"))
    result = await db.execute(q.order_by(Device.model_id))
    return result.scalars().all()


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
    return device


@router.get("/by-inventory/{inv_num}", response_model=DeviceOut)
async def get_device_by_inventory_number(
    inv_num: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    result = await db.execute(select(Device).where(Device.inventory_number == inv_num))
    device = result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with inventory number {inv_num} not found")
    return device


@router.get("/{imei}", response_model=DeviceOut)
async def get_device(
    imei: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    result = await db.execute(select(Device).where(Device.imei == imei))
    device = result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with IMEI {imei} not found")
    return device


@router.patch("/{imei}", response_model=DeviceOut)
async def update_device(
    imei: str,
    body: DeviceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    result = await db.execute(select(Device).where(Device.imei == imei))
    device = result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with IMEI {imei} not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(device, field, value)
    await db.commit()
    await db.refresh(device)
    return device


@router.post("/{imei}/transfer", response_model=DeviceOut)
async def transfer_device(
    imei: str,
    body: DeviceTransfer,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    result = await db.execute(select(Device).where(Device.imei == imei))
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
    await db.commit()
    await db.refresh(device)
    return device


@router.get("/{imei}/history", response_model=list[AuditLogOut])
async def device_history(
    imei: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    dev_result = await db.execute(select(Device).where(Device.imei == imei))
    device = dev_result.scalar_one_or_none()
    if not device:
        raise NotFoundError(f"Device with IMEI {imei} not found")
    logs_result = await db.execute(
        select(AuditLog)
        .where(AuditLog.device_id == device.id)
        .order_by(AuditLog.timestamp.desc())
    )
    return logs_result.scalars().all()
