import json
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.app_setting import AppSetting
from app.core.permissions import any_authenticated, admin_or_operations
from app.models.user import User

router = APIRouter()

COMPANY_KEY = "company"

COMPANY_DEFAULTS: Dict[str, Any] = {
    "name": "Tardmart Ventures",
    "tagline": "",
    "phone": "",
    "email": "",
    "address": "",
    "bankDetails": "",
    "receiptNote": "Thank you for your business! All sales are final.",
}


@router.get("/company")
async def get_company_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(any_authenticated()),
):
    row = await db.get(AppSetting, COMPANY_KEY)
    if not row:
        return COMPANY_DEFAULTS
    try:
        stored = json.loads(row.data)
    except (ValueError, TypeError):
        return COMPANY_DEFAULTS
    # Merge over defaults so newly added fields always have a value
    return {**COMPANY_DEFAULTS, **stored}


@router.put("/company")
async def save_company_settings(
    body: Dict[str, Any],
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_or_operations()),
):
    # Only persist known keys — ignore anything unexpected in the payload
    clean = {k: str(body.get(k, "")) for k in COMPANY_DEFAULTS}
    row = await db.get(AppSetting, COMPANY_KEY)
    if row:
        row.data = json.dumps(clean)
    else:
        row = AppSetting(key=COMPANY_KEY, data=json.dumps(clean))
        db.add(row)
    await db.commit()
    return {**COMPANY_DEFAULTS, **clean}
