from datetime import datetime
from datetime import date as date_type
from decimal import Decimal
from typing import Optional, List
from pydantic import BaseModel


class EnteredByUser(BaseModel):
    id: str
    name: str
    role: str
    model_config = {"from_attributes": True}


class ExpenseCreate(BaseModel):
    title: str
    description: Optional[str] = None
    amount: Decimal
    date: date_type
    branch: Optional[str] = None


class ExpenseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[Decimal] = None
    date: Optional[date_type] = None
    branch: Optional[str] = None


class ExpenseOut(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    amount: Decimal
    date: date_type
    branch: Optional[str] = None
    entered_by_user_id: str
    entered_by: Optional[EnteredByUser] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class ExpenseSummaryItem(BaseModel):
    title: str
    count: int
    total: Decimal


class ExpensesSummaryReport(BaseModel):
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    total_expenses: Decimal
    expense_count: int
    items: List[ExpenseSummaryItem]
