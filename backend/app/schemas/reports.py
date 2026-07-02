from decimal import Decimal
from typing import List, Optional, Dict, Any
from pydantic import BaseModel


class ReconciliationReport(BaseModel):
    total_received: int
    sellable: int
    in_refurb: int
    sent_external: int
    scrapped: int
    sold: int
    returned_to_stock: int
    reserved: int
    returned: int
    reconciled: bool
    discrepancy: int


class InventoryValuationItem(BaseModel):
    device_id: str
    imei: str
    model: str
    grade: str
    status: str
    total_cost: Decimal


class InventoryValuationReport(BaseModel):
    items: List[InventoryValuationItem]
    total_value: Decimal
    count: int


class WIPValueReport(BaseModel):
    total_wip_value: Decimal
    device_count: int
    avg_cost_per_device: Decimal


class EngineerPerformanceItem(BaseModel):
    engineer_id: str
    engineer_name: str
    jobs_completed: int
    avg_turnaround_days: Optional[float]
    devices_regraded: int
    devices_scrapped: int
    devices_sent_external: int


class EngineerPerformanceReport(BaseModel):
    engineers: List[EngineerPerformanceItem]


class SalesSummaryReport(BaseModel):
    period_start: Optional[str]
    period_end: Optional[str]
    total_invoices: int
    total_revenue: Decimal
    total_tax: Decimal
    total_paid: Decimal
    outstanding_balance: Decimal
    wholesale_revenue: Decimal
    retail_revenue: Decimal


class ReturnsAnalysisItem(BaseModel):
    reason_code: str
    count: int
    refund_total: Decimal


class ReturnsAnalysisReport(BaseModel):
    total_returns: int
    items: List[ReturnsAnalysisItem]
    total_refunded: Decimal


class LowStockAlert(BaseModel):
    part_id: str
    name: str
    sku: Optional[str]
    quantity_on_hand: int
    min_stock_level: int
    shortfall: int


class LowStockReport(BaseModel):
    alerts: List[LowStockAlert]
    total_alerts: int


class YieldConversionReport(BaseModel):
    total_received: int
    directly_sellable: int
    required_refurb: int
    scrapped: int
    yield_rate_percent: float
    scrap_rate_percent: float
