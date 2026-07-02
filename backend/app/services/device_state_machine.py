from app.models.device import DeviceStatus, DeviceLocation
from app.core.exceptions import InvalidTransitionError

# Allowed (status, location) transitions: from_status -> list of (to_status, to_location)
ALLOWED_TRANSITIONS: dict[DeviceStatus, list[tuple[DeviceStatus, DeviceLocation]]] = {
    # After PO intake
    DeviceStatus.AWAITING_REFURB: [
        (DeviceStatus.IN_REFURB, DeviceLocation.BENCH),
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),
    ],
    DeviceStatus.IN_REFURB: [
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),
        (DeviceStatus.SENT_EXTERNAL, DeviceLocation.EXTERNAL),
        (DeviceStatus.SCRAPPED, DeviceLocation.SCRAP),
    ],
    DeviceStatus.SENT_EXTERNAL: [
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),
        (DeviceStatus.SCRAPPED, DeviceLocation.SCRAP),
    ],
    DeviceStatus.SELLABLE: [
        (DeviceStatus.RESERVED, DeviceLocation.SALES_STOCK),
    ],
    DeviceStatus.RESERVED: [
        (DeviceStatus.SOLD, DeviceLocation.SALES_STOCK),
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),
    ],
    DeviceStatus.SOLD: [
        (DeviceStatus.RETURNED, DeviceLocation.INTAKE),
    ],
    DeviceStatus.RETURNED: [
        (DeviceStatus.SELLABLE, DeviceLocation.SALES_STOCK),
        (DeviceStatus.IN_REFURB, DeviceLocation.BENCH),
        (DeviceStatus.SCRAPPED, DeviceLocation.SCRAP),
    ],
    DeviceStatus.SCRAPPED: [],
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
