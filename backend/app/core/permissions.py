from functools import wraps
from typing import List
from fastapi import Depends

from app.core.auth import get_current_user
from app.core.exceptions import ForbiddenError


def require_roles(*roles: str):
    """
    Dependency factory that checks the current user has one of the given roles.
    Usage: Depends(require_roles("ADMIN", "INVENTORY"))
    """

    async def checker(current_user=Depends(get_current_user)):
        if current_user.role.value not in roles and current_user.role not in roles:
            raise ForbiddenError(
                f"Access denied. Required roles: {', '.join(roles)}"
            )
        return current_user

    return checker


def admin_only():
    return require_roles("ADMIN")


def admin_or_operations():
    return require_roles("ADMIN", "OPERATIONS")


def inventory_or_admin():
    return require_roles("ADMIN", "OPERATIONS", "INVENTORY")


def sales_or_admin():
    return require_roles("ADMIN", "OPERATIONS", "SALES")


def engineer_or_admin():
    return require_roles("ADMIN", "OPERATIONS", "ENGINEER")


def records_or_admin():
    return require_roles("ADMIN", "OPERATIONS", "RECORDS")


def any_authenticated():
    return require_roles("ADMIN", "OPERATIONS", "INVENTORY", "SALES", "ENGINEER", "RECORDS")
