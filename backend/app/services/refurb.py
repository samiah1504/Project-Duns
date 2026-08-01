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


async def _get_device(db: AsyncSession, device_id: str) -> Device:
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise NotFoundError("Device not found")
    return device


async def _get_job(db: AsyncSession, job_id: str) -> RefurbJob:
    result = await db.execute(select(RefurbJob).where(RefurbJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise NotFoundError("Refurb job not found")
    return job


_ACTIVE_STATUSES = [JobStatus.OPEN, JobStatus.IN_PROGRESS, JobStatus.AWAITING_QC, JobStatus.QC_FAILED]


async def ensure_refurb_job(
    db: AsyncSession,
    device_id: str,
    user_id: str,
) -> RefurbJob:
    """Idempotently create an OPEN refurb job for a device. Does NOT transition device status."""
    existing = await db.execute(
        select(RefurbJob).where(
            RefurbJob.device_id == device_id,
            RefurbJob.status.in_(_ACTIVE_STATUSES),
        )
    )
    existing_job = existing.scalar_one_or_none()
    if existing_job:
        return existing_job

    device = await _get_device(db, device_id)
    job_number = await generate_job_number(db)
    job = RefurbJob(
        job_number=job_number,
        device_id=device_id,
        status=JobStatus.OPEN,
        date_opened=date.today(),
        auto_created=True,
    )
    db.add(job)
    await db.flush()

    await write_audit(
        db,
        user_id=user_id,
        device_id=device.id,
        from_status=device.status.value,
        to_status=device.status.value,
        from_location=device.location.value,
        to_location=device.location.value,
        reference_type=ReferenceType.JOB,
        reference_id=job.job_number,
        notes=f"Refurb job auto-created: {job.job_number}",
    )
    return job


async def create_refurb_job(
    db: AsyncSession,
    device_id: str,
    user_id: str,
    assigned_engineer_id: Optional[str] = None,
    fault_description: Optional[str] = None,
    notes: Optional[str] = None,
) -> RefurbJob:
    """Manual job creation. If engineer assigned, transitions device to IN_REFURB."""
    device = await _get_device(db, device_id)

    if device.status not in (DeviceStatus.AWAITING_REFURB, DeviceStatus.RETURNED, DeviceStatus.FAILED_QC):
        raise BadRequestError(
            f"Device must be AWAITING_REFURB, RETURNED, or FAILED_QC to open a job, got {device.status.value}"
        )

    existing = await db.execute(
        select(RefurbJob).where(
            RefurbJob.device_id == device_id,
            RefurbJob.status.in_(_ACTIVE_STATUSES),
        )
    )
    if existing.scalar_one_or_none():
        raise BadRequestError("Device already has an active refurb job")

    job_number = await generate_job_number(db)
    job = RefurbJob(
        job_number=job_number,
        device_id=device_id,
        assigned_engineer_id=assigned_engineer_id,
        status=JobStatus.OPEN,
        fault_description=fault_description,
        date_opened=date.today(),
        notes=notes,
        auto_created=False,
    )
    db.add(job)
    await db.flush()

    if assigned_engineer_id:
        old_status = device.status
        old_location = device.location
        validate_transition(old_status, DeviceStatus.IN_REFURB, DeviceLocation.BENCH)
        device.status = DeviceStatus.IN_REFURB
        device.location = DeviceLocation.BENCH
        device.custody_user_id = assigned_engineer_id
        job.status = JobStatus.IN_PROGRESS

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
            notes=f"Refurb job opened with engineer: {job.job_number}",
        )
    else:
        await write_audit(
            db,
            user_id=user_id,
            device_id=device.id,
            from_status=device.status.value,
            to_status=device.status.value,
            from_location=device.location.value,
            to_location=device.location.value,
            reference_type=ReferenceType.JOB,
            reference_id=job.job_number,
            notes=f"Refurb job opened (awaiting engineer): {job.job_number}",
        )

    return job


async def assign_engineer(
    db: AsyncSession,
    job_id: str,
    engineer_id: str,
    user_id: str,
    fault_description: Optional[str] = None,
) -> RefurbJob:
    """Assign engineer to OPEN job and transition device to IN_REFURB."""
    job = await _get_job(db, job_id)
    if job.status not in (JobStatus.OPEN,):
        raise BadRequestError(f"Can only assign engineer to an OPEN job, got {job.status.value}")

    device = await _get_device(db, job.device_id)
    old_status = device.status
    old_location = device.location

    validate_transition(old_status, DeviceStatus.IN_REFURB, DeviceLocation.BENCH)
    device.status = DeviceStatus.IN_REFURB
    device.location = DeviceLocation.BENCH
    device.custody_user_id = engineer_id

    job.assigned_engineer_id = engineer_id
    job.status = JobStatus.IN_PROGRESS
    if fault_description:
        job.fault_description = fault_description

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
        notes=f"Engineer assigned to {job.job_number}",
    )
    return job


async def complete_refurb(
    db: AsyncSession,
    job_id: str,
    user_id: str,
    notes: Optional[str] = None,
) -> RefurbJob:
    """Engineer marks refurb done — device moves to AWAITING_QC."""
    job = await _get_job(db, job_id)
    if job.status != JobStatus.IN_PROGRESS:
        raise BadRequestError(f"Job must be IN_PROGRESS to complete, got {job.status.value}")

    device = await _get_device(db, job.device_id)
    old_status = device.status
    old_location = device.location

    validate_transition(old_status, DeviceStatus.AWAITING_QC, DeviceLocation.QC)
    device.status = DeviceStatus.AWAITING_QC
    device.location = DeviceLocation.QC
    device.custody_user_id = None

    job.status = JobStatus.AWAITING_QC
    if notes:
        job.notes = (job.notes or "") + f"\nRefurb complete: {notes}"

    await write_audit(
        db,
        user_id=user_id,
        device_id=device.id,
        from_status=old_status.value,
        to_status=DeviceStatus.AWAITING_QC.value,
        from_location=old_location.value,
        to_location=DeviceLocation.QC.value,
        reference_type=ReferenceType.JOB,
        reference_id=job.job_number,
        notes=f"Refurb complete, sent to QC: {job.job_number}",
    )
    return job


async def pass_qc(
    db: AsyncSession,
    job_id: str,
    user_id: str,
    new_grade: Optional[DeviceGrade] = None,
    notes: Optional[str] = None,
) -> RefurbJob:
    """QC passed — device moves to SELLABLE, job closes."""
    job = await _get_job(db, job_id)
    if job.status != JobStatus.AWAITING_QC:
        raise BadRequestError(f"Job must be AWAITING_QC to pass QC, got {job.status.value}")

    device = await _get_device(db, job.device_id)
    old_status = device.status
    old_location = device.location

    validate_transition(old_status, DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK)
    device.status = DeviceStatus.SELLABLE
    device.location = DeviceLocation.SALES_STOCK
    device.custody_user_id = None
    if new_grade:
        device.grade = new_grade

    job.status = JobStatus.CLOSED
    job.outcome = JobOutcome.REGRADED
    job.date_closed = date.today()
    if notes:
        job.notes = (job.notes or "") + f"\nQC passed: {notes}"

    await write_audit(
        db,
        user_id=user_id,
        device_id=device.id,
        from_status=old_status.value,
        to_status=DeviceStatus.SELLABLE.value,
        from_location=old_location.value,
        to_location=DeviceLocation.SALES_STOCK.value,
        reference_type=ReferenceType.JOB,
        reference_id=job.job_number,
        notes=f"QC passed — device now SELLABLE: {job.job_number}",
    )
    return job


async def fail_qc(
    db: AsyncSession,
    job_id: str,
    user_id: str,
    notes: Optional[str] = None,
) -> RefurbJob:
    """QC failed — device moves to FAILED_QC."""
    job = await _get_job(db, job_id)
    if job.status != JobStatus.AWAITING_QC:
        raise BadRequestError(f"Job must be AWAITING_QC to fail QC, got {job.status.value}")

    device = await _get_device(db, job.device_id)
    old_status = device.status
    old_location = device.location

    validate_transition(old_status, DeviceStatus.FAILED_QC, DeviceLocation.BENCH)
    device.status = DeviceStatus.FAILED_QC
    device.location = DeviceLocation.BENCH

    job.status = JobStatus.QC_FAILED
    if notes:
        job.notes = (job.notes or "") + f"\nQC failed: {notes}"

    await write_audit(
        db,
        user_id=user_id,
        device_id=device.id,
        from_status=old_status.value,
        to_status=DeviceStatus.FAILED_QC.value,
        from_location=old_location.value,
        to_location=DeviceLocation.BENCH.value,
        reference_type=ReferenceType.JOB,
        reference_id=job.job_number,
        notes=f"QC failed — returned to bench: {job.job_number}",
    )
    return job


async def return_to_engineer(
    db: AsyncSession,
    job_id: str,
    user_id: str,
    engineer_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> RefurbJob:
    """Return device from QC_FAILED back to engineer for rework."""
    job = await _get_job(db, job_id)
    if job.status != JobStatus.QC_FAILED:
        raise BadRequestError(f"Job must be QC_FAILED to return to engineer, got {job.status.value}")

    device = await _get_device(db, job.device_id)
    old_status = device.status
    old_location = device.location

    validate_transition(old_status, DeviceStatus.IN_REFURB, DeviceLocation.BENCH)
    device.status = DeviceStatus.IN_REFURB
    device.location = DeviceLocation.BENCH

    eid = engineer_id or job.assigned_engineer_id
    if eid:
        device.custody_user_id = eid
        job.assigned_engineer_id = eid

    job.status = JobStatus.IN_PROGRESS
    if notes:
        job.notes = (job.notes or "") + f"\nReturned to engineer: {notes}"

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
        notes=f"Returned to engineer after QC fail: {job.job_number}",
    )
    return job


async def add_parts_to_job(
    db: AsyncSession,
    job_id: str,
    parts_data: list,
    user_id: str,
) -> RefurbJob:
    job = await _get_job(db, job_id)
    if job.status == JobStatus.CLOSED:
        raise BadRequestError("Cannot add parts to a closed job")

    device = await _get_device(db, job.device_id)

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

    device.parts_cost = (device.parts_cost or Decimal("0.00")) + total_parts_cost

    if job.status == JobStatus.OPEN:
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
    """Direct close — for SENT_EXTERNAL and SCRAPPED. REGRADED bypasses QC (admin use)."""
    job = await _get_job(db, job_id)
    if job.status == JobStatus.CLOSED:
        raise BadRequestError("Job is already closed")

    device = await _get_device(db, job.device_id)
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
