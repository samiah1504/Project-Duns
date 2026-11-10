"""
One-off repair of refurb job data left inconsistent by older versions.

    python repair_refurb_jobs.py            # dry run: report only, changes nothing
    python repair_refurb_jobs.py --apply    # make the changes

In Docker:  docker compose -f docker-compose.prod.yml exec api python repair_refurb_jobs.py
Take a backup first (scripts/backup.sh) before running with --apply.

What it fixes
1. A device with more than one active job: the newest is kept, the others closed.
2. Active jobs for devices that already left refurb (sold, reserved, sellable,
   scrapped, harvested, sent external, stock-to-return): the job is closed.
3. Devices in refurb (awaiting refurb, in refurb, awaiting QC, failed QC) with no
   job, e.g. customer returns sent to refurb: a job is created so they can go
   through QC and back to stock.
4. Jobs whose status doesn't match the device, e.g. a job stuck "in progress"
   while the device still awaits refurb (parts added before an engineer was
   assigned): the job is put back in step with the device.
5. Customer phones from "repair & return" returns: phones left on the bench
   with no engineer and no job are put back to awaiting refurb so an engineer
   can be assigned, and their jobs are flagged as customer repairs so passing QC
   returns them to the customer instead of putting them into stock.

Devices in RETURNED status are left alone: an OPEN job there is legitimate.
Every change is written to the device's audit history.
"""
import argparse
import asyncio
from datetime import date

from sqlalchemy import select, func, or_

from app.database import AsyncSessionLocal
from app.models import *  # noqa: F401,F403 — register all mappers
from app.models.device import Device, DeviceStatus, DeviceLocation
from app.models.refurb_job import RefurbJob, JobStatus
from app.models.audit_log import ReferenceType
from app.services.audit import write_audit
from app.services.refurb import (
    sync_job_after_transfer, _ACTIVE_STATUSES, _sv, _get_active_job, _pending_customer_repair,
)

REFURB_STATUSES = [
    DeviceStatus.AWAITING_REFURB, DeviceStatus.IN_REFURB,
    DeviceStatus.AWAITING_QC, DeviceStatus.FAILED_QC,
]


def _snap(jobs):
    return {j.id: (j.job_number, _sv(j.status), j.outcome and _sv(j.outcome), j.assigned_engineer_id) for j in jobs}


async def _jobs_for(db, device_id):
    res = await db.execute(select(RefurbJob).where(RefurbJob.device_id == device_id))
    return list(res.scalars().all())


async def run(apply: bool) -> int:
    changes: list[str] = []
    async with AsyncSessionLocal() as db:
        # 1. Duplicate active jobs per device
        dup = await db.execute(
            select(RefurbJob.device_id)
            .where(RefurbJob.status.in_(_ACTIVE_STATUSES))
            .group_by(RefurbJob.device_id)
            .having(func.count(RefurbJob.id) > 1)
        )
        for (device_id,) in dup.all():
            device = (await db.execute(select(Device).where(Device.id == device_id))).scalar_one()
            res = await db.execute(
                select(RefurbJob)
                .where(RefurbJob.device_id == device_id, RefurbJob.status.in_(_ACTIVE_STATUSES))
                .order_by(RefurbJob.created_at.desc())
            )
            jobs = list(res.scalars().all())
            for old in jobs[1:]:
                old.status = JobStatus.CLOSED
                old.date_closed = date.today()
                old.notes = (old.notes + "\n" if old.notes else "") + (
                    f"Closed by data repair: duplicate of active job {jobs[0].job_number}"
                )
                changes.append(f"IMEI {device.imei}: closed duplicate job {old.job_number} (kept {jobs[0].job_number})")
                await write_audit(
                    db, user_id=None, device_id=device.id,
                    reference_type=ReferenceType.JOB, reference_id=old.job_number,
                    notes=f"Refurb data repair: closed duplicate active job {old.job_number}",
                )
        await db.flush()

        # 2–4. Bring every relevant device's job in step with the device
        active_device_ids = select(RefurbJob.device_id).where(RefurbJob.status.in_(_ACTIVE_STATUSES))
        res = await db.execute(
            select(Device).where(or_(Device.status.in_(REFURB_STATUSES), Device.id.in_(active_device_ids)))
        )
        for device in res.scalars().all():
            if device.status == DeviceStatus.RETURNED:
                continue
            rma = await _pending_customer_repair(db, device.id)
            # 5a. Repair & return phone left on the bench with nobody assigned
            if (rma and device.status == DeviceStatus.IN_REFURB and not device.custody_user_id
                    and not await _get_active_job(db, device.id)):
                old_status, old_loc = device.status.value, device.location.value
                device.status = DeviceStatus.AWAITING_REFURB
                device.location = DeviceLocation.INTAKE
                changes.append(f"IMEI {device.imei}: customer repair ({rma.rma_number}) on bench with no engineer -> AWAITING_REFURB")
                await write_audit(
                    db, user_id=None, device_id=device.id,
                    from_status=old_status, to_status=device.status.value,
                    from_location=old_loc, to_location=device.location.value,
                    reference_type=ReferenceType.RETURN, reference_id=rma.rma_number,
                    notes="Refurb data repair: customer repair queued for an engineer",
                )
            before = _snap(await _jobs_for(db, device.id))
            await sync_job_after_transfer(db, device, None)
            await db.flush()
            # 5b. Flag the active job of a pending customer repair
            active = await _get_active_job(db, device.id)
            if rma and active and not active.customer_repair:
                active.customer_repair = True
                active.notes = (active.notes + "\n" if active.notes else "") + (
                    f"Customer repair for return {rma.rma_number} — return phone to customer after QC"
                )
                changes.append(f"IMEI {device.imei}: job {active.job_number} flagged as customer repair ({rma.rma_number})")
                await write_audit(
                    db, user_id=None, device_id=device.id,
                    reference_type=ReferenceType.JOB, reference_id=active.job_number,
                    notes=f"Refurb data repair: flagged as customer repair for {rma.rma_number}",
                )
            after = _snap(await _jobs_for(db, device.id))
            if before == after:
                continue
            for jid, now in after.items():
                was = before.get(jid)
                if was == now:
                    continue
                if was is None:
                    desc = f"created job {now[0]} ({now[1]})"
                elif was[1] != now[1]:
                    desc = f"job {now[0]}: {was[1]} -> {now[1]}"
                else:
                    desc = f"job {now[0]}: engineer updated to match device custody"
                changes.append(f"IMEI {device.imei} [{device.status.value}]: {desc}")
                await write_audit(
                    db, user_id=None, device_id=device.id,
                    reference_type=ReferenceType.JOB, reference_id=now[0],
                    notes=f"Refurb data repair: {desc}",
                )

        print(f"{'APPLYING' if apply else 'DRY RUN'} — {len(changes)} change(s)")
        for c in changes:
            print("  " + c)
        if apply:
            await db.commit()
            print("Committed.")
        else:
            await db.rollback()
            print("Nothing written. Re-run with --apply to make these changes.")
    return len(changes)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    asyncio.run(run(ap.parse_args().apply))
