from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError

from app.models.refurb_job import RefurbJob, RefurbJobPart, JobStatus, JobOutcome
from app.models.device import Device, DeviceStatus, DeviceLocation, DeviceGrade
from app.models.part import Part
from app.models.audit_log import ReferenceType
from app.models.return_rma import ReturnRMA, ReturnResolution
from app.models.stock_owner import StockOwner, OwnerCharge, get_house_owner_id
from app.services.audit import write_audit
from app.services.device_state_machine import validate_transition
from app.core.exceptions import BadRequestError, NotFoundError


async def generate_job_number(db: AsyncSession) -> str:
    """Next JOB-YYYYMMDD-NNN number. Uses the highest existing suffix for today
    (not a row count, which repeats numbers if a job is ever removed)."""
    today = date.today().strftime("%Y%m%d")
    prefix = f"JOB-{today}-"
    result = await db.execute(
        select(RefurbJob.job_number).where(RefurbJob.job_number.like(f"{prefix}%"))
    )
    highest = 0
    for (num,) in result.all():
        suffix = num[len(prefix):]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"{prefix}{str(highest + 1).zfill(3)}"


async def _pending_customer_repair(db: AsyncSession, device_id: str) -> Optional[ReturnRMA]:
    """The device's latest return, if it was resolved as repair & return to the
    customer — i.e. the phone in refurb belongs to the customer, not to stock."""
    result = await db.execute(
        select(ReturnRMA).where(ReturnRMA.device_id == device_id)
        .order_by(ReturnRMA.created_at.desc()).limit(1)
    )
    rma = result.scalar_one_or_none()
    if rma and rma.resolution == ReturnResolution.REPAIR_AND_RETURN:
        return rma
    return None


async def _insert_job(db: AsyncSession, **fields) -> RefurbJob:
    """Insert a refurb job with a fresh job number. If two requests pick the same
    number at the same moment, the unique index rejects one; it retries with the
    next number instead of failing with a server error.

    Jobs for a customer's phone under repair & return are flagged customer_repair."""
    if "customer_repair" not in fields:
        rma = await _pending_customer_repair(db, fields["device_id"])
        fields["customer_repair"] = rma is not None
        if rma:
            note = f"Customer repair for return {rma.rma_number} — return phone to customer after QC"
            fields["notes"] = (fields["notes"] + "\n" if fields.get("notes") else "") + note
    last_tried = 0
    for _ in range(50):
        number = await generate_job_number(db)
        # Requests still in flight aren't visible yet, so always move past the
        # number we last tried; each retry is guaranteed to make progress.
        prefix, _sep, seq = number.rpartition("-")
        seq_no = max(int(seq), last_tried + 1)
        last_tried = seq_no
        job = RefurbJob(job_number=f"{prefix}-{str(seq_no).zfill(3)}", **fields)
        try:
            async with db.begin_nested():
                db.add(job)
                await db.flush()
            return job
        except IntegrityError as exc:
            if "job_number" not in str(exc.orig):
                raise
    raise BadRequestError("Could not allocate a job number, please retry")


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


def _sv(x) -> str:
    """Status value as text. Job status/outcome columns are plain VARCHAR, so rows
    loaded from the DB hold str, while freshly-set values may be enum members."""
    return x.value if hasattr(x, "value") else str(x)


def _dev_label(device: Device) -> str:
    """Human-traceable device reference for audit notes: IMEI (+ inventory number)."""
    label = f"IMEI {device.imei}"
    if device.inventory_number:
        label += f" / {device.inventory_number}"
    return label


async def _get_active_job(db: AsyncSession, device_id: str) -> Optional[RefurbJob]:
    result = await db.execute(
        select(RefurbJob)
        .where(RefurbJob.device_id == device_id, RefurbJob.status.in_(_ACTIVE_STATUSES))
        .order_by(RefurbJob.created_at.desc())
    )
    return result.scalars().first()


async def ensure_refurb_job(
    db: AsyncSession,
    device_id: str,
    user_id: str,
) -> RefurbJob:
    """Idempotently create an OPEN refurb job for a device. Does NOT transition device status."""
    existing_job = await _get_active_job(db, device_id)
    if existing_job:
        return existing_job

    device = await _get_device(db, device_id)
    job = await _insert_job(
        db,
        device_id=device_id,
        status=JobStatus.OPEN,
        date_opened=date.today(),
        auto_created=True,
    )

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
        notes=f"Refurb job auto-created: {job.job_number} for {_dev_label(device)}",
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
    """Manual job creation. If engineer assigned, transitions device to IN_REFURB.

    Devices are normally given an OPEN job automatically when they become
    AWAITING_REFURB. If such an OPEN job already exists it is reused (fault /
    notes / engineer applied to it) rather than rejected, so "New Job" works
    for every device the page offers.
    """
    device = await _get_device(db, device_id)

    if device.status not in (DeviceStatus.AWAITING_REFURB, DeviceStatus.RETURNED, DeviceStatus.FAILED_QC):
        raise BadRequestError(
            f"Device {device.imei} must be AWAITING_REFURB, RETURNED, or FAILED_QC to open a job, "
            f"got {device.status.value}"
        )

    existing = await _get_active_job(db, device_id)
    if existing:
        if _sv(existing.status) != JobStatus.OPEN.value:
            raise BadRequestError(
                f"Device {device.imei} already has an active refurb job "
                f"{existing.job_number} ({_sv(existing.status)})"
            )
        if fault_description:
            existing.fault_description = fault_description
        if notes:
            existing.notes = (existing.notes + "\n" if existing.notes else "") + notes
        if assigned_engineer_id:
            return await assign_engineer(db, existing.id, assigned_engineer_id, user_id)
        return existing

    job = await _insert_job(
        db,
        device_id=device_id,
        status=JobStatus.OPEN,
        fault_description=fault_description,
        date_opened=date.today(),
        notes=notes,
        auto_created=False,
    )

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
        notes=f"Refurb job opened: {job.job_number} for {_dev_label(device)}",
    )

    if assigned_engineer_id:
        return await assign_engineer(db, job.id, assigned_engineer_id, user_id)
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
        raise BadRequestError(f"Can only assign engineer to an OPEN job, got {_sv(job.status)}")

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
        notes=f"Engineer assigned to {job.job_number} ({_dev_label(device)})",
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
        raise BadRequestError(f"Job must be IN_PROGRESS to complete, got {_sv(job.status)}")

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
        notes=f"Refurb complete, sent to QC: {job.job_number} ({_dev_label(device)})",
    )
    return job


def _after_successful_refurb(job: RefurbJob, device: Device) -> DeviceStatus:
    """Where a device goes once its repair is done: a customer's phone goes back
    to the customer (SOLD, still on its original sale); stock goes to SELLABLE."""
    if job.customer_repair:
        if device.status not in (DeviceStatus.AWAITING_QC, DeviceStatus.IN_REFURB, DeviceStatus.AWAITING_REFURB):
            raise BadRequestError(
                f"Device {device.imei} is {device.status.value}; cannot return it to the customer from here"
            )
        return DeviceStatus.SOLD
    validate_transition(device.status, DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK)
    return DeviceStatus.SELLABLE


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
        raise BadRequestError(f"Job must be AWAITING_QC to pass QC, got {_sv(job.status)}")

    device = await _get_device(db, job.device_id)
    old_status = device.status
    old_location = device.location

    to_status = _after_successful_refurb(job, device)
    device.status = to_status
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
        to_status=to_status.value,
        from_location=old_location.value,
        to_location=DeviceLocation.SALES_STOCK.value,
        reference_type=ReferenceType.JOB,
        reference_id=job.job_number,
        notes=(
            f"QC passed — {_dev_label(device)} repaired, READY TO RETURN TO CUSTOMER (SOLD): {job.job_number}"
            if job.customer_repair else
            f"QC passed — {_dev_label(device)} back in sales stock (SELLABLE): {job.job_number}"
        ),
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
        raise BadRequestError(f"Job must be AWAITING_QC to fail QC, got {_sv(job.status)}")

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
        notes=f"QC failed — {_dev_label(device)} returned to bench: {job.job_number}",
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
        raise BadRequestError(f"Job must be QC_FAILED to return to engineer, got {_sv(job.status)}")

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
        notes=f"Returned to engineer after QC fail: {job.job_number} ({_dev_label(device)})",
    )
    return job


async def add_parts_to_job(
    db: AsyncSession,
    job_id: str,
    parts_data: list,
    user_id: str,
) -> RefurbJob:
    """Consume parts on a job. Only while the device is with the engineer
    (IN_PROGRESS) — adding parts to an OPEN job used to flip it to IN_PROGRESS
    without moving the device to the bench, leaving the job stuck."""
    job = await _get_job(db, job_id)
    if _sv(job.status) != JobStatus.IN_PROGRESS.value:
        raise BadRequestError(
            f"Parts can only be added while the job is with an engineer (in_progress), "
            f"got {_sv(job.status)}"
        )
    if not parts_data:
        raise BadRequestError("No parts supplied")

    device = await _get_device(db, job.device_id)
    device_owner_id = device.owner_id or await get_house_owner_id(db)

    total_parts_cost = Decimal("0.00")

    for part_data in parts_data:
        if part_data.quantity < 1:
            raise BadRequestError("Part quantity must be at least 1")
        part_result = await db.execute(select(Part).where(Part.id == part_data.part_id))
        part = part_result.scalar_one_or_none()
        if not part:
            raise NotFoundError(f"Part {part_data.part_id} not found")
        if part.quantity_on_hand < part_data.quantity:
            raise BadRequestError(
                f"Insufficient stock for part {part.name}: "
                f"available {part.quantity_on_hand}, requested {part_data.quantity}"
            )

        unit_cost = part.unit_cost or Decimal("0.00")
        part.quantity_on_hand -= part_data.quantity
        line_cost = unit_cost * part_data.quantity
        total_parts_cost += line_cost

        job_part = RefurbJobPart(
            job_id=job.id,
            part_id=part.id,
            quantity=part_data.quantity,
            unit_cost_at_time=unit_cost,
        )
        db.add(job_part)

        # Part from another owner's stock: its cost still goes into this phone,
        # and the phone's owner owes the part's owner for it (a part sale at cost).
        part_owner_id = part.owner_id or await get_house_owner_id(db)
        charge_note = ""
        if part_owner_id != device_owner_id:
            db.add(OwnerCharge(
                date=date.today(),
                payer_owner_id=device_owner_id,
                payee_owner_id=part_owner_id,
                part_id=part.id,
                quantity=part_data.quantity,
                unit_cost=unit_cost,
                amount=line_cost,
                device_id=device.id,
                refurb_job_id=job.id,
                created_by_user_id=user_id,
                notes=f"{part_data.quantity} x {part.name} for job {job.job_number} ({_dev_label(device)})",
            ))
            names = dict((await db.execute(
                select(StockOwner.id, StockOwner.name).where(StockOwner.id.in_([part_owner_id, device_owner_id]))
            )).all())
            charge_note = (
                f" — part from {names.get(part_owner_id, '?')} stock; "
                f"{names.get(device_owner_id, '?')} owes {line_cost}"
            )

        await write_audit(
            db,
            user_id=user_id,
            device_id=device.id,
            part_id=part.id,
            reference_type=ReferenceType.JOB,
            reference_id=job.job_number,
            notes=(
                f"Parts consumed: -{part_data.quantity} x {part.name} "
                f"for job {job.job_number} ({_dev_label(device)}){charge_note}"
            ),
        )

    device.parts_cost = (device.parts_cost or Decimal("0.00")) + total_parts_cost
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
        to_status = _after_successful_refurb(job, device)
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

    if to_status != DeviceStatus.SOLD:  # SOLD (customer repair) is checked in _after_successful_refurb
        validate_transition(old_status, to_status, to_location)
    device.status = to_status
    device.location = to_location
    device.custody_user_id = None

    job.status = JobStatus.CLOSED
    job.outcome = outcome
    job.date_closed = date.today()
    if notes:
        job.notes = (job.notes + "\n" if job.notes else "") + f"Closed ({outcome.value}): {notes}"

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
        notes=f"Job {job.job_number} closed with outcome: {outcome.value} ({_dev_label(device)})",
    )

    return job


# Device statuses that mean the device has left the refurb pipeline, and the
# job outcome recorded when a manual transfer takes it there.
_EXIT_OUTCOMES: dict[DeviceStatus, Optional[JobOutcome]] = {
    DeviceStatus.SELLABLE: JobOutcome.REGRADED,
    DeviceStatus.SENT_EXTERNAL: JobOutcome.SENT_EXTERNAL,
    DeviceStatus.SCRAPPED: JobOutcome.SCRAPPED,
    DeviceStatus.HARVESTED: JobOutcome.SCRAPPED,
    DeviceStatus.STOCK_TO_RETURN: None,
    DeviceStatus.RESERVED: None,
    DeviceStatus.SOLD: None,
}


async def sync_job_after_transfer(
    db: AsyncSession,
    device: Device,
    user_id: str,
) -> Optional[RefurbJob]:
    """Keep the refurb job in step with a device moved via the generic
    /devices/{imei}/transfer endpoint, so jobs are never left open for devices
    that already went back to stock, and devices coming back into the refurb
    flow (e.g. from an external repairer to QC) always have a job to act on.
    """
    status = device.status
    job = await _get_active_job(db, device.id)

    if status == DeviceStatus.AWAITING_REFURB:
        if job and _sv(job.status) != JobStatus.OPEN.value:
            job.status = JobStatus.OPEN
            job.assigned_engineer_id = None
            return job
        return await ensure_refurb_job(db, device.id, user_id)

    if status in (DeviceStatus.IN_REFURB, DeviceStatus.AWAITING_QC, DeviceStatus.FAILED_QC):
        target = {
            DeviceStatus.IN_REFURB: JobStatus.IN_PROGRESS,
            DeviceStatus.AWAITING_QC: JobStatus.AWAITING_QC,
            DeviceStatus.FAILED_QC: JobStatus.QC_FAILED,
        }[status]
        if not job:
            job = await _insert_job(
                db,
                device_id=device.id,
                status=target,
                date_opened=date.today(),
                auto_created=True,
                notes="Opened automatically on device transfer",
            )
            await write_audit(
                db,
                user_id=user_id,
                device_id=device.id,
                from_status=status.value,
                to_status=status.value,
                from_location=device.location.value,
                to_location=device.location.value,
                reference_type=ReferenceType.JOB,
                reference_id=job.job_number,
                notes=f"Refurb job auto-created on transfer: {job.job_number} for {_dev_label(device)}",
            )
        else:
            job.status = target
        if status == DeviceStatus.IN_REFURB and device.custody_user_id:
            job.assigned_engineer_id = device.custody_user_id
        return job

    if status in _EXIT_OUTCOMES and job:
        outcome = _EXIT_OUTCOMES[status]
        job.status = JobStatus.CLOSED
        job.outcome = outcome
        job.date_closed = date.today()
        job.notes = (job.notes + "\n" if job.notes else "") + (
            f"Closed automatically: device transferred to {status.value}"
        )
        await write_audit(
            db,
            user_id=user_id,
            device_id=device.id,
            from_status=status.value,
            to_status=status.value,
            from_location=device.location.value,
            to_location=device.location.value,
            reference_type=ReferenceType.JOB,
            reference_id=job.job_number,
            notes=f"Job {job.job_number} closed on transfer to {status.value} ({_dev_label(device)})",
        )
        return job

    return job
