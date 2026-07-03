from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.expense import Expense
from app.models.user import User
from app.schemas.expense import ExpenseCreate, ExpenseUpdate, ExpenseOut
from app.core.permissions import records_or_admin, admin_only
from app.core.exceptions import NotFoundError, ForbiddenError

router = APIRouter()


def _exp_query():
    return select(Expense).options(selectinload(Expense.entered_by))


@router.get("", response_model=list[ExpenseOut])
async def list_expenses(
    title: Optional[str] = Query(None),
    entered_by_user_id: Optional[str] = Query(None),
    date_from: Optional[date_type] = Query(None),
    date_to: Optional[date_type] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(records_or_admin()),
):
    q = _exp_query()
    if title:
        q = q.where(Expense.title.ilike(f"%{title}%"))
    if entered_by_user_id:
        q = q.where(Expense.entered_by_user_id == entered_by_user_id)
    if date_from:
        q = q.where(Expense.date >= date_from)
    if date_to:
        q = q.where(Expense.date <= date_to)
    result = await db.execute(q.order_by(Expense.date.desc(), Expense.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=ExpenseOut, status_code=201)
async def create_expense(
    body: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(records_or_admin()),
):
    expense = Expense(
        title=body.title.strip(),
        description=body.description,
        amount=body.amount,
        date=body.date,
        branch=body.branch.strip() if body.branch else None,
        entered_by_user_id=current_user.id,
    )
    db.add(expense)
    await db.commit()
    result = await db.execute(_exp_query().where(Expense.id == expense.id))
    return result.scalar_one()


@router.patch("/{expense_id}", response_model=ExpenseOut)
async def update_expense(
    expense_id: str,
    body: ExpenseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(records_or_admin()),
):
    result = await db.execute(_exp_query().where(Expense.id == expense_id))
    expense = result.scalar_one_or_none()
    if not expense:
        raise NotFoundError("Expense not found")

    role = current_user.role.value if hasattr(current_user.role, "value") else current_user.role
    if role != "ADMIN" and expense.entered_by_user_id != current_user.id:
        raise ForbiddenError("You can only edit expenses you entered")

    if body.title is not None:
        expense.title = body.title.strip()
    if body.description is not None:
        expense.description = body.description
    if body.amount is not None:
        expense.amount = body.amount
    if body.date is not None:
        expense.date = body.date
    if body.branch is not None:
        expense.branch = body.branch.strip() or None

    await db.commit()
    result = await db.execute(_exp_query().where(Expense.id == expense_id))
    return result.scalar_one()


@router.delete("/{expense_id}", status_code=204)
async def delete_expense(
    expense_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_only()),
):
    result = await db.execute(select(Expense).where(Expense.id == expense_id))
    expense = result.scalar_one_or_none()
    if not expense:
        raise NotFoundError("Expense not found")
    await db.delete(expense)
    await db.commit()
