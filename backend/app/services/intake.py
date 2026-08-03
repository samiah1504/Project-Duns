import secrets
import string
from datetime import datetime, date
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.purchase_order import (
    PurchaseOrder, POLineItem, POReceivedDevice,
    POStatus, POLineType, POLineItemStatus
)
from app.models.device import Device, DeviceStatus, DeviceLocation, DeviceGrade
from app.models.model import PhoneModel
from app.models.part import Part
from app.models.audit_log import ReferenceType
from app.services.audit import write_audit
from app.core.exceptions import BadRequestError, NotFoundError, ConflictError


_INV_CHARSET = string.ascii_uppercase + string.digits


async def generate_inventory_number(db: AsyncSession) -> str:
    while True:
        suffix = ''.join(secrets.choice(_INV_CHARSET) for _ in range(8))
        candidate = f"TDM-{suffix}"
        result = await db.execute(select(Device).where(Device.inventory_number == candidate))
        if not result.scalar_one_or_none():
            return candidate


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
    ram: Optional[str],
    storage: Optional[str],
    colour: Optional[str],
) -> PhoneModel:
    q = select(PhoneModel).where(
        PhoneModel.brand == brand,
        PhoneModel.model_name == model_name,
    )
    if ram:
        q = q.where(PhoneModel.ram == ram)
    if storage:
        q = q.where(PhoneModel.storage == storage)
    if colour:
        q = q.where(PhoneModel.colour == colour)

    result = await db.execute(q)
    pm = result.scalar_one_or_none()
    if pm:
        return pm

    pm = PhoneModel(brand=brand, model_name=model_name, ram=ram, storage=storage, colour=colour)
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
        status=POStatus.ORDERED,
        notes=notes,
        created_by_user_id=user_id,
    )
    db.add(po)
    await db.flush()

    for item_data in line_items_data:
        # Resolve model_id from inline fields if not provided
        model_id = item_data.model_id
        if not model_id and item_data.brand and item_data.model_name_str:
            pm = await _find_or_create_phone_model(
                db,
                brand=item_data.brand,
                model_name=item_data.model_name_str,
                ram=item_data.ram_str,
                storage=item_data.storage_str,
                colour=item_data.colour_str,
            )
            model_id = pm.id

        line = POLineItem(
            po_id=po.id,
            line_type=item_data.line_type,
            imei=None,              # IMEIs are captured at receive time in the new flow
            model_id=model_id,
            grade=item_data.grade,
            unit_cost=item_data.unit_cost,
            selling_price=getattr(item_data, 'selling_price', None),
            part_id=item_data.part_id,
            quantity=item_data.quantity,
            notes=item_data.notes,
            brand=item_data.brand,
            model_name_str=item_data.model_name_str,
            ram_str=item_data.ram_str,
            storage_str=item_data.storage_str,
            colour_str=item_data.colour_str,
            initial_status=item_data.initial_status,
            item_status=POLineItemStatus.PENDING.value,
            received_qty=0,
        )
        db.add(line)

    return po


async def receive_line_item(
    db: AsyncSession,
    po_id: str,
    line_item_id: str,
    imei: str,
    user_id: str,
    actual_brand: Optional[str] = None,
    actual_model_str: Optional[str] = None,
    actual_ram_str: Optional[str] = None,
    actual_storage_str: Optional[str] = None,
    actual_colour_str: Optional[str] = None,
    actual_grade: Optional[str] = None,
    actual_condition: Optional[str] = "awaiting_refurb",
    selling_price: Optional[object] = None,
    notes: Optional[str] = None,
) -> tuple[POReceivedDevice, Device]:
    from decimal import Decimal

    # Validate PO and line item
    po_result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = po_result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")

    _po_status_norm = (po.status or "").lower()
    if _po_status_norm not in {"open", "ordered", "partially_received"}:
        raise BadRequestError(f"PO is {po.status} — cannot receive more items")

    li_result = await db.execute(
        select(POLineItem).where(
            POLineItem.id == line_item_id,
            POLineItem.po_id == po_id,
        )
    )
    line_item = li_result.scalar_one_or_none()
    if not line_item:
        raise NotFoundError("Line item not found on this PO")

    if line_item.item_status == POLineItemStatus.NOT_RECEIVED.value:
        raise BadRequestError("This line item has been marked as not received")

    if (line_item.received_qty or 0) >= line_item.quantity:
        raise BadRequestError(
            f"Already received all {line_item.quantity} unit(s) for this line item"
        )

    # Check IMEI uniqueness in devices table AND po_received_devices
    existing_device = await db.execute(select(Device).where(Device.imei == imei))
    if existing_device.scalar_one_or_none():
        raise ConflictError(f"IMEI {imei} already exists in inventory")

    existing_received = await db.execute(
        select(POReceivedDevice).where(POReceivedDevice.imei == imei)
    )
    if existing_received.scalar_one_or_none():
        raise ConflictError(f"IMEI {imei} has already been received")

    # Resolve effective values (fall back to line item if not overridden)
    eff_brand = actual_brand or line_item.brand
    eff_model = actual_model_str or line_item.model_name_str
    eff_ram = actual_ram_str or line_item.ram_str
    eff_storage = actual_storage_str or line_item.storage_str
    eff_colour = actual_colour_str or line_item.colour_str
    eff_grade = actual_grade or line_item.grade or "C"
    eff_condition = actual_condition or line_item.initial_status or "awaiting_refurb"
    eff_selling_price = selling_price if selling_price is not None else line_item.selling_price

    # Resolve or create phone model
    model_id = line_item.model_id
    if not model_id and eff_brand and eff_model:
        pm = await _find_or_create_phone_model(
            db,
            brand=eff_brand,
            model_name=eff_model,
            ram=eff_ram,
            storage=eff_storage,
            colour=eff_colour,
        )
        model_id = pm.id

    if not model_id:
        raise BadRequestError("Cannot create device: model information is required")

    # Determine initial device status/location
    if eff_condition == "sellable":
        init_status = DeviceStatus.SELLABLE
        init_location = DeviceLocation.SALES_STOCK
    elif eff_condition == "scrapped":
        init_status = DeviceStatus.SCRAPPED
        init_location = DeviceLocation.SCRAP
    elif eff_condition == "stock_to_return":
        init_status = DeviceStatus.STOCK_TO_RETURN
        init_location = DeviceLocation.INTAKE
    else:
        init_status = DeviceStatus.AWAITING_REFURB
        init_location = DeviceLocation.INTAKE

    # Create Device record
    inv_num = await generate_inventory_number(db)
    device = Device(
        imei=imei,
        inventory_number=inv_num,
        model_id=model_id,
        grade=DeviceGrade(eff_grade) if eff_grade in [g.value for g in DeviceGrade] else DeviceGrade.C,
        status=init_status,
        location=init_location,
        purchase_cost=Decimal("0.00"),  # cost price entered separately by ADMIN/OPERATIONS
        selling_price=eff_selling_price,
        selling_price_set_by=user_id if eff_selling_price is not None else None,
        selling_price_set_at=datetime.utcnow() if eff_selling_price is not None else None,
        purchase_order_id=po_id,
        supplier_id=po.supplier_id,
        date_received=date.today(),
    )
    db.add(device)
    await db.flush()

    # Create POReceivedDevice record
    received = POReceivedDevice(
        po_id=po_id,
        line_item_id=line_item_id,
        device_id=device.id,
        imei=imei,
        actual_brand=eff_brand,
        actual_model_str=eff_model,
        actual_ram_str=eff_ram,
        actual_storage_str=eff_storage,
        actual_colour_str=eff_colour,
        actual_grade=eff_grade,
        actual_condition=eff_condition,
        selling_price=eff_selling_price,
        received_by_user_id=user_id,
        received_at=datetime.utcnow(),
        notes=notes,
        migrated=False,
    )
    db.add(received)
    await db.flush()

    # Update line item counts and status
    new_received = (line_item.received_qty or 0) + 1
    line_item.received_qty = new_received
    if new_received >= line_item.quantity:
        line_item.item_status = POLineItemStatus.FULLY_RECEIVED.value
    else:
        line_item.item_status = POLineItemStatus.PARTIALLY_RECEIVED.value

    # Write audit log
    await write_audit(
        db,
        user_id=user_id,
        device_id=device.id,
        from_status=None,
        to_status=init_status.value,
        from_location=None,
        to_location=init_location.value,
        reference_type=ReferenceType.PO,
        reference_id=po.po_number,
        notes=f"Received via {po.po_number} — IMEI {imei}",
    )

    # Auto-update PO status
    await _refresh_po_status(db, po)

    # Auto-create refurb job only for awaiting-refurb devices
    if init_status == DeviceStatus.AWAITING_REFURB:
        from app.services.refurb import ensure_refurb_job
        await ensure_refurb_job(db, device.id, user_id)

    return received, device


async def mark_line_item_not_received(
    db: AsyncSession,
    po_id: str,
    line_item_id: str,
    notes: Optional[str] = None,
) -> POLineItem:
    li_result = await db.execute(
        select(POLineItem).where(
            POLineItem.id == line_item_id,
            POLineItem.po_id == po_id,
        )
    )
    line_item = li_result.scalar_one_or_none()
    if not line_item:
        raise NotFoundError("Line item not found")

    if (line_item.received_qty or 0) > 0:
        raise BadRequestError("Cannot mark as not received — some units already received")

    line_item.item_status = POLineItemStatus.NOT_RECEIVED.value
    if notes:
        line_item.discrepancy_notes = notes

    po_result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = po_result.scalar_one_or_none()
    if po:
        await _refresh_po_status(db, po)

    return line_item


async def _refresh_po_status(db: AsyncSession, po: PurchaseOrder) -> None:
    """Recompute and save PO status based on all line item statuses."""
    li_result = await db.execute(
        select(POLineItem).where(
            POLineItem.po_id == po.id,
            POLineItem.line_type.in_([POLineType.DEVICE.value, POLineType.DEVICE.value.upper()])
        )
    )
    lines = li_result.scalars().all()

    if not lines:
        return

    total = sum(li.quantity for li in lines)
    received = sum(li.received_qty or 0 for li in lines)
    not_rcvd = sum(1 for li in lines if li.item_status == POLineItemStatus.NOT_RECEIVED.value)
    short = sum(1 for li in lines if li.item_status == POLineItemStatus.SHORT_SUPPLIED.value)

    if received == 0 and not_rcvd == 0:
        po.status = POStatus.ORDERED
    elif received >= total:
        po.status = POStatus.FULLY_RECEIVED
        po.received_at = datetime.utcnow()
    elif received > 0 and (not_rcvd > 0 or short > 0):
        # Some received, some explicitly closed short
        all_closed = all(
            li.item_status in (
                POLineItemStatus.FULLY_RECEIVED.value,
                POLineItemStatus.NOT_RECEIVED.value,
                POLineItemStatus.SHORT_SUPPLIED.value,
            )
            for li in lines
        )
        po.status = POStatus.CLOSED_DISCREPANCY if all_closed else POStatus.PARTIALLY_RECEIVED
    elif received > 0:
        po.status = POStatus.PARTIALLY_RECEIVED
    else:
        # All not-received
        all_closed = all(li.item_status == POLineItemStatus.NOT_RECEIVED.value for li in lines)
        po.status = POStatus.CLOSED_DISCREPANCY if all_closed else POStatus.ORDERED


async def create_and_receive_po_simple(
    db: AsyncSession,
    supplier_id: str,
    items: list,
    shipping_cost=None,
    notes: Optional[str] = None,
    user_id: Optional[str] = None,
) -> PurchaseOrder:
    """Create a PO and immediately receive all items into inventory."""
    from decimal import Decimal

    po_number = await generate_po_number(db)
    po = PurchaseOrder(
        po_number=po_number,
        supplier_id=supplier_id,
        date=date.today(),
        shipping_cost=shipping_cost or Decimal("0.00"),
        status=POStatus.ORDERED,
        notes=notes,
        created_by_user_id=user_id,
    )
    db.add(po)
    await db.flush()

    # Create ALL line items first so _refresh_po_status sees the correct totals
    line_ids: list[tuple[str, object]] = []
    for item in items:
        pm = await _find_or_create_phone_model(
            db,
            brand=item.brand,
            model_name=item.model_name_str,
            ram=item.ram_str,
            storage=item.storage_str,
            colour=item.colour_str,
        )
        line = POLineItem(
            po_id=po.id,
            line_type=POLineType.DEVICE,
            model_id=pm.id,
            grade=item.grade,
            unit_cost=Decimal("0.00"),
            selling_price=item.selling_price,
            quantity=1,
            notes=item.notes,
            brand=item.brand,
            model_name_str=item.model_name_str,
            ram_str=item.ram_str,
            storage_str=item.storage_str,
            colour_str=item.colour_str,
            initial_status=item.initial_status,
            item_status=POLineItemStatus.PENDING.value,
            received_qty=0,
        )
        db.add(line)
        await db.flush()
        line_ids.append((line.id, item))

    # Now receive each device — PO totals are correct so status transitions work
    for line_id, item in line_ids:
        await receive_line_item(
            db,
            po_id=po.id,
            line_item_id=line_id,
            imei=item.imei,
            user_id=user_id,
            actual_brand=item.brand,
            actual_model_str=item.model_name_str,
            actual_ram_str=item.ram_str,
            actual_storage_str=item.storage_str,
            actual_colour_str=item.colour_str,
            actual_grade=item.grade,
            actual_condition=item.initial_status,
            selling_price=item.selling_price,
            notes=item.notes,
        )

    return po


async def close_po_with_discrepancy(
    db: AsyncSession,
    po_id: str,
    notes: Optional[str] = None,
) -> PurchaseOrder:
    po_result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = po_result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")

    po.status = POStatus.CLOSED_DISCREPANCY
    if notes:
        po.notes = (po.notes or "") + f"\nClosed: {notes}"
    return po


async def receive_purchase_order(
    db: AsyncSession,
    po_id: str,
    user_id: str,
    notes: Optional[str] = None,
) -> PurchaseOrder:
    """Legacy endpoint — kept for backwards compat. Marks whole PO received."""
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")
    if po.status in (POStatus.FULLY_RECEIVED, POStatus.RECEIVED, POStatus.CANCELLED):
        raise BadRequestError(f"PO is already {po.status}")

    po.status = POStatus.FULLY_RECEIVED
    po.received_by_user_id = user_id
    po.received_at = datetime.utcnow()
    if notes:
        po.notes = (po.notes or "") + f"\nReceived note: {notes}"

    return po
