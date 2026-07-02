from datetime import datetime, date
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.purchase_order import PurchaseOrder, POLineItem, POStatus, POLineType
from app.models.device import Device, DeviceStatus, DeviceLocation, DeviceGrade
from app.models.part import Part
from app.models.audit_log import ReferenceType
from app.services.audit import write_audit
from app.core.exceptions import BadRequestError, NotFoundError, ConflictError


async def generate_po_number(db: AsyncSession) -> str:
    today = date.today().strftime("%Y%m%d")
    prefix = f"PO-{today}-"
    result = await db.execute(
        select(func.count(PurchaseOrder.id)).where(
            PurchaseOrder.po_number.like(f"{prefix}%")
        )
    )
    count = result.scalar() or 0
    return f"{prefix}{str(count + 1).zfill(3)}"


async def create_purchase_order(
    db: AsyncSession,
    supplier_id: str,
    line_items_data: list,
    shipping_cost=None,
    notes: Optional[str] = None,
    order_date: Optional[date] = None,
) -> PurchaseOrder:
    from decimal import Decimal

    po_number = await generate_po_number(db)
    po = PurchaseOrder(
        po_number=po_number,
        supplier_id=supplier_id,
        date=order_date or date.today(),
        shipping_cost=shipping_cost or Decimal("0.00"),
        notes=notes,
    )
    db.add(po)
    await db.flush()

    for item_data in line_items_data:
        line = POLineItem(
            po_id=po.id,
            line_type=item_data.line_type,
            imei=item_data.imei,
            model_id=item_data.model_id,
            grade=item_data.grade,
            unit_cost=item_data.unit_cost,
            part_id=item_data.part_id,
            quantity=item_data.quantity,
            notes=item_data.notes,
        )
        db.add(line)

    return po


async def receive_purchase_order(
    db: AsyncSession,
    po_id: str,
    user_id: str,
    notes: Optional[str] = None,
) -> PurchaseOrder:
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id)
    )
    po = result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")
    if po.status != POStatus.OPEN:
        raise BadRequestError(f"PO is already {po.status.value}")

    # Load line items
    items_result = await db.execute(
        select(POLineItem).where(POLineItem.po_id == po_id)
    )
    line_items = items_result.scalars().all()

    for item in line_items:
        if item.line_type == POLineType.DEVICE:
            if not item.imei:
                raise BadRequestError("Device line item missing IMEI")
            # Check IMEI uniqueness
            existing = await db.execute(
                select(Device).where(Device.imei == item.imei)
            )
            if existing.scalar_one_or_none():
                raise ConflictError(f"IMEI {item.imei} already exists")

            device = Device(
                imei=item.imei,
                model_id=item.model_id,
                grade=DeviceGrade(item.grade) if item.grade else DeviceGrade.C,
                status=DeviceStatus.AWAITING_REFURB,
                location=DeviceLocation.INTAKE,
                purchase_cost=item.unit_cost,
                purchase_order_id=po.id,
                supplier_id=po.supplier_id,
                date_received=date.today(),
            )
            db.add(device)
            await db.flush()

            await write_audit(
                db,
                user_id=user_id,
                device_id=device.id,
                from_status=None,
                to_status=DeviceStatus.AWAITING_REFURB.value,
                from_location=None,
                to_location=DeviceLocation.INTAKE.value,
                reference_type=ReferenceType.PO,
                reference_id=po.po_number,
                notes=f"Received via PO {po.po_number}",
            )

        elif item.line_type == POLineType.PART:
            if not item.part_id:
                raise BadRequestError("Part line item missing part_id")
            part_result = await db.execute(select(Part).where(Part.id == item.part_id))
            part = part_result.scalar_one_or_none()
            if not part:
                raise NotFoundError(f"Part {item.part_id} not found")
            part.quantity_on_hand += item.quantity

            await write_audit(
                db,
                user_id=user_id,
                part_id=part.id,
                from_location=None,
                to_location=part.location,
                reference_type=ReferenceType.PO,
                reference_id=po.po_number,
                notes=f"Stock received: +{item.quantity} via PO {po.po_number}",
            )

    po.status = POStatus.RECEIVED
    po.received_by_user_id = user_id
    po.received_at = datetime.utcnow()
    if notes:
        po.notes = notes

    return po
