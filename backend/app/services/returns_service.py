from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.models.return_rma import (
    ReturnRMA, ReturnBatch, ReturnBatchStatus,
    ReturnResolution, RestockOutcome, ReturnReasonCode,
)
from app.models.device import Device, DeviceStatus, DeviceLocation
from app.models.customer import Customer
from app.models.audit_log import ReferenceType
from app.services.audit import write_audit
from app.services.device_state_machine import validate_transition
from app.core.exceptions import BadRequestError, NotFoundError


async def generate_rma_number(db: AsyncSession) -> str:
    today = date.today().strftime("%Y%m%d")
    prefix = f"RMA-{today}-"
    result = await db.execute(
        select(func.count(ReturnRMA.id)).where(ReturnRMA.rma_number.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    return f"{prefix}{str(count + 1).zfill(3)}"


async def generate_batch_number(db: AsyncSession) -> str:
    today = date.today().strftime("%Y%m%d")
    prefix = f"BATCH-{today}-"
    result = await db.execute(
        select(func.count(ReturnBatch.id)).where(ReturnBatch.batch_number.like(f"%{prefix}%"))
    )
    count = result.scalar() or 0
    return f"RMA-{prefix}{str(count + 1).zfill(3)}"


def _device_to_status_location(
    resolution: ReturnResolution,
    restock_outcome: Optional[RestockOutcome],
) -> tuple[DeviceStatus, DeviceLocation]:
    """Determine device status/location based on how an item was resolved."""
    if resolution in (ReturnResolution.SCRAP,):
        return DeviceStatus.SCRAPPED, DeviceLocation.SCRAP
    if resolution == ReturnResolution.REJECT:
        # Device was rejected — put back as SOLD (it's going back to the customer)
        return DeviceStatus.SOLD, DeviceLocation.SALES_STOCK
    if resolution == ReturnResolution.REPAIR_AND_RETURN:
        return DeviceStatus.IN_REFURB, DeviceLocation.BENCH
    if resolution in (ReturnResolution.REFUND, ReturnResolution.RESTOCK, ReturnResolution.REPLACE):
        if restock_outcome == RestockOutcome.SELLABLE:
            return DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK
        if restock_outcome in (RestockOutcome.REFURB, RestockOutcome.AWAITING_REFURB):
            return DeviceStatus.AWAITING_REFURB, DeviceLocation.INTAKE
        if restock_outcome == RestockOutcome.SCRAPPED:
            return DeviceStatus.SCRAPPED, DeviceLocation.SCRAP
        # default for refund/replace without explicit outcome
        return DeviceStatus.AWAITING_REFURB, DeviceLocation.INTAKE
    return DeviceStatus.RETURNED, DeviceLocation.INTAKE


async def _intake_device(
    db: AsyncSession,
    device: Device,
    user_id: str,
    rma_number: str,
    reason: str,
) -> None:
    """Move a SOLD device to RETURNED status during intake."""
    if device.status != DeviceStatus.SOLD:
        raise BadRequestError(
            f"Device {device.imei} must be SOLD to process a return (current: {device.status.value})"
        )
    old_status = device.status
    old_location = device.location
    validate_transition(DeviceStatus.SOLD, DeviceStatus.RETURNED, DeviceLocation.INTAKE)
    device.status = DeviceStatus.RETURNED
    device.location = DeviceLocation.INTAKE
    await write_audit(
        db,
        user_id=user_id,
        device_id=device.id,
        from_status=old_status.value,
        to_status=DeviceStatus.RETURNED.value,
        from_location=old_location.value,
        to_location=DeviceLocation.INTAKE.value,
        reference_type=ReferenceType.RETURN,
        reference_id=rma_number,
        notes=f"Return intake: {rma_number}, reason: {reason}",
    )


# ── Batch return (new) ────────────────────────────────────────────────────────

async def create_return_batch(
    db: AsyncSession,
    customer_id: str,
    items_data: list,
    user_id: str,
    original_sale_id: Optional[str] = None,
    return_date: Optional[date] = None,
    notes: Optional[str] = None,
) -> ReturnBatch:
    batch_number = await generate_batch_number(db)
    batch = ReturnBatch(
        batch_number=batch_number,
        original_sale_id=original_sale_id,
        customer_id=customer_id,
        date=return_date or date.today(),
        received_by_user_id=user_id,
        notes=notes,
        status=ReturnBatchStatus.RECEIVED,
    )
    db.add(batch)
    await db.flush()

    for item_data in items_data:
        device_result = await db.execute(
            select(Device).where(Device.id == item_data.device_id)
        )
        device = device_result.scalar_one_or_none()
        if not device:
            raise NotFoundError(f"Device {item_data.device_id} not found")

        rma_number = await generate_rma_number(db)
        await _intake_device(db, device, user_id, rma_number, item_data.reason_code.value)

        rma = ReturnRMA(
            rma_number=rma_number,
            batch_id=batch.id,
            original_sale_id=original_sale_id,
            device_id=item_data.device_id,
            customer_id=customer_id,
            date=return_date or date.today(),
            reason_code=item_data.reason_code,
            condition_on_return=item_data.condition_on_return,
            within_warranty=item_data.within_warranty,
            handled_by_user_id=user_id,
            notes=item_data.notes,
        )

        # If resolution already provided at creation time, apply it immediately
        if item_data.resolution:
            rma.resolution = item_data.resolution
            rma.refund_amount = item_data.refund_amount
            rma.restock_outcome = item_data.restock_outcome
            rma.replacement_device_id = item_data.replacement_device_id

            to_status, to_location = _device_to_status_location(
                item_data.resolution, item_data.restock_outcome
            )
            if to_status != DeviceStatus.RETURNED:
                device.status = to_status
                device.location = to_location
                await write_audit(
                    db,
                    user_id=user_id,
                    device_id=device.id,
                    from_status=DeviceStatus.RETURNED.value,
                    to_status=to_status.value,
                    from_location=DeviceLocation.INTAKE.value,
                    to_location=to_location.value,
                    reference_type=ReferenceType.RETURN,
                    reference_id=rma_number,
                    notes=f"RMA resolved at intake: {item_data.resolution.value}",
                )

            # Refund adjustments
            if item_data.refund_amount and customer_id:
                await _apply_refund(db, customer_id, item_data.refund_amount)

            # Reserve replacement device
            if item_data.replacement_device_id:
                await _reserve_replacement(db, item_data.replacement_device_id)

        db.add(rma)

    await db.flush()
    await _refresh_batch_status(db, batch)
    return batch


async def get_return_batch(db: AsyncSession, batch_id: str) -> ReturnBatch:
    result = await db.execute(
        select(ReturnBatch)
        .where(ReturnBatch.id == batch_id)
        .options(
            selectinload(ReturnBatch.items).selectinload(ReturnRMA.device),
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise NotFoundError("Return batch not found")
    return batch


async def list_return_batches(db: AsyncSession) -> list[ReturnBatch]:
    result = await db.execute(
        select(ReturnBatch)
        .options(selectinload(ReturnBatch.items).selectinload(ReturnRMA.device))
        .order_by(ReturnBatch.created_at.desc())
    )
    return list(result.scalars().all())


async def resolve_return_item(
    db: AsyncSession,
    item_id: str,
    resolution: ReturnResolution,
    user_id: str,
    refund_amount: Optional[Decimal] = None,
    restock_outcome: Optional[RestockOutcome] = None,
    replacement_device_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> ReturnRMA:
    rma_result = await db.execute(select(ReturnRMA).where(ReturnRMA.id == item_id))
    rma = rma_result.scalar_one_or_none()
    if not rma:
        raise NotFoundError("Return item not found")
    if rma.resolution is not None:
        raise BadRequestError("Return item is already resolved")

    device_result = await db.execute(select(Device).where(Device.id == rma.device_id))
    device = device_result.scalar_one_or_none()
    if not device:
        raise NotFoundError("Device not found")

    to_status, to_location = _device_to_status_location(resolution, restock_outcome)

    old_status = device.status
    old_location = device.location
    if to_status != old_status:
        device.status = to_status
        device.location = to_location
        await write_audit(
            db,
            user_id=user_id,
            device_id=device.id,
            from_status=old_status.value,
            to_status=to_status.value,
            from_location=old_location.value,
            to_location=to_location.value,
            reference_type=ReferenceType.RETURN,
            reference_id=rma.rma_number,
            notes=f"RMA resolved: {resolution.value}" + (f", outcome: {restock_outcome}" if restock_outcome else ""),
        )

    rma.resolution = resolution
    rma.refund_amount = refund_amount
    rma.restock_outcome = restock_outcome
    rma.replacement_device_id = replacement_device_id
    rma.handled_by_user_id = user_id
    if notes:
        rma.notes = notes

    if refund_amount:
        await _apply_refund(db, rma.customer_id, refund_amount)

    if replacement_device_id:
        await _reserve_replacement(db, replacement_device_id)

    if rma.batch_id:
        batch_result = await db.execute(select(ReturnBatch).where(ReturnBatch.id == rma.batch_id))
        batch = batch_result.scalar_one_or_none()
        if batch:
            await _refresh_batch_status(db, batch)

    return rma


async def update_batch_status(
    db: AsyncSession, batch_id: str, status: ReturnBatchStatus, user_id: str
) -> ReturnBatch:
    result = await db.execute(select(ReturnBatch).where(ReturnBatch.id == batch_id))
    batch = result.scalar_one_or_none()
    if not batch:
        raise NotFoundError("Return batch not found")
    batch.status = status
    return batch


async def _apply_refund(db: AsyncSession, customer_id: str, amount: Decimal) -> None:
    result = await db.execute(select(Customer).where(Customer.id == customer_id))
    customer = result.scalar_one_or_none()
    if customer:
        customer.current_balance = max(
            Decimal("0.00"),
            (customer.current_balance or Decimal("0.00")) - amount,
        )


async def _reserve_replacement(db: AsyncSession, device_id: str) -> None:
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if device:
        if device.status != DeviceStatus.SELLABLE:
            raise BadRequestError(
                f"Replacement device must be SELLABLE, got {device.status.value}"
            )
        device.status = DeviceStatus.RESERVED


async def _refresh_batch_status(db: AsyncSession, batch: ReturnBatch) -> None:
    """Auto-calculate batch status from item resolutions."""
    items_result = await db.execute(
        select(ReturnRMA).where(ReturnRMA.batch_id == batch.id)
    )
    items = list(items_result.scalars().all())
    if not items:
        return
    resolved = sum(1 for i in items if i.resolution is not None)
    total = len(items)
    if batch.status == ReturnBatchStatus.CANCELLED:
        return
    if resolved == 0:
        batch.status = ReturnBatchStatus.RECEIVED
    elif resolved < total:
        batch.status = ReturnBatchStatus.PARTIALLY_RESOLVED
    else:
        batch.status = ReturnBatchStatus.COMPLETED


# ── Legacy single-device return (kept for backward compat) ───────────────────

async def create_return(
    db: AsyncSession,
    device_id: str,
    customer_id: str,
    reason_code: ReturnReasonCode,
    user_id: str,
    original_sale_id: Optional[str] = None,
    condition_on_return: Optional[str] = None,
    within_warranty: bool = False,
    return_date: Optional[date] = None,
    notes: Optional[str] = None,
) -> ReturnRMA:
    device_result = await db.execute(select(Device).where(Device.id == device_id))
    device = device_result.scalar_one_or_none()
    if not device:
        raise NotFoundError("Device not found")

    rma_number = await generate_rma_number(db)
    await _intake_device(db, device, user_id, rma_number, reason_code.value)

    rma = ReturnRMA(
        rma_number=rma_number,
        original_sale_id=original_sale_id,
        device_id=device_id,
        customer_id=customer_id,
        date=return_date or date.today(),
        reason_code=reason_code,
        condition_on_return=condition_on_return,
        within_warranty=within_warranty,
        handled_by_user_id=user_id,
        notes=notes,
    )
    db.add(rma)
    return rma


async def resolve_return(
    db: AsyncSession,
    rma_id: str,
    resolution: ReturnResolution,
    user_id: str,
    refund_amount: Optional[Decimal] = None,
    restock_outcome: Optional[RestockOutcome] = None,
    notes: Optional[str] = None,
) -> ReturnRMA:
    return await resolve_return_item(
        db,
        item_id=rma_id,
        resolution=resolution,
        user_id=user_id,
        refund_amount=refund_amount,
        restock_outcome=restock_outcome,
        notes=notes,
    )
