"""
Module permission definitions.
Each module key maps to a human label and the roles that have it by default.
"""

ALL_MODULES = [
    "dashboard",
    "devices",
    "all_devices",
    "sellable_stock",
    "stock_to_return",
    "harvested_stock",
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
    "cost_price",
    "settings",
]

MODULE_LABELS = {
    "dashboard": "Dashboard",
    "devices": "Devices",
    "all_devices": "All Devices",
    "sellable_stock": "Sellable Stock",
    "stock_to_return": "Stock to Return",
    "harvested_stock": "Harvested Stock",
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
    "cost_price": "Cost Price Management",
    "settings": "Settings",
}

ROLE_DEFAULTS: dict[str, list[str]] = {
    "ADMIN": ALL_MODULES,
    "OPERATIONS": [
        "dashboard", "all_devices", "sellable_stock", "stock_to_return", "harvested_stock",
        "intake", "parts", "phone_models", "suppliers", "reports", "expenses", "cost_price",
        "customers", "returns",
    ],
    "INVENTORY": [
        "dashboard", "all_devices", "sellable_stock", "stock_to_return", "harvested_stock",
        "intake", "refurb", "parts", "phone_models", "suppliers",
    ],
    "SALES": ["dashboard", "sellable_stock", "sales", "customers", "returns"],
    "ENGINEER": ["dashboard", "refurb", "parts"],
    "RECORDS": ["dashboard", "reports", "expenses"],
}


def get_effective_modules(user) -> list[str]:
    """Return the list of modules the user can access."""
    if user.allowed_modules:
        return [m.strip() for m in user.allowed_modules.split(",") if m.strip()]
    return ROLE_DEFAULTS.get(user.role.value if hasattr(user.role, "value") else user.role, ["dashboard"])
