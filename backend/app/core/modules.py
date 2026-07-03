"""
Module permission definitions.
Each module key maps to a human label and the roles that have it by default.
"""

ALL_MODULES = [
    "dashboard",
    "devices",
    "intake",
    "refurb",
    "sales",
    "customers",
    "parts",
    "returns",
    "reports",
    "expenses",
    "phone_models",
    "suppliers",
    "users",
    "settings",
]

MODULE_LABELS = {
    "dashboard": "Dashboard",
    "devices": "Devices",
    "intake": "Intake / Purchase Orders",
    "refurb": "Refurb Jobs",
    "sales": "Sales",
    "customers": "Customers",
    "parts": "Parts",
    "returns": "Returns",
    "reports": "Reports",
    "expenses": "Warehouse Expenses",
    "phone_models": "Phone Models",
    "suppliers": "Suppliers",
    "users": "User Management",
    "settings": "Settings",
}

ROLE_DEFAULTS: dict[str, list[str]] = {
    "ADMIN": ALL_MODULES,
    "INVENTORY": ["dashboard", "devices", "intake", "parts", "phone_models", "suppliers"],
    "SALES": ["dashboard", "devices", "sales", "customers", "returns"],
    "ENGINEER": ["dashboard", "devices", "refurb", "parts"],
    "RECORDS": ["dashboard", "reports", "expenses"],
}


def get_effective_modules(user) -> list[str]:
    """Return the list of modules the user can access."""
    if user.allowed_modules:
        return [m.strip() for m in user.allowed_modules.split(",") if m.strip()]
    return ROLE_DEFAULTS.get(user.role.value if hasattr(user.role, "value") else user.role, ["dashboard"])
