from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.return_rma import ReturnRMA
from app.schemas.return_rma import ReturnCreate, ResolveReturnRequest, ReturnOut
from app.core.permissions import sales_or_admin, any_authenticated
from app.core.exceptions import NotFoundError
from app.services.returns_service import create_return, resolve_return
from app.models.user import User

router = APIRouter()


@router.get("", response_model=list[ReturnOut])
async def list_returns(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    result = await db.execute(select(ReturnRMA).order_by(ReturnRMA.date.desc()))
    return result.scalars().all()


@router.post("", response_model=ReturnOut, status_code=201)
async def create_new_return(
    body: ReturnCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(sales_or_admin()),
):
    rma = await create_return(
        db,
        device_id=body.device_id,
        customer_id=body.customer_id,
        reason_code=body.reason_code,
        user_id=current_user.id,
        original_sale_id=body.original_sale_id,
        condition_on_return=body.condition_on_return,
        within_warranty=body.within_warranty,
        return_date=body.date,
        notes=body.notes,
    )
    await db.commit()
    await db.refresh(rma)
    return rma


@router.get("/{rma_id}", response_model=ReturnOut)
async def get_return(
    rma_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    result = await db.execute(select(ReturnRMA).where(ReturnRMA.id == rma_id))
    rma = result.scalar_one_or_none()
    if not rma:
        raise NotFoundError("Return not found")
    return rma


@router.post("/{rma_id}/resolve", response_model=ReturnOut)
async def resolve_rma(
    rma_id: str,
    body: ResolveReturnRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(sales_or_admin()),
):
    rma = await resolve_return(
        db,
        rma_id=rma_id,
        resolution=body.resolution,
        refund_amount=body.refund_amount,
        restock_outcome=body.restock_outcome,
        user_id=current_user.id,
        notes=body.notes,
    )
    await db.commit()
    await db.refresh(rma)
    return rma
