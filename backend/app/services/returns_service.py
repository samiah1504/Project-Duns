from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.return_rma import ReturnRMA, ReturnResolution, RestockOutcome, ReturnReasonCode
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

    if device.status != DeviceStatus.SOLD:
        raise BadRequestError(
            f"Device must be SOLD to process a return, got {device.status.value}"
        )

    rma_number = await generate_rma_number(db)
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
    await db.flush()

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
        reference_id=rma.rma_number,
        notes=f"Return intake: {rma.rma_number}, reason: {reason_code.value}",
    )

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
    rma_result = await db.execute(select(ReturnRMA).where(ReturnRMA.id == rma_id))
    rma = rma_result.scalar_one_or_none()
    if not rma:
        raise NotFoundError("RMA not found")
    if rma.resolution is not None:
        raise BadRequestError("RMA already resolved")

    device_result = await db.execute(select(Device).where(Device.id == rma.device_id))
    device = device_result.scalar_one_or_none()
    if not device:
        raise NotFoundError("Device not found")

    old_status = device.status
    old_location = device.location

    if resolution == ReturnResolution.RESTOCK or resolution == ReturnResolution.REPLACE or resolution == ReturnResolution.REFUND:
        if restock_outcome == RestockOutcome.SELLABLE:
            to_status = DeviceStatus.SELLABLE
            to_location = DeviceLocation.SALES_STOCK
        elif restock_outcome == RestockOutcome.REFURB:
            to_status = DeviceStatus.IN_REFURB
            to_location = DeviceLocation.BENCH
        elif restock_outcome == RestockOutcome.SCRAPPED:
            to_status = DeviceStatus.SCRAPPED
            to_location = DeviceLocation.SCRAP
        else:
            # Default: put back as sellable
            to_status = DeviceStatus.SELLABLE
            to_location = DeviceLocation.SALES_STOCK

        validate_transition(DeviceStatus.RETURNED, to_status, to_location)
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
            notes=f"RMA resolved: {resolution.value}, outcome: {restock_outcome}",
        )

    elif resolution == ReturnResolution.REPAIR_AND_RETURN:
        to_status = DeviceStatus.IN_REFURB
        to_location = DeviceLocation.BENCH
        validate_transition(DeviceStatus.RETURNED, to_status, to_location)
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
            notes=f"RMA: repair and return, new job to be opened",
        )

    rma.resolution = resolution
    rma.refund_amount = refund_amount
    rma.restock_outcome = restock_outcome
    rma.handled_by_user_id = user_id
    if notes:
        rma.notes = notes

    # Refund adjustments
    if refund_amount and rma.customer_id:
        customer_result = await db.execute(
            select(Customer).where(Customer.id == rma.customer_id)
        )
        customer = customer_result.scalar_one_or_none()
        if customer:
            customer.current_balance = max(
                Decimal("0.00"),
                (customer.current_balance or Decimal("0.00")) - refund_amount,
            )

    return rma
