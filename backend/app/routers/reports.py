from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.permissions import records_or_admin, any_authenticated
from app.services.reports_service import (
    get_reconciliation,
    get_inventory_valuation,
    get_wip_value,
    get_engineer_performance,
    get_sales_summary,
    get_returns_analysis,
    get_low_stock_alerts,
    get_yield_conversion,
    get_expenses_summary,
)
from app.models.user import User

router = APIRouter()


@router.get("/reconciliation")
async def reconciliation(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    return await get_reconciliation(db)


@router.get("/inventory-valuation")
async def inventory_valuation(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(records_or_admin()),
):
    return await get_inventory_valuation(db)


@router.get("/wip-value")
async def wip_value(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(records_or_admin()),
):
    return await get_wip_value(db)


@router.get("/engineer-performance")
async def engineer_performance(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(records_or_admin()),
):
    return await get_engineer_performance(db)


@router.get("/sales-summary")
async def sales_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(records_or_admin()),
):
    return await get_sales_summary(db)


@router.get("/returns-analysis")
async def returns_analysis(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(records_or_admin()),
):
    return await get_returns_analysis(db)


@router.get("/low-stock-alerts")
async def low_stock_alerts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    return await get_low_stock_alerts(db)


@router.get("/yield-conversion")
async def yield_conversion(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(records_or_admin()),
):
    return await get_yield_conversion(db)


@router.get("/expenses-summary")
async def expenses_summary(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(records_or_admin()),
):
    return await get_expenses_summary(db, date_from=date_from, date_to=date_to)
