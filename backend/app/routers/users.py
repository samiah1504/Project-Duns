from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional

from app.database import get_db
from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserUpdate, UserOut, UserPermissionsUpdate, ResetPasswordRequest
from app.core.auth import hash_password, get_current_user
from app.core.permissions import admin_only
from app.core.exceptions import NotFoundError, ConflictError

router = APIRouter()


def _out(user: User) -> UserOut:
    return UserOut.from_user(user)


@router.get("", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_only()),
):
    result = await db.execute(select(User).order_by(User.name))
    return [_out(u) for u in result.scalars().all()]


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_only()),
):
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise ConflictError(f"Username '{body.username}' is already taken")
    user = User(
        name=body.name,
        username=body.username,
        employee_id=body.employee_id,
        hashed_password=hash_password(body.password),
        must_change_password=False,
        role=body.role,
        assigned_location=body.assigned_location,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _out(user)


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.id != user_id and current_user.role != UserRole.ADMIN:
        from app.core.exceptions import ForbiddenError
        raise ForbiddenError("Cannot view another user's profile")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    return _out(user)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_only()),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    if body.username is not None and body.username != user.username:
        clash = await db.execute(select(User).where(User.username == body.username))
        if clash.scalar_one_or_none():
            raise ConflictError(f"Username '{body.username}' is already taken")
        user.username = body.username
    if body.name is not None:
        user.name = body.name
    if body.employee_id is not None:
        user.employee_id = body.employee_id
    if body.role is not None:
        user.role = body.role
    if body.assigned_location is not None:
        user.assigned_location = body.assigned_location
    if body.is_active is not None:
        user.is_active = body.is_active
    await db.commit()
    await db.refresh(user)
    return _out(user)


@router.post("/{user_id}/reset-password", response_model=UserOut)
async def reset_user_password(
    user_id: str,
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_only()),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    user.hashed_password = hash_password(body.new_password)
    user.must_change_password = False
    await db.commit()
    await db.refresh(user)
    return _out(user)


@router.put("/{user_id}/permissions", response_model=UserOut)
async def update_user_permissions(
    user_id: str,
    body: UserPermissionsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_only()),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    if body.allowed_modules is None:
        user.allowed_modules = None
    else:
        user.allowed_modules = ",".join(body.allowed_modules)
    await db.commit()
    await db.refresh(user)
    return _out(user)
