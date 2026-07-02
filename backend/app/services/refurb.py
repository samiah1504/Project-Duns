from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.refurb_job import RefurbJob, RefurbJobPart, JobStatus, JobOutcome
from app.models.device import Device, DeviceStatus, DeviceLocation, DeviceGrade
from app.models.part import Part
from app.models.audit_log import ReferenceType
from app.services.audit import write_audit
from app.services.device_state_machine import validate_transition
from app.core.exceptions import BadRequestError, NotFoundError


async def generate_job_number(db: AsyncSession) -> str:
    today = date.today().strftime("%Y%m%d")
    prefix = f"JOB-{today}-"
    result = await db.execute(
        select(func.count(RefurbJob.id)).where(
            RefurbJob.job_number.like(f"{prefix}%")
        )
    )
    count = result.scalar() or 0
    return f"{prefix}{str(count + 1).zfill(3)}"


async def create_refurb_job(
    db: AsyncSession,
    device_id: str,
    user_id: str,
    assigned_engineer_id: Optional[str] = None,
    fault_description: Optional[str] = None,
    notes: Optional[str] = None,
) -> RefurbJob:
    device_result = await db.execute(select(Device).where(Device.id == device_id))
    device = device_result.scalar_one_or_none()
    if not device:
        raise NotFoundError("Device not found")

    if device.status not in (DeviceStatus.AWAITING_REFURB, DeviceStatus.RETURNED):
        raise BadRequestError(
            f"Device must be AWAITING_REFURB or RETURNED to open a job, got {device.status.value}"
        )

    job_number = await generate_job_number(db)
    job = RefurbJob(
        job_number=job_number,
        device_id=device_id,
        assigned_engineer_id=assigned_engineer_id,
        status=JobStatus.OPEN,
        fault_description=fault_description,
        date_opened=date.today(),
        notes=notes,
    )
    db.add(job)
    await db.flush()

    # Transition device to IN_REFURB
    old_status = device.status
    old_location = device.location
    validate_transition(old_status, DeviceStatus.IN_REFURB, DeviceLocation.BENCH)
    device.status = DeviceStatus.IN_REFURB
    device.location = DeviceLocation.BENCH
    if assigned_engineer_id:
        device.custody_user_id = assigned_engineer_id

    await write_audit(
        db,
        user_id=user_id,
        device_id=device.id,
        from_status=old_status.value,
        to_status=DeviceStatus.IN_REFURB.value,
        from_location=old_location.value,
        to_location=DeviceLocation.BENCH.value,
        reference_type=ReferenceType.JOB,
        reference_id=job.job_number,
        notes=f"Refurb job opened: {job.job_number}",
    )

    return job


async def add_parts_to_job(
    db: AsyncSession,
    job_id: str,
    parts_data: list,
    user_id: str,
) -> RefurbJob:
    job_result = await db.execute(select(RefurbJob).where(RefurbJob.id == job_id))
    job = job_result.scalar_one_or_none()
    if not job:
        raise NotFoundError("Refurb job not found")
    if job.status == JobStatus.CLOSED:
        raise BadRequestError("Cannot add parts to a closed job")

    device_result = await db.execute(select(Device).where(Device.id == job.device_id))
    device = device_result.scalar_one_or_none()

    total_parts_cost = Decimal("0.00")

    for part_data in parts_data:
        part_result = await db.execute(select(Part).where(Part.id == part_data.part_id))
        part = part_result.scalar_one_or_none()
        if not part:
            raise NotFoundError(f"Part {part_data.part_id} not found")
        if part.quantity_on_hand < part_data.quantity:
            raise BadRequestError(
                f"Insufficient stock for part {part.name}: "
                f"available {part.quantity_on_hand}, requested {part_data.quantity}"
            )

        part.quantity_on_hand -= part_data.quantity
        line_cost = part.unit_cost * part_data.quantity
        total_parts_cost += line_cost

        job_part = RefurbJobPart(
            job_id=job.id,
            part_id=part.id,
            quantity=part_data.quantity,
            unit_cost_at_time=part.unit_cost,
        )
        db.add(job_part)

        await write_audit(
            db,
            user_id=user_id,
            part_id=part.id,
            reference_type=ReferenceType.JOB,
            reference_id=job.job_number,
            notes=f"Parts consumed: -{part_data.quantity} x {part.name} for job {job.job_number}",
        )

    if device:
        device.parts_cost = (device.parts_cost or Decimal("0.00")) + total_parts_cost

    job.status = JobStatus.IN_PROGRESS
    return job


async def close_refurb_job(
    db: AsyncSession,
    job_id: str,
    outcome: JobOutcome,
    user_id: str,
    new_grade: Optional[DeviceGrade] = None,
    external_vendor_id: Optional[str] = None,
    external_cost: Optional[Decimal] = None,
    notes: Optional[str] = None,
) -> RefurbJob:
    job_result = await db.execute(select(RefurbJob).where(RefurbJob.id == job_id))
    job = job_result.scalar_one_or_none()
    if not job:
        raise NotFoundError("Refurb job not found")
    if job.status == JobStatus.CLOSED:
        raise BadRequestError("Job is already closed")

    device_result = await db.execute(select(Device).where(Device.id == job.device_id))
    device = device_result.scalar_one_or_none()
    if not device:
        raise NotFoundError("Device not found")

    old_status = device.status
    old_location = device.location

    if outcome == JobOutcome.REGRADED:
        to_status = DeviceStatus.SELLABLE
        to_location = DeviceLocation.SALES_STOCK
        if new_grade:
            device.grade = new_grade
    elif outcome == JobOutcome.SENT_EXTERNAL:
        to_status = DeviceStatus.SENT_EXTERNAL
        to_location = DeviceLocation.EXTERNAL
        if external_vendor_id:
            job.external_vendor_id = external_vendor_id
        if external_cost:
            job.external_cost = external_cost
            device.external_cost = (device.external_cost or Decimal("0.00")) + external_cost
    elif outcome == JobOutcome.SCRAPPED:
        to_status = DeviceStatus.SCRAPPED
        to_location = DeviceLocation.SCRAP
    else:
        raise BadRequestError(f"Unknown outcome: {outcome}")

    validate_transition(old_status, to_status, to_location)
    device.status = to_status
    device.location = to_location
    device.custody_user_id = None

    job.status = JobStatus.CLOSED
    job.outcome = outcome
    job.date_closed = date.today()
    if notes:
        job.notes = notes

    await write_audit(
        db,
        user_id=user_id,
        device_id=device.id,
        from_status=old_status.value,
        to_status=to_status.value,
        from_location=old_location.value,
        to_location=to_location.value,
        reference_type=ReferenceType.JOB,
        reference_id=job.job_number,
        notes=f"Job closed with outcome: {outcome.value}",
    )

    return job
