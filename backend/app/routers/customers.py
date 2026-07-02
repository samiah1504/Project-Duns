from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional

from app.database import get_db
from app.models.customer import Customer
from app.schemas.customer import CustomerCreate, CustomerUpdate, CustomerOut
from app.core.permissions import sales_or_admin, any_authenticated
from app.core.exceptions import NotFoundError
from app.models.user import User

router = APIRouter()


@router.get("", response_model=list[CustomerOut])
async def list_customers(
    customer_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    q = select(Customer)
    if customer_type:
        q = q.where(Customer.type == customer_type)
    result = await db.execute(q.order_by(Customer.name))
    return result.scalars().all()


@router.post("", response_model=CustomerOut, status_code=201)
async def create_customer(
    body: CustomerCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(sales_or_admin()),
):
    customer = Customer(**body.model_dump())
    db.add(customer)
    await db.commit()
    await db.refresh(customer)
    return customer


@router.get("/{customer_id}", response_model=CustomerOut)
async def get_customer(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    result = await db.execute(select(Customer).where(Customer.id == customer_id))
    customer = result.scalar_one_or_none()
    if not customer:
        raise NotFoundError("Customer not found")
    return customer


@router.patch("/{customer_id}", response_model=CustomerOut)
async def update_customer(
    customer_id: str,
    body: CustomerUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(sales_or_admin()),
):
    result = await db.execute(select(Customer).where(Customer.id == customer_id))
    customer = result.scalar_one_or_none()
    if not customer:
        raise NotFoundError("Customer not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(customer, field, value)
    await db.commit()
    await db.refresh(customer)
    return customer
