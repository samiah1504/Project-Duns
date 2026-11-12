from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.auth import get_current_user
from app.core.permissions import (
    records_or_admin, any_authenticated,
    inventory_or_admin, engineer_or_admin, sales_or_admin,
    require_roles,
)
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
    # New
    get_inventory_report,
    get_purchase_report,
    get_sales_detail_report,
    get_refurb_report,
    get_returns_detail_report,
    get_operations_summary,
    get_my_sales_dashboard,
    get_my_refurb_dashboard,
    get_ceo_dashboard,
)
from app.models.user import User

router = APIRouter()

# Admin + Records permission
def financial_access():
    return require_roles("ADMIN", "RECORDS")


# ── Existing endpoints (kept intact) ─────────────────────────────────────────

@router.get("/reconciliation")
async def reconciliation(
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    return await get_reconciliation(db, owner_id=owner_id)


@router.get("/inventory-valuation")
async def inventory_valuation(
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    return await get_inventory_valuation(db, owner_id=owner_id)


@router.get("/wip-value")
async def wip_value(
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    return await get_wip_value(db, owner_id=owner_id)


@router.get("/engineer-performance")
async def engineer_performance(
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    return await get_engineer_performance(db, owner_id=owner_id)


@router.get("/sales-summary")
async def sales_summary(
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(financial_access()),
):
    return await get_sales_summary(db, owner_id=owner_id)


@router.get("/returns-analysis")
async def returns_analysis(
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(financial_access()),
):
    return await get_returns_analysis(db, owner_id=owner_id)


@router.get("/low-stock-alerts")
async def low_stock_alerts(
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    return await get_low_stock_alerts(db, owner_id=owner_id)


@router.get("/yield-conversion")
async def yield_conversion(
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    return await get_yield_conversion(db, owner_id=owner_id)


@router.get("/expenses-summary")
async def expenses_summary(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(financial_access()),
):
    return await get_expenses_summary(db, date_from=date_from, date_to=date_to, owner_id=owner_id)


# ── New report endpoints ──────────────────────────────────────────────────────

@router.get("/inventory")
async def inventory_report(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    status: Optional[str] = Query(None),
    grade: Optional[str] = Query(None),
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    return await get_inventory_report(db, date_from=date_from, date_to=date_to, status_filter=status, grade_filter=grade, owner_id=owner_id)


@router.get("/purchases")
async def purchase_report(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    supplier_id: Optional[str] = Query(None),
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    return await get_purchase_report(db, date_from=date_from, date_to=date_to, supplier_id=supplier_id, owner_id=owner_id)


@router.get("/sales-detail")
async def sales_detail_report(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(financial_access()),
):
    return await get_sales_detail_report(db, date_from=date_from, date_to=date_to, owner_id=owner_id)


@router.get("/refurb-report")
async def refurb_report(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    engineer_id: Optional[str] = Query(None),
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    return await get_refurb_report(db, date_from=date_from, date_to=date_to, engineer_id=engineer_id, owner_id=owner_id)


@router.get("/returns-detail")
async def returns_detail_report(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(financial_access()),
):
    return await get_returns_detail_report(db, date_from=date_from, date_to=date_to, owner_id=owner_id)


@router.get("/operations-summary")
async def operations_summary(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(financial_access()),
):
    return await get_operations_summary(db, date_from=date_from, date_to=date_to, owner_id=owner_id)


@router.get("/my-sales")
async def my_sales(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(any_authenticated()),
):
    return await get_my_sales_dashboard(db, user_id=current_user.id, date_from=date_from, date_to=date_to)


@router.get("/my-refurb")
async def my_refurb(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(any_authenticated()),
):
    return await get_my_refurb_dashboard(db, user_id=current_user.id, date_from=date_from, date_to=date_to)


@router.get("/ceo-dashboard")
async def ceo_dashboard(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    owner_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles("ADMIN")),
):
    from datetime import date
    import traceback
    import logging as _logging
    from fastapi import HTTPException
    _log = _logging.getLogger("tardmart.reports")
    today = date.today()
    df = date_from or date(today.year, today.month, 1)
    dt = date_to or today
    try:
        return await get_ceo_dashboard(db, date_from=df, date_to=dt, owner_id=owner_id)
    except HTTPException:
        raise
    except Exception as exc:
        _log.error("CEO dashboard failed: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(status_code=400, detail=f"Dashboard failed: {exc}")


@router.get("/owner-statement")
async def owner_statement(
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(records_or_admin()),
):
    """Stock and accounts per stock owner (House + investors) and in total."""
    from app.services.owner_report import get_owner_statement
    return await get_owner_statement(db, date_from, date_to)
