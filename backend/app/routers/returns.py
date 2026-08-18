from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.return_rma import ReturnRMA, ReturnBatch
from app.schemas.return_rma import (
    ReturnCreate, ResolveReturnRequest, ReturnOut,
    ReturnBatchCreate, ReturnBatchOut, ReturnBatchStatusUpdate,
    ReturnItemResolve, ReturnItemOut,
)
from app.core.permissions import sales_or_admin, any_authenticated
from app.core.exceptions import NotFoundError, BadRequestError
from app.services.returns_service import (
    create_return, resolve_return,
    create_return_batch, get_return_batch, list_return_batches,
    resolve_return_item, update_batch_status,
)
from app.models.user import User

router = APIRouter()


# ── Batch endpoints ───────────────────────────────────────────────────────────

@router.get("/batches", response_model=list[ReturnBatchOut])
async def list_batches(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    import traceback
    import logging as _logging
    _log = _logging.getLogger("tardmart.returns")
    try:
        batches = await list_return_batches(db)
        # Validate each batch individually so one bad legacy row cannot
        # take down the whole list — skip and log any row that fails.
        out = []
        for b in batches:
            try:
                out.append(ReturnBatchOut.model_validate(b))
            except Exception as exc:
                _log.error("Skipping unserialisable return batch %s: %s", b.id, exc)
        return out
    except Exception as exc:
        _log.error("Return list failed: %s\n%s", exc, traceback.format_exc())
        raise BadRequestError(f"Return list failed: {exc}")


@router.post("/batches", response_model=ReturnBatchOut, status_code=201)
async def create_batch(
    body: ReturnBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(sales_or_admin()),
):
    import traceback
    import logging as _logging
    _log = _logging.getLogger("tardmart.returns")
    try:
        batch = await create_return_batch(
            db,
            customer_id=body.customer_id,
            items_data=body.items,
            user_id=current_user.id,
            original_sale_id=body.original_sale_id,
            return_date=body.date,
            notes=body.notes,
        )
        await db.commit()
        return await get_return_batch(db, batch.id)
    except (BadRequestError, NotFoundError):
        raise
    except Exception as exc:
        _log.error("Return batch creation failed: %s\n%s", exc, traceback.format_exc())
        await db.rollback()
        raise BadRequestError(f"Return creation failed: {exc}")


@router.get("/batches/{batch_id}", response_model=ReturnBatchOut)
async def get_batch(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    return await get_return_batch(db, batch_id)


@router.patch("/batches/{batch_id}/status", response_model=ReturnBatchOut)
async def set_batch_status(
    batch_id: str,
    body: ReturnBatchStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(sales_or_admin()),
):
    batch = await update_batch_status(db, batch_id, body.status, current_user.id)
    await db.commit()
    return await get_return_batch(db, batch.id)


@router.post("/batches/{batch_id}/items/{item_id}/resolve", response_model=ReturnItemOut)
async def resolve_item(
    batch_id: str,
    item_id: str,
    body: ReturnItemResolve,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(sales_or_admin()),
):
    rma = await resolve_return_item(
        db,
        item_id=item_id,
        resolution=body.resolution,
        user_id=current_user.id,
        refund_amount=body.refund_amount,
        restock_outcome=body.restock_outcome,
        replacement_device_id=body.replacement_device_id,
        notes=body.notes,
    )
    await db.commit()
    await db.refresh(rma)
    return rma


# ── Legacy single-RMA endpoints (kept for backward compat) ───────────────────

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
