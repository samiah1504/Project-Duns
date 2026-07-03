from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional

from app.database import get_db
from app.models.refurb_job import RefurbJob, JobStatus
from app.schemas.refurb_job import RefurbJobCreate, RefurbJobOut, AddPartsRequest, CloseJobRequest
from app.core.permissions import engineer_or_admin, any_authenticated
from app.core.exceptions import NotFoundError
from app.services.refurb import create_refurb_job, add_parts_to_job, close_refurb_job
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
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    q = _job_query()
    if status:
        q = q.where(RefurbJob.status == status)
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
        assigned_engineer_id=body.assigned_engineer_id or current_user.id,
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


@router.post("/{job_id}/add-parts", response_model=RefurbJobOut)
async def add_parts(
    job_id: str,
    body: AddPartsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(engineer_or_admin()),
):
    job = await add_parts_to_job(db, job_id=job_id, parts_data=body.parts, user_id=current_user.id)
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
