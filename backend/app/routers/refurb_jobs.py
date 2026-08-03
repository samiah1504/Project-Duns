from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional

from app.database import get_db
from app.models.refurb_job import RefurbJob, JobStatus
from app.schemas.refurb_job import (
    RefurbJobCreate, RefurbJobOut, AddPartsRequest, CloseJobRequest,
    AssignEngineerRequest, CompleteRefurbRequest, QCPassRequest, QCFailRequest,
    ReturnToEngineerRequest,
)
from app.core.permissions import engineer_or_admin, any_authenticated, inventory_or_admin, engineer_or_inventory
from app.core.exceptions import NotFoundError
from app.services.refurb import (
    create_refurb_job, add_parts_to_job, close_refurb_job,
    assign_engineer, complete_refurb, pass_qc, fail_qc, return_to_engineer,
)
from app.models.user import User

router = APIRouter()


def _job_query():
    return select(RefurbJob).options(selectinload(RefurbJob.parts_used))


async def _fetch_job(db: AsyncSession, job_id: str) -> RefurbJob:
    result = await db.execute(_job_query().where(RefurbJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise NotFoundError("Refurb job not found")
    return job


@router.get("", response_model=list[RefurbJobOut])
async def list_jobs(
    status: Optional[JobStatus] = None,
    engineer_id: Optional[str] = None,
    active_only: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    q = _job_query()
    if status:
        q = q.where(RefurbJob.status == status)
    elif active_only:
        q = q.where(RefurbJob.status.in_([
            JobStatus.OPEN, JobStatus.IN_PROGRESS, JobStatus.AWAITING_QC, JobStatus.QC_FAILED,
        ]))
    if engineer_id:
        q = q.where(RefurbJob.assigned_engineer_id == engineer_id)
    result = await db.execute(q.order_by(RefurbJob.date_opened.desc()))
    return result.scalars().all()


@router.post("", response_model=RefurbJobOut, status_code=201)
async def create_job(
    body: RefurbJobCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(engineer_or_admin()),
):
    job = await create_refurb_job(
        db,
        device_id=body.device_id,
        user_id=current_user.id,
        assigned_engineer_id=body.assigned_engineer_id,
        fault_description=body.fault_description,
        notes=body.notes,
    )
    await db.commit()
    return await _fetch_job(db, job.id)


@router.get("/{job_id}", response_model=RefurbJobOut)
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    return await _fetch_job(db, job_id)


@router.post("/{job_id}/assign", response_model=RefurbJobOut)
async def assign_engineer_endpoint(
    job_id: str,
    body: AssignEngineerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    """Assign an engineer to an OPEN job — transitions device to IN_REFURB."""
    job = await assign_engineer(
        db,
        job_id=job_id,
        engineer_id=body.engineer_id,
        user_id=current_user.id,
        fault_description=body.fault_description,
    )
    await db.commit()
    return await _fetch_job(db, job.id)


@router.post("/{job_id}/add-parts", response_model=RefurbJobOut)
async def add_parts(
    job_id: str,
    body: AddPartsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(engineer_or_inventory()),
):
    job = await add_parts_to_job(db, job_id=job_id, parts_data=body.parts, user_id=current_user.id)
    await db.commit()
    return await _fetch_job(db, job.id)


@router.post("/{job_id}/complete", response_model=RefurbJobOut)
async def complete_job(
    job_id: str,
    body: CompleteRefurbRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(engineer_or_admin()),
):
    """Engineer marks refurb done — device moves to AWAITING_QC."""
    job = await complete_refurb(
        db,
        job_id=job_id,
        user_id=current_user.id,
        notes=body.notes,
    )
    await db.commit()
    return await _fetch_job(db, job.id)


@router.post("/{job_id}/qc-pass", response_model=RefurbJobOut)
async def qc_pass(
    job_id: str,
    body: QCPassRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    """QC passed — device moves to SELLABLE, job closes."""
    job = await pass_qc(
        db,
        job_id=job_id,
        user_id=current_user.id,
        new_grade=body.new_grade,
        notes=body.notes,
    )
    await db.commit()
    return await _fetch_job(db, job.id)


@router.post("/{job_id}/qc-fail", response_model=RefurbJobOut)
async def qc_fail(
    job_id: str,
    body: QCFailRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    """QC failed — device moves to FAILED_QC."""
    job = await fail_qc(
        db,
        job_id=job_id,
        user_id=current_user.id,
        notes=body.notes,
    )
    await db.commit()
    return await _fetch_job(db, job.id)


@router.post("/{job_id}/return-to-engineer", response_model=RefurbJobOut)
async def return_to_eng(
    job_id: str,
    body: ReturnToEngineerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    """Return device from QC_FAILED back to engineer for rework."""
    job = await return_to_engineer(
        db,
        job_id=job_id,
        user_id=current_user.id,
        engineer_id=body.engineer_id,
        notes=body.notes,
    )
    await db.commit()
    return await _fetch_job(db, job.id)


@router.post("/{job_id}/close", response_model=RefurbJobOut)
async def close_job(
    job_id: str,
    body: CloseJobRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(engineer_or_admin()),
):
    job = await close_refurb_job(
        db,
        job_id=job_id,
        outcome=body.outcome,
        new_grade=body.new_grade,
        external_vendor_id=body.external_vendor_id,
        external_cost=body.external_cost,
        notes=body.notes,
        user_id=current_user.id,
    )
    await db.commit()
    return await _fetch_job(db, job.id)
