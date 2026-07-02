from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel

from app.models.refurb_job import JobStatus, JobOutcome
from app.models.device import DeviceGrade


class RefurbJobCreate(BaseModel):
    device_id: str
    assigned_engineer_id: Optional[str] = None
    fault_description: Optional[str] = None
    notes: Optional[str] = None


class RefurbJobPartAdd(BaseModel):
    part_id: str
    quantity: int = 1


class AddPartsRequest(BaseModel):
    parts: List[RefurbJobPartAdd]


class CloseJobRequest(BaseModel):
    outcome: JobOutcome
    new_grade: Optional[DeviceGrade] = None
    external_vendor_id: Optional[str] = None
    external_cost: Optional[Decimal] = None
    notes: Optional[str] = None


class RefurbJobPartOut(BaseModel):
    id: str
    job_id: str
    part_id: str
    quantity: int
    unit_cost_at_time: Decimal
    created_at: datetime

    model_config = {"from_attributes": True}


class RefurbJobOut(BaseModel):
    id: str
    job_number: str
    device_id: str
    assigned_engineer_id: Optional[str] = None
    status: JobStatus
    fault_description: Optional[str] = None
    date_opened: date
    date_closed: Optional[date] = None
    outcome: Optional[JobOutcome] = None
    external_vendor_id: Optional[str] = None
    external_cost: Decimal
    notes: Optional[str] = None
    created_at: datetime
    parts_used: List[RefurbJobPartOut] = []

    model_config = {"from_attributes": True}
