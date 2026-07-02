from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.sale import Sale, SaleLineItem, SaleType, PaymentStatus
from app.models.device import Device, DeviceStatus, DeviceLocation
from app.models.part import Part
from app.models.customer import Customer
from app.models.audit_log import ReferenceType
from app.services.audit import write_audit
from app.services.device_state_machine import validate_transition
from app.core.exceptions import BadRequestError, NotFoundError


async def generate_invoice_number(db: AsyncSession) -> str:
    today = date.today().strftime("%Y%m%d")
    prefix = f"INV-{today}-"
    result = await db.execute(
        select(func.count(Sale.id)).where(Sale.invoice_number.like(f"{prefix}%"))
    )
    count = result.scalar() or 0
    return f"{prefix}{str(count + 1).zfill(3)}"


def _compute_payment_status(total: Decimal, amount_paid: Decimal) -> PaymentStatus:
    if amount_paid <= Decimal("0"):
        return PaymentStatus.UNPAID
    if amount_paid >= total:
        return PaymentStatus.PAID
    return PaymentStatus.PARTIAL


async def create_sale(
    db: AsyncSession,
    customer_id: str,
    sale_type: SaleType,
    line_items_data: list,
    created_by_user_id: str,
    tax: Decimal = Decimal("0.00"),
    sale_date: Optional[date] = None,
    notes: Optional[str] = None,
) -> Sale:
    # Validate customer
    customer_result = await db.execute(select(Customer).where(Customer.id == customer_id))
    customer = customer_result.scalar_one_or_none()
    if not customer:
        raise NotFoundError("Customer not found")

    invoice_number = await generate_invoice_number(db)
    subtotal = Decimal("0.00")

    sale = Sale(
        invoice_number=invoice_number,
        customer_id=customer_id,
        type=sale_type,
        subtotal=Decimal("0.00"),
        tax=tax,
        total=Decimal("0.00"),
        amount_paid=Decimal("0.00"),
        payment_status=PaymentStatus.UNPAID,
        date=sale_date or date.today(),
        created_by_user_id=created_by_user_id,
        notes=notes,
    )
    db.add(sale)
    await db.flush()

    for item_data in line_items_data:
        line_total = item_data.unit_price * item_data.quantity

        if item_data.device_id:
            dev_result = await db.execute(
                select(Device).where(Device.id == item_data.device_id)
            )
            device = dev_result.scalar_one_or_none()
            if not device:
                raise NotFoundError(f"Device {item_data.device_id} not found")
            if device.status != DeviceStatus.SELLABLE:
                raise BadRequestError(
                    f"Device {device.imei} is not SELLABLE (status: {device.status.value})"
                )
            if device.location != DeviceLocation.SALES_STOCK:
                raise BadRequestError(
                    f"Device {device.imei} is not in SALES_STOCK (location: {device.location.value})"
                )

            # Transition to RESERVED
            validate_transition(DeviceStatus.SELLABLE, DeviceStatus.RESERVED, DeviceLocation.SALES_STOCK)
            device.status = DeviceStatus.RESERVED
            device.sale_id = sale.id
            device.sale_price = item_data.unit_price

            await write_audit(
                db,
                user_id=created_by_user_id,
                device_id=device.id,
                from_status=DeviceStatus.SELLABLE.value,
                to_status=DeviceStatus.RESERVED.value,
                from_location=DeviceLocation.SALES_STOCK.value,
                to_location=DeviceLocation.SALES_STOCK.value,
                reference_type=ReferenceType.SALE,
                reference_id=invoice_number,
                notes=f"Reserved for invoice {invoice_number}",
            )

        if item_data.part_id:
            part_result = await db.execute(select(Part).where(Part.id == item_data.part_id))
            part = part_result.scalar_one_or_none()
            if not part:
                raise NotFoundError(f"Part {item_data.part_id} not found")
            if part.quantity_on_hand < item_data.quantity:
                raise BadRequestError(
                    f"Insufficient part stock for {part.name}: "
                    f"available {part.quantity_on_hand}, requested {item_data.quantity}"
                )
            part.quantity_on_hand -= item_data.quantity

        line = SaleLineItem(
            sale_id=sale.id,
            device_id=item_data.device_id,
            part_id=item_data.part_id,
            quantity=item_data.quantity,
            unit_price=item_data.unit_price,
            line_total=line_total,
            notes=item_data.notes,
        )
        db.add(line)
        subtotal += line_total

    sale.subtotal = subtotal
    sale.total = subtotal + tax

    # Finalise devices as SOLD
    for item_data in line_items_data:
        if item_data.device_id:
            dev_result = await db.execute(
                select(Device).where(Device.id == item_data.device_id)
            )
            device = dev_result.scalar_one_or_none()
            if device:
                validate_transition(DeviceStatus.RESERVED, DeviceStatus.SOLD, DeviceLocation.SALES_STOCK)
                device.status = DeviceStatus.SOLD

                await write_audit(
                    db,
                    user_id=created_by_user_id,
                    device_id=device.id,
                    from_status=DeviceStatus.RESERVED.value,
                    to_status=DeviceStatus.SOLD.value,
                    from_location=DeviceLocation.SALES_STOCK.value,
                    to_location=DeviceLocation.SALES_STOCK.value,
                    reference_type=ReferenceType.SALE,
                    reference_id=invoice_number,
                    notes=f"Sold on invoice {invoice_number}",
                )

    # Update customer balance
    customer.current_balance = (customer.current_balance or Decimal("0.00")) + sale.total

    return sale


async def add_payment(
    db: AsyncSession,
    sale_id: str,
    amount: Decimal,
    user_id: str,
    notes: Optional[str] = None,
) -> Sale:
    result = await db.execute(select(Sale).where(Sale.id == sale_id))
    sale = result.scalar_one_or_none()
    if not sale:
        raise NotFoundError("Sale not found")

    sale.amount_paid = (sale.amount_paid or Decimal("0.00")) + amount
    sale.payment_status = _compute_payment_status(sale.total, sale.amount_paid)

    # Update customer balance
    customer_result = await db.execute(select(Customer).where(Customer.id == sale.customer_id))
    customer = customer_result.scalar_one_or_none()
    if customer:
        customer.current_balance = max(
            Decimal("0.00"),
            (customer.current_balance or Decimal("0.00")) - amount,
        )

    return sale
