from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from pydantic import BaseModel
from decimal import Decimal

from app.database import get_db
from app.models.sale import Sale, PaymentStatus
from app.schemas.sale import SaleCreate, SaleOut
from app.core.permissions import sales_or_admin, any_authenticated
from app.core.exceptions import NotFoundError, BadRequestError
from app.services.sales_service import create_sale
from app.models.user import User

router = APIRouter()


class AddPaymentBody(BaseModel):
    amount: Decimal
    notes: Optional[str] = None


@router.get("", response_model=list[SaleOut])
async def list_sales(
    customer_id: Optional[str] = None,
    payment_status: Optional[PaymentStatus] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    q = select(Sale)
    if customer_id:
        q = q.where(Sale.customer_id == customer_id)
    if payment_status:
        q = q.where(Sale.payment_status == payment_status)
    result = await db.execute(q.order_by(Sale.date.desc()))
    return result.scalars().all()


@router.post("", response_model=SaleOut, status_code=201)
async def create_new_sale(
    body: SaleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(sales_or_admin()),
):
    sale = await create_sale(
        db,
        customer_id=body.customer_id,
        sale_type=body.type,
        line_items_data=body.line_items,
        created_by_user_id=current_user.id,
        tax=body.tax,
        sale_date=body.date,
        notes=body.notes,
    )
    await db.commit()
    await db.refresh(sale)
    return sale


@router.get("/{sale_id}", response_model=SaleOut)
async def get_sale(
    sale_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    result = await db.execute(select(Sale).where(Sale.id == sale_id))
    sale = result.scalar_one_or_none()
    if not sale:
        raise NotFoundError("Sale not found")
    return sale


@router.post("/{sale_id}/add-payment", response_model=SaleOut)
async def add_payment(
    sale_id: str,
    body: AddPaymentBody,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(sales_or_admin()),
):
    result = await db.execute(select(Sale).where(Sale.id == sale_id))
    sale = result.scalar_one_or_none()
    if not sale:
        raise NotFoundError("Sale not found")
    if body.amount <= Decimal("0"):
        raise BadRequestError("Payment amount must be positive")

    sale.amount_paid += body.amount
    if sale.amount_paid >= sale.total:
        sale.payment_status = PaymentStatus.PAID
        sale.amount_paid = sale.total
    else:
        sale.payment_status = PaymentStatus.PARTIAL

    # update customer balance
    from app.models.customer import Customer
    cust_result = await db.execute(select(Customer).where(Customer.id == sale.customer_id))
    customer = cust_result.scalar_one_or_none()
    if customer:
        customer.current_balance = max(Decimal("0"), customer.current_balance - body.amount)

    await db.commit()
    await db.refresh(sale)
    return sale
