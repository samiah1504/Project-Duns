from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator
import json


class LabelTemplateCreate(BaseModel):
    name: str
    is_default: bool = False
    data: Any  # the full LabelTemplate JS object (dict)

    @field_validator("data", mode="before")
    @classmethod
    def coerce_data(cls, v: Any) -> Any:
        return v  # kept as-is; serialised to JSON string in the router


class LabelTemplateUpdate(BaseModel):
    name: str | None = None
    is_default: bool | None = None
    data: Any | None = None


class LabelTemplateOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    name: str
    is_default: bool
    data: Any
    created_at: datetime
    updated_at: datetime

    @field_validator("data", mode="before")
    @classmethod
    def parse_data(cls, v: Any) -> Any:
        if isinstance(v, str):
            return json.loads(v)
        return v
