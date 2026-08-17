from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional
from pydantic import BaseModel
from decimal import Decimal

from app.database import get_db
from app.models.sale import Sale, SaleLineItem, PaymentStatus
from app.models.sale_payment import SalePayment
from app.models.device import Device
from app.schemas.sale import SaleCreate, SaleOut, SalePaymentCreate, SalePaymentOut
from app.core.permissions import sales_or_admin, any_authenticated
from app.core.exceptions import NotFoundError, BadRequestError
from app.services.sales_service import create_sale
from app.models.user import User

router = APIRouter()


class AddPaymentBody(BaseModel):
    amount: Decimal
    payment_method: Optional[str] = None
    payment_date: Optional[str] = None
    notes: Optional[str] = None


def _sale_query():
    return (
        select(Sale)
        .options(
            selectinload(Sale.line_items)
            .selectinload(SaleLineItem.device)
            .selectinload(Device.model),
            selectinload(Sale.customer),
            selectinload(Sale.payments),
        )
    )


async def _fetch_sale(db: AsyncSession, sale_id: str) -> Sale:
    result = await db.execute(_sale_query().where(Sale.id == sale_id))
    sale = result.scalar_one_or_none()
    if not sale:
        raise NotFoundError("Sale not found")
    return sale


@router.get("", response_model=list[SaleOut])
async def list_sales(
    customer_id: Optional[str] = None,
    payment_status: Optional[PaymentStatus] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    q = _sale_query()
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
    import traceback
    import logging as _logging
    _log = _logging.getLogger("tardmart.sales")
    try:
        sale = await create_sale(
            db,
            customer_id=body.customer_id,
            customer_name=body.customer_name,
            customer_phone=body.customer_phone,
            customer_address=body.customer_address,
            sale_type=body.type,
            line_items_data=body.line_items,
            created_by_user_id=current_user.id,
            tax=body.tax,
            discount=body.discount,
            delivery_fee=body.delivery_fee,
            amount_paid=body.amount_paid,
            salesperson_name=body.salesperson_name,
            payment_method=body.payment_method,
            sales_channel=body.sales_channel,
            sale_date=body.date,
            notes=body.notes,
        )
        await db.commit()
        return await _fetch_sale(db, sale.id)
    except (BadRequestError, NotFoundError):
        raise
    except Exception as exc:
        _log.error("Sale creation failed: %s\n%s", exc, traceback.format_exc())
        await db.rollback()
        raise BadRequestError(f"Sale creation failed: {exc}")


@router.get("/{sale_id}", response_model=SaleOut)
async def get_sale(
    sale_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    return await _fetch_sale(db, sale_id)


@router.post("/{sale_id}/payments", response_model=SaleOut, status_code=201)
async def add_sale_payment(
    sale_id: str,
    body: AddPaymentBody,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(sales_or_admin()),
):
    from datetime import date as date_type
    sale = await _fetch_sale(db, sale_id)
    if body.amount <= Decimal("0"):
        raise BadRequestError("Payment amount must be positive")

    pay_date = date_type.today()
    if body.payment_date:
        try:
            pay_date = date_type.fromisoformat(body.payment_date)
        except ValueError:
            pass

    payment = SalePayment(
        sale_id=sale.id,
        amount=body.amount,
        payment_method=body.payment_method,
        payment_date=pay_date,
        notes=body.notes,
    )
    db.add(payment)

    sale.amount_paid = (sale.amount_paid or Decimal("0")) + body.amount
    if sale.amount_paid >= sale.total:
        sale.payment_status = PaymentStatus.PAID
        sale.amount_paid = sale.total
    else:
        sale.payment_status = PaymentStatus.PARTIAL

    from app.models.customer import Customer
    cust = (await db.execute(select(Customer).where(Customer.id == sale.customer_id))).scalar_one_or_none()
    if cust:
        cust.current_balance = max(Decimal("0"), (cust.current_balance or Decimal("0")) - body.amount)

    await db.commit()
    return await _fetch_sale(db, sale.id)


@router.post("/{sale_id}/add-payment", response_model=SaleOut)
async def add_payment_legacy(
    sale_id: str,
    body: AddPaymentBody,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(sales_or_admin()),
):
    return await add_sale_payment(sale_id, body, db, _)
