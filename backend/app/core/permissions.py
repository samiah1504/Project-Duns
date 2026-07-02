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


def inventory_or_admin():
    return require_roles("ADMIN", "INVENTORY")


def sales_or_admin():
    return require_roles("ADMIN", "SALES")


def engineer_or_admin():
    return require_roles("ADMIN", "ENGINEER")


def records_or_admin():
    return require_roles("ADMIN", "RECORDS")


def any_authenticated():
    return require_roles("ADMIN", "INVENTORY", "SALES", "ENGINEER", "RECORDS")
