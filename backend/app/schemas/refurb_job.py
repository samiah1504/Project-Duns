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


class AssignEngineerRequest(BaseModel):
    engineer_id: str
    fault_description: Optional[str] = None


class CompleteRefurbRequest(BaseModel):
    notes: Optional[str] = None


class QCPassRequest(BaseModel):
    new_grade: Optional[DeviceGrade] = None
    notes: Optional[str] = None


class QCFailRequest(BaseModel):
    notes: Optional[str] = None


class ReturnToEngineerRequest(BaseModel):
    engineer_id: Optional[str] = None
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


class ModelForRefurb(BaseModel):
    """Phone model identification only."""
    brand: str
    model_name: str
    ram: Optional[str] = None
    storage: Optional[str] = None
    colour: Optional[str] = None

    model_config = {"from_attributes": True}


class DeviceForRefurb(BaseModel):
    """Device identification for the Refurb Jobs page.

    Deliberately excludes ALL cost/financial fields — this endpoint is
    visible to ENGINEER, who must never see purchase/parts/total cost.
    """
    imei: str
    inventory_number: Optional[str] = None
    grade: str
    status: str
    model: Optional[ModelForRefurb] = None

    model_config = {"from_attributes": True}


class RefurbJobPartOut(BaseModel):
    id: str
    job_id: str
    part_id: str
    quantity: int
    # unit_cost_at_time deliberately NOT serialized: this endpoint is visible
    # to ENGINEER and part cost is confidential. The snapshot still exists in
    # the DB and drives device.parts_cost and all cost reports.
    created_at: datetime

    model_config = {"from_attributes": True}


class RefurbJobOut(BaseModel):
    id: str
    job_number: str
    device_id: str
    # Human-readable device identification (device_id kept for compatibility)
    device: Optional[DeviceForRefurb] = None
    assigned_engineer_id: Optional[str] = None
    status: JobStatus
    fault_description: Optional[str] = None
    date_opened: date
    date_closed: Optional[date] = None
    outcome: Optional[JobOutcome] = None
    external_vendor_id: Optional[str] = None
    external_cost: Decimal
    notes: Optional[str] = None
    auto_created: bool = False
    created_at: datetime
    parts_used: List[RefurbJobPartOut] = []

    model_config = {"from_attributes": True}
