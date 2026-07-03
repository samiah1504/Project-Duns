from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr

from app.models.user import UserRole


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: UserRole
    assigned_location: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[UserRole] = None
    assigned_location: Optional[str] = None
    is_active: Optional[bool] = None


class UserPermissionsUpdate(BaseModel):
    allowed_modules: Optional[List[str]] = None  # None = reset to role defaults


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: UserRole
    assigned_location: Optional[str] = None
    is_active: bool
    allowed_modules: Optional[str] = None
    effective_modules: List[str] = []
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_user(cls, user) -> "UserOut":
        from app.core.modules import get_effective_modules
        data = {
            "id": user.id, "name": user.name, "email": user.email,
            "role": user.role, "assigned_location": user.assigned_location,
            "is_active": user.is_active, "allowed_modules": user.allowed_modules,
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
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str
