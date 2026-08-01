from app.models.device import DeviceStatus, DeviceLocation
from app.core.exceptions import InvalidTransitionError

ALLOWED_TRANSITIONS: dict[DeviceStatus, list[tuple[DeviceStatus, DeviceLocation]]] = {
    DeviceStatus.AWAITING_REFURB: [
        (DeviceStatus.IN_REFURB, DeviceLocation.BENCH),
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),  # direct sellable (no refurb)
        (DeviceStatus.STOCK_TO_RETURN, DeviceLocation.INTAKE),
        (DeviceStatus.HARVESTED, DeviceLocation.SCRAP),
        (DeviceStatus.SCRAPPED, DeviceLocation.SCRAP),
    ],
    DeviceStatus.IN_REFURB: [
        (DeviceStatus.AWAITING_QC, DeviceLocation.QC),
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),  # legacy direct path
        (DeviceStatus.SENT_EXTERNAL, DeviceLocation.EXTERNAL),
        (DeviceStatus.SCRAPPED, DeviceLocation.SCRAP),
        (DeviceStatus.HARVESTED, DeviceLocation.SCRAP),
        (DeviceStatus.AWAITING_REFURB, DeviceLocation.INTAKE),  # unassign / put back
    ],
    DeviceStatus.AWAITING_QC: [
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),   # QC pass
        (DeviceStatus.FAILED_QC, DeviceLocation.BENCH),        # QC fail
        (DeviceStatus.SCRAPPED, DeviceLocation.SCRAP),
    ],
    DeviceStatus.FAILED_QC: [
        (DeviceStatus.IN_REFURB, DeviceLocation.BENCH),        # return to engineer
        (DeviceStatus.SCRAPPED, DeviceLocation.SCRAP),
        (DeviceStatus.HARVESTED, DeviceLocation.SCRAP),
    ],
    DeviceStatus.SENT_EXTERNAL: [
        (DeviceStatus.AWAITING_QC, DeviceLocation.QC),
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),
        (DeviceStatus.SCRAPPED, DeviceLocation.SCRAP),
    ],
    DeviceStatus.SELLABLE: [
        (DeviceStatus.RESERVED, DeviceLocation.SALES_STOCK),
        (DeviceStatus.STOCK_TO_RETURN, DeviceLocation.INTAKE),
        (DeviceStatus.HARVESTED, DeviceLocation.SCRAP),
        (DeviceStatus.AWAITING_REFURB, DeviceLocation.INTAKE),  # needs refurb after all
    ],
    DeviceStatus.RESERVED: [
        (DeviceStatus.SOLD, DeviceLocation.SALES_STOCK),
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),
        (DeviceStatus.STOCK_TO_RETURN, DeviceLocation.INTAKE),
    ],
    DeviceStatus.SOLD: [
        (DeviceStatus.RETURNED, DeviceLocation.INTAKE),
    ],
    DeviceStatus.RETURNED: [
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),
        (DeviceStatus.IN_REFURB, DeviceLocation.BENCH),
        (DeviceStatus.AWAITING_REFURB, DeviceLocation.INTAKE),
        (DeviceStatus.SCRAPPED, DeviceLocation.SCRAP),
        (DeviceStatus.STOCK_TO_RETURN, DeviceLocation.INTAKE),
    ],
    DeviceStatus.STOCK_TO_RETURN: [
        (DeviceStatus.AWAITING_REFURB, DeviceLocation.INTAKE),  # cancel return
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),    # cancel return, already ok
        (DeviceStatus.SCRAPPED, DeviceLocation.SCRAP),
    ],
    DeviceStatus.HARVESTED: [],   # terminal
    DeviceStatus.SCRAPPED: [],    # terminal
}


def validate_transition(
    from_status: DeviceStatus,
    to_status: DeviceStatus,
    to_location: DeviceLocation,
) -> None:
    allowed = ALLOWED_TRANSITIONS.get(from_status, [])
    if (to_status, to_location) not in allowed:
        raise InvalidTransitionError(from_status.value, f"{to_status.value} @ {to_location.value}")


def get_allowed_transitions(from_status: DeviceStatus) -> list[tuple[DeviceStatus, DeviceLocation]]:
    return ALLOWED_TRANSITIONS.get(from_status, [])
