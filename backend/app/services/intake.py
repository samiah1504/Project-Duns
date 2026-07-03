from datetime import datetime, date
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.purchase_order import PurchaseOrder, POLineItem, POStatus, POLineType
from app.models.device import Device, DeviceStatus, DeviceLocation, DeviceGrade
from app.models.model import PhoneModel
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


async def _find_or_create_phone_model(
    db: AsyncSession,
    brand: str,
    model_name: str,
    storage: Optional[str],
    colour: Optional[str],
) -> PhoneModel:
    """Find an existing PhoneModel or create one."""
    q = select(PhoneModel).where(
        PhoneModel.brand == brand,
        PhoneModel.model_name == model_name,
    )
    if storage:
        q = q.where(PhoneModel.storage == storage)
    if colour:
        q = q.where(PhoneModel.colour == colour)

    result = await db.execute(q)
    pm = result.scalar_one_or_none()
    if pm:
        return pm

    pm = PhoneModel(brand=brand, model_name=model_name, storage=storage, colour=colour)
    db.add(pm)
    await db.flush()
    return pm


async def create_purchase_order(
    db: AsyncSession,
    supplier_id: str,
    line_items_data: list,
    shipping_cost=None,
    notes: Optional[str] = None,
    order_date: Optional[date] = None,
    user_id: Optional[str] = None,
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
        # Resolve model_id: use explicit FK or find/create from inline fields
        model_id = item_data.model_id
        if not model_id and item_data.brand and item_data.model_name_str:
            pm = await _find_or_create_phone_model(
                db,
                brand=item_data.brand,
                model_name=item_data.model_name_str,
                storage=item_data.storage_str,
                colour=item_data.colour_str,
            )
            model_id = pm.id

        line = POLineItem(
            po_id=po.id,
            line_type=item_data.line_type,
            imei=item_data.imei,
            model_id=model_id,
            grade=item_data.grade,
            unit_cost=item_data.unit_cost,
            part_id=item_data.part_id,
            quantity=item_data.quantity,
            notes=item_data.notes,
            brand=item_data.brand,
            model_name_str=item_data.model_name_str,
            storage_str=item_data.storage_str,
            colour_str=item_data.colour_str,
        )
        db.add(line)

        # Auto-create device immediately for device lines
        if item_data.line_type == POLineType.DEVICE and item_data.imei:
            existing = await db.execute(select(Device).where(Device.imei == item_data.imei))
            if existing.scalar_one_or_none():
                raise ConflictError(f"IMEI {item_data.imei} already exists in inventory")

            if not model_id:
                raise BadRequestError(f"Device line for IMEI {item_data.imei} is missing model info")

            device = Device(
                imei=item_data.imei,
                model_id=model_id,
                grade=DeviceGrade(item_data.grade) if item_data.grade else DeviceGrade.C,
                status=DeviceStatus.AWAITING_REFURB,
                location=DeviceLocation.INTAKE,
                purchase_cost=item_data.unit_cost,
                purchase_order_id=po.id,
                supplier_id=supplier_id,
                date_received=date.today(),
            )
            db.add(device)
            await db.flush()

            if user_id:
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

    return po


async def receive_purchase_order(
    db: AsyncSession,
    po_id: str,
    user_id: str,
    notes: Optional[str] = None,
) -> PurchaseOrder:
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")
    if po.status != POStatus.OPEN:
        raise BadRequestError(f"PO is already {po.status.value}")

    po.status = POStatus.RECEIVED
    po.received_by_user_id = user_id
    po.received_at = datetime.utcnow()
    if notes:
        po.notes = (po.notes or "") + f"\nReceived note: {notes}"

    return po
