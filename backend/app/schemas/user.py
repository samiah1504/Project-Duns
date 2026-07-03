from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel

from app.models.user import UserRole


class UserCreate(BaseModel):
    name: str
    username: str
    password: str
    role: UserRole
    employee_id: Optional[str] = None
    assigned_location: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    employee_id: Optional[str] = None
    role: Optional[UserRole] = None
    assigned_location: Optional[str] = None
    is_active: Optional[bool] = None


class UserPermissionsUpdate(BaseModel):
    allowed_modules: Optional[List[str]] = None  # None = reset to role defaults


class ResetPasswordRequest(BaseModel):
    new_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UserOut(BaseModel):
    id: str
    name: str
    username: str
    employee_id: Optional[str] = None
    role: UserRole
    assigned_location: Optional[str] = None
    is_active: bool
    must_change_password: bool = False
    allowed_modules: Optional[str] = None
    effective_modules: List[str] = []
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_user(cls, user) -> "UserOut":
        from app.core.modules import get_effective_modules
        data = {
            "id": user.id, "name": user.name, "username": user.username,
            "employee_id": user.employee_id,
            "role": user.role, "assigned_location": user.assigned_location,
            "is_active": user.is_active, "must_change_password": user.must_change_password,
            "allowed_modules": user.allowed_modules,
            "effective_modules": get_effective_modules(user),
            "created_at": user.created_at,
        }
        return cls(**data)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str
