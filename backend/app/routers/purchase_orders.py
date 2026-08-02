from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional

from app.database import get_db
from app.models.purchase_order import (
    PurchaseOrder, POLineItem, POReceivedDevice, POStatus, POLineType,
    POLineItemStatus, PO_STATUS_LABELS
)
from app.models.device import Device
from app.models.supplier import Supplier
from app.schemas.purchase_order import (
    PurchaseOrderCreate, PurchaseOrderUpdate, PurchaseOrderOut, POLineItemOut,
    POLineItemCreate, POLineItemUpdate, POReceivedDeviceOut,
    ReceiveLineItemRequest, MarkNotReceivedRequest, CloseDiscrepancyRequest,
    DeviceForPOOut, POReconciliation, LineItemReconciliation, ReceivePOBody,
    SimpleReceivePORequest,
)
from app.core.permissions import inventory_or_admin, admin_or_operations, any_authenticated
from app.core.exceptions import NotFoundError, BadRequestError
from app.services.intake import (
    create_purchase_order, receive_line_item, mark_line_item_not_received,
    close_po_with_discrepancy, receive_purchase_order,
    _find_or_create_phone_model, create_and_receive_po_simple,
)
from app.models.user import User

router = APIRouter()


def _po_load_options():
    return [
        selectinload(PurchaseOrder.line_items).selectinload(POLineItem.received_devices),
        selectinload(PurchaseOrder.devices).selectinload(Device.model),
        selectinload(PurchaseOrder.supplier),
    ]


def _po_to_out(po: PurchaseOrder) -> dict:
    line_items_out = []
    for li in po.line_items:
        rd_out = [
            {
                "id": rd.id, "po_id": rd.po_id, "line_item_id": rd.line_item_id,
                "device_id": rd.device_id, "imei": rd.imei,
                "actual_brand": rd.actual_brand, "actual_model_str": rd.actual_model_str,
                "actual_ram_str": rd.actual_ram_str, "actual_storage_str": rd.actual_storage_str,
                "actual_colour_str": rd.actual_colour_str, "actual_grade": rd.actual_grade,
                "actual_condition": rd.actual_condition, "selling_price": rd.selling_price,
                "received_by_user_id": rd.received_by_user_id, "received_at": rd.received_at,
                "notes": rd.notes, "migrated": rd.migrated,
            }
            for rd in (li.received_devices or [])
        ]
        line_items_out.append({
            "id": li.id, "po_id": li.po_id, "line_type": li.line_type,
            "imei": li.imei, "model_id": li.model_id, "grade": li.grade,
            "initial_status": li.initial_status, "unit_cost": li.unit_cost,
            "selling_price": li.selling_price, "part_id": li.part_id,
            "quantity": li.quantity, "received_qty": li.received_qty or 0,
            "outstanding_qty": li.outstanding_qty,
            "item_status": li.item_status or "pending",
            "discrepancy_notes": li.discrepancy_notes, "notes": li.notes,
            "brand": li.brand, "model_name_str": li.model_name_str,
            "ram_str": li.ram_str, "storage_str": li.storage_str, "colour_str": li.colour_str,
            "received_devices": rd_out,
        })
    return {
        "id": po.id, "po_number": po.po_number, "supplier_id": po.supplier_id,
        "date": po.date, "shipping_cost": po.shipping_cost,
        "status": po.status.value if hasattr(po.status, "value") else po.status,
        "status_label": PO_STATUS_LABELS.get(
            po.status.value if hasattr(po.status, "value") else po.status, "Unknown"
        ),
        "received_by_user_id": po.received_by_user_id,
        "received_at": po.received_at, "notes": po.notes,
        "created_at": po.created_at,
        "created_by_user_id": po.created_by_user_id,
        "line_items": line_items_out,
        "total_ordered": po.total_ordered,
        "total_received": po.total_received,
    }


@router.get("", response_model=list[PurchaseOrderOut])
async def list_pos(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    q = select(PurchaseOrder).options(*_po_load_options())
    if status:
        # Handle legacy "open" → "ordered" and "received" → "fully_received" for filter
        status_map = {"open": ["open", "ordered"], "received": ["received", "fully_received"]}
        statuses = status_map.get(status, [status])
        q = q.where(PurchaseOrder.status.in_(statuses))
    result = await db.execute(q.order_by(PurchaseOrder.created_at.desc()))
    pos = result.scalars().all()
    return [_po_to_out(po) for po in pos]


@router.post("", response_model=PurchaseOrderOut, status_code=201)
async def create_po(
    body: PurchaseOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    po = await create_purchase_order(
        db,
        supplier_id=body.supplier_id,
        line_items_data=body.line_items,
        shipping_cost=body.shipping_cost,
        notes=body.notes,
        order_date=body.date,
        user_id=current_user.id,
    )
    await db.commit()
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po.id).options(*_po_load_options())
    )
    return _po_to_out(result.scalar_one())


@router.post("/simple-receive", response_model=PurchaseOrderOut, status_code=201)
async def simple_receive_po(
    body: SimpleReceivePORequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    po = await create_and_receive_po_simple(
        db,
        supplier_id=body.supplier_id,
        items=body.items,
        shipping_cost=body.shipping_cost,
        notes=body.notes,
        user_id=current_user.id,
    )
    await db.commit()
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po.id).options(*_po_load_options())
    )
    return _po_to_out(result.scalar_one())


@router.get("/reconciliation-summary")
async def reconciliation_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_or_operations()),
):
    """Admin overview of all POs with discrepancies or outstanding items."""
    result = await db.execute(
        select(PurchaseOrder)
        .options(*_po_load_options())
        .where(PurchaseOrder.status.notin_(["cancelled"]))
        .order_by(PurchaseOrder.created_at.desc())
    )
    pos = result.scalars().all()
    summary = []
    for po in pos:
        device_lines = [li for li in po.line_items if li.line_type == POLineType.DEVICE]
        total_ordered = sum(li.quantity for li in device_lines)
        total_received = sum(li.received_qty or 0 for li in device_lines)
        total_outstanding = sum(li.outstanding_qty for li in device_lines)
        has_discrepancy = any(
            li.item_status in (
                POLineItemStatus.NOT_RECEIVED.value,
                POLineItemStatus.SHORT_SUPPLIED.value,
            )
            for li in device_lines
        )
        supplier_name = po.supplier.name if po.supplier else "Unknown"
        summary.append({
            "po_id": po.id,
            "po_number": po.po_number,
            "supplier_name": supplier_name,
            "order_date": po.date,
            "status": po.status.value if hasattr(po.status, "value") else po.status,
            "status_label": PO_STATUS_LABELS.get(
                po.status.value if hasattr(po.status, "value") else po.status, "Unknown"
            ),
            "total_ordered": total_ordered,
            "total_received": total_received,
            "total_outstanding": total_outstanding,
            "has_discrepancy": has_discrepancy,
            "created_by_user_id": po.created_by_user_id,
            "received_at": po.received_at,
        })
    return summary


@router.get("/{po_id}", response_model=PurchaseOrderOut)
async def get_po(
    po_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(*_po_load_options())
    )
    po = result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")
    return _po_to_out(po)


@router.patch("/{po_id}", response_model=PurchaseOrderOut)
async def update_po(
    po_id: str,
    body: PurchaseOrderUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")
    if po.status in (POStatus.CANCELLED,):
        raise BadRequestError("Cannot edit a cancelled PO")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(po, field, value)
    await db.commit()
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(*_po_load_options())
    )
    return _po_to_out(result.scalar_one())


@router.post("/{po_id}/line-items", response_model=PurchaseOrderOut, status_code=201)
async def add_line_item(
    po_id: str,
    body: POLineItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    """Add an expected item to an existing PO."""
    po_result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id))
    po = po_result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")
    if po.status == POStatus.CANCELLED:
        raise BadRequestError("Cannot add items to a cancelled PO")

    model_id = body.model_id
    if not model_id and body.brand and body.model_name_str:
        pm = await _find_or_create_phone_model(
            db, body.brand, body.model_name_str, body.ram_str, body.storage_str, body.colour_str
        )
        model_id = pm.id

    line = POLineItem(
        po_id=po_id,
        line_type=body.line_type,
        imei=None,
        model_id=model_id,
        grade=body.grade,
        unit_cost=body.unit_cost,
        selling_price=body.selling_price,
        part_id=body.part_id,
        quantity=body.quantity,
        notes=body.notes,
        brand=body.brand,
        model_name_str=body.model_name_str,
        ram_str=body.ram_str,
        storage_str=body.storage_str,
        colour_str=body.colour_str,
        initial_status=body.initial_status,
        item_status=POLineItemStatus.PENDING.value,
        received_qty=0,
    )
    db.add(line)
    await db.commit()
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(*_po_load_options())
    )
    return _po_to_out(result.scalar_one())


@router.patch("/{po_id}/line-items/{line_item_id}", response_model=PurchaseOrderOut)
async def update_line_item(
    po_id: str,
    line_item_id: str,
    body: POLineItemUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    li_result = await db.execute(
        select(POLineItem).where(
            POLineItem.id == line_item_id, POLineItem.po_id == po_id
        )
    )
    line_item = li_result.scalar_one_or_none()
    if not line_item:
        raise NotFoundError("Line item not found")

    # Cannot reduce quantity below received count
    if body.quantity is not None and body.quantity < (line_item.received_qty or 0):
        raise BadRequestError(
            f"Cannot reduce quantity below already-received count ({line_item.received_qty})"
        )

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(line_item, field, value)

    await db.commit()
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(*_po_load_options())
    )
    return _po_to_out(result.scalar_one())


@router.delete("/{po_id}/line-items/{line_item_id}", status_code=204)
async def delete_line_item(
    po_id: str,
    line_item_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    li_result = await db.execute(
        select(POLineItem).where(
            POLineItem.id == line_item_id, POLineItem.po_id == po_id
        )
    )
    line_item = li_result.scalar_one_or_none()
    if not line_item:
        raise NotFoundError("Line item not found")
    if (line_item.received_qty or 0) > 0:
        raise BadRequestError("Cannot delete a line item that has already been partially received")
    await db.delete(line_item)
    await db.commit()


@router.post("/{po_id}/line-items/{line_item_id}/receive", response_model=PurchaseOrderOut)
async def receive_item(
    po_id: str,
    line_item_id: str,
    body: ReceiveLineItemRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    """Receive one physical device against a PO line item — creates inventory record."""
    received, device = await receive_line_item(
        db,
        po_id=po_id,
        line_item_id=line_item_id,
        imei=body.imei,
        user_id=current_user.id,
        actual_brand=body.actual_brand,
        actual_model_str=body.actual_model_str,
        actual_ram_str=body.actual_ram_str,
        actual_storage_str=body.actual_storage_str,
        actual_colour_str=body.actual_colour_str,
        actual_grade=body.actual_grade,
        actual_condition=body.actual_condition,
        selling_price=body.selling_price,
        notes=body.notes,
    )
    await db.commit()
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(*_po_load_options())
    )
    return _po_to_out(result.scalar_one())


@router.post("/{po_id}/line-items/{line_item_id}/not-received", response_model=PurchaseOrderOut)
async def mark_not_received(
    po_id: str,
    line_item_id: str,
    body: MarkNotReceivedRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    await mark_line_item_not_received(db, po_id=po_id, line_item_id=line_item_id, notes=body.notes)
    await db.commit()
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(*_po_load_options())
    )
    return _po_to_out(result.scalar_one())


@router.post("/{po_id}/close-discrepancy", response_model=PurchaseOrderOut)
async def close_discrepancy(
    po_id: str,
    body: CloseDiscrepancyRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_or_operations()),
):
    po = await close_po_with_discrepancy(db, po_id=po_id, notes=body.notes)
    await db.commit()
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(*_po_load_options())
    )
    return _po_to_out(result.scalar_one())


@router.get("/{po_id}/reconciliation")
async def get_po_reconciliation(
    po_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(*_po_load_options())
    )
    po = result.scalar_one_or_none()
    if not po:
        raise NotFoundError("Purchase order not found")

    device_lines = [li for li in po.line_items if li.line_type == POLineType.DEVICE]
    total_ordered = sum(li.quantity for li in device_lines)
    total_received = sum(li.received_qty or 0 for li in device_lines)
    total_outstanding = sum(li.outstanding_qty for li in device_lines)

    has_any_discrepancy = any(
        li.item_status in (POLineItemStatus.NOT_RECEIVED.value, POLineItemStatus.SHORT_SUPPLIED.value)
        for li in device_lines
    )

    if total_received == total_ordered:
        overall = "exact_match"
    elif total_received > 0 and has_any_discrepancy:
        overall = "discrepancy"
    elif total_received > 0:
        overall = "partial_match"
    else:
        overall = "awaiting"

    line_items_recon = []
    for li in device_lines:
        spec_parts = []
        if li.brand:
            spec_parts.append(li.brand)
        if li.model_name_str:
            spec_parts.append(li.model_name_str)
        if li.ram_str:
            spec_parts.append(li.ram_str)
        if li.storage_str:
            spec_parts.append(li.storage_str)
        if li.colour_str:
            spec_parts.append(li.colour_str)
        if li.grade:
            spec_parts.append(f"Grade {li.grade}")
        spec = " / ".join(spec_parts) if spec_parts else "Device"

        line_items_recon.append({
            "line_item_id": li.id,
            "expected_spec": spec,
            "ordered_qty": li.quantity,
            "received_qty": li.received_qty or 0,
            "outstanding_qty": li.outstanding_qty,
            "item_status": li.item_status or "pending",
            "received_imeis": [rd.imei for rd in (li.received_devices or [])],
            "discrepancy_notes": li.discrepancy_notes,
            "selling_price": li.selling_price,
        })

    supplier_name = po.supplier.name if po.supplier else "Unknown"
    return {
        "po_id": po.id,
        "po_number": po.po_number,
        "supplier_name": supplier_name,
        "order_date": po.date,
        "total_ordered": total_ordered,
        "total_received": total_received,
        "total_outstanding": total_outstanding,
        "overall_status": overall,
        "status": po.status.value if hasattr(po.status, "value") else po.status,
        "status_label": PO_STATUS_LABELS.get(
            po.status.value if hasattr(po.status, "value") else po.status, ""
        ),
        "line_items": line_items_recon,
    }


@router.get("/{po_id}/devices", response_model=list[DeviceForPOOut])
async def get_po_devices(
    po_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(inventory_or_admin()),
):
    result = await db.execute(
        select(Device)
        .where(Device.purchase_order_id == po_id)
        .options(selectinload(Device.model))
        .order_by(Device.created_at)
    )
    devices = result.scalars().all()
    return [
        {
            "id": d.id, "imei": d.imei, "inventory_number": d.inventory_number,
            "grade": d.grade.value if hasattr(d.grade, "value") else d.grade,
            "status": d.status.value if hasattr(d.status, "value") else d.status,
            "location": d.location.value if hasattr(d.location, "value") else d.location,
            "selling_price": d.selling_price,
            "selling_price_status": "set" if d.selling_price is not None else "required",
            "date_received": d.date_received,
            "model": d.model,
        }
        for d in devices
    ]


@router.post("/{po_id}/receive", response_model=PurchaseOrderOut)
async def receive_po_legacy(
    po_id: str,
    body: ReceivePOBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(inventory_or_admin()),
):
    """Legacy bulk-receive endpoint — kept for backwards compatibility."""
    po = await receive_purchase_order(db, po_id=po_id, user_id=current_user.id, notes=body.notes)
    await db.commit()
    result = await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == po.id).options(*_po_load_options())
    )
    return _po_to_out(result.scalar_one())
