export type UserRole = 'ADMIN' | 'OPERATIONS' | 'INVENTORY' | 'SALES' | 'ENGINEER' | 'RECORDS'

export interface User {
  id: string
  name: string
  username: string
  employee_id?: string
  role: UserRole
  assigned_location?: string
  is_active: boolean
  must_change_password?: boolean
  allowed_modules?: string | null
  effective_modules: string[]
  created_at: string
}

export type DeviceStatus =
  | 'AWAITING_REFURB'
  | 'IN_REFURB'
  | 'AWAITING_QC'
  | 'FAILED_QC'
  | 'SENT_EXTERNAL'
  | 'SCRAPPED'
  | 'SELLABLE'
  | 'RESERVED'
  | 'SOLD'
  | 'RETURNED'
  | 'STOCK_TO_RETURN'
  | 'HARVESTED'

export type DeviceGrade = 'A' | 'B' | 'C'
export type DeviceLocation = 'INTAKE' | 'BENCH' | 'SALES_STOCK' | 'EXTERNAL' | 'SCRAP' | 'QC'

export interface Device {
  id: string
  imei: string
  inventory_number?: string
  model_id: string
  model?: { id: string; brand: string; model_name: string; ram?: string; storage?: string; colour?: string } | null
  grade: DeviceGrade
  status: DeviceStatus
  location: DeviceLocation
  custody_user_id?: string
  purchase_cost?: string | null    // null when hidden from caller's role
  parts_cost?: string | null
  external_cost?: string | null
  total_cost?: string | null
  selling_price?: string | null
  selling_price_set_by?: string | null
  selling_price_set_at?: string | null
  selling_price_status?: 'set' | 'required'
  purchase_order_id?: string
  supplier_id?: string
  date_received?: string
  sale_id?: string
  sale_price?: string
  warranty_expiry?: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface PriceChange {
  id: string
  device_id: string
  imei: string
  user_id: string
  user_role: string
  field: string
  old_value?: string | null
  new_value?: string | null
  action: string
  notes?: string | null
  timestamp: string
}

export interface PhoneModel {
  id: string
  brand: string
  model_name: string
  ram?: string
  storage?: string
  colour?: string
  created_at: string
}

export interface Part {
  id: string
  name: string
  type: string
  sku?: string
  quantity_on_hand: number
  unit_cost: string
  location?: string
  min_stock_level: number
  source: 'imported' | 'harvested'
  notes?: string
  created_at: string
}

export interface Supplier {
  id: string
  name: string
  type: 'supplier' | 'vendor'
  contact?: Record<string, string>
  bank_details?: Record<string, string>
  notes?: string
  created_at: string
}

export interface Customer {
  id: string
  name: string
  type: 'wholesale' | 'retail'
  contact?: Record<string, string>
  credit_limit: string
  current_balance: string
  created_at: string
}

export type POStatus =
  | 'open' | 'ordered' | 'partially_received'
  | 'received' | 'fully_received' | 'closed_discrepancy' | 'cancelled'

export type POLineItemStatus =
  | 'pending' | 'partially_received' | 'fully_received' | 'not_received' | 'short_supplied'

export interface POReceivedDevice {
  id: string
  po_id: string
  line_item_id: string
  device_id?: string
  imei: string
  actual_brand?: string
  actual_model_str?: string
  actual_ram_str?: string
  actual_storage_str?: string
  actual_colour_str?: string
  actual_grade?: string
  actual_condition?: string
  selling_price?: string | null
  received_by_user_id?: string
  received_at: string
  notes?: string
  migrated?: boolean
}

export interface POLineItem {
  id: string
  po_id: string
  line_type: 'device' | 'part'
  imei?: string
  model_id?: string
  grade?: string
  unit_cost: string
  selling_price?: string | null
  part_id?: string
  quantity: number
  received_qty: number
  outstanding_qty: number
  item_status: POLineItemStatus
  discrepancy_notes?: string | null
  notes?: string
  brand?: string
  model_name_str?: string
  ram_str?: string
  storage_str?: string
  colour_str?: string
  received_devices: POReceivedDevice[]
}

export interface PurchaseOrder {
  id: string
  po_number: string
  supplier_id: string
  date: string
  shipping_cost: string
  status: POStatus
  status_label: string
  received_by_user_id?: string
  received_at?: string
  notes?: string
  created_at: string
  created_by_user_id?: string
  line_items: POLineItem[]
  total_ordered: number
  total_received: number
}

export interface DeviceWithModel extends Device {
  model?: {
    id: string
    brand: string
    model_name: string
    ram?: string
    storage?: string
    colour?: string
  }
}

export interface SalePayment {
  id: string
  sale_id: string
  amount: string
  payment_method?: string
  payment_date: string
  notes?: string
  created_at: string
}

export interface Sale {
  id: string
  invoice_number: string
  customer_id: string
  type: 'wholesale' | 'retail'
  subtotal: string
  tax: string
  discount: string
  delivery_fee: string
  total: string
  amount_paid: string
  balance: string
  payment_status: 'paid' | 'partial' | 'on_account' | 'unpaid'
  date: string
  created_by_user_id: string
  salesperson_name?: string
  payment_method?: string
  sales_channel?: string
  notes?: string
  created_at: string
  customer?: { id: string; name: string; contact?: Record<string, string> }
  line_items: SaleLineItem[]
  payments?: SalePayment[]
}

export interface SaleLineItem {
  id: string
  sale_id: string
  device_id?: string
  part_id?: string
  quantity: number
  unit_price: string
  line_total: string
  notes?: string
  device?: {
    imei: string
    grade: string
    model?: { brand: string; model_name: string; ram?: string; storage?: string; colour?: string }
  }
}

export interface ReturnRMA {
  id: string
  rma_number: string
  batch_id?: string
  original_sale_id?: string
  device_id: string
  customer_id: string
  date: string
  reason_code: string
  condition_on_return?: string
  within_warranty: boolean
  resolution?: string
  refund_amount?: string
  restock_outcome?: string
  replacement_device_id?: string
  handled_by_user_id?: string
  notes?: string
  created_at: string
  device?: { id: string; imei: string; inventory_number?: string; grade: string; status: string }
}

export type ReturnBatchStatus =
  | 'draft' | 'received' | 'under_inspection'
  | 'partially_resolved' | 'completed' | 'cancelled'

export interface ReturnBatch {
  id: string
  batch_number: string
  original_sale_id?: string
  customer_id: string
  date: string
  received_by_user_id?: string
  notes?: string
  status: ReturnBatchStatus
  created_at: string
  items: ReturnRMA[]
}

export interface RefurbJob {
  id: string
  job_number: string
  device_id: string
  assigned_engineer_id?: string
  status: 'open' | 'in_progress' | 'awaiting_qc' | 'qc_failed' | 'closed'
  fault_description?: string
  date_opened: string
  date_closed?: string
  outcome?: 'regraded' | 'sent_external' | 'scrapped'
  external_vendor_id?: string
  external_cost: string
  notes?: string
  auto_created?: boolean
  created_at: string
  parts_used: RefurbJobPart[]
}

export interface DeviceDashboardCounts {
  all: number
  awaiting_refurb: number
  in_refurb: number
  awaiting_qc: number
  failed_qc: number
  sellable: number
  reserved: number
  sold: number
  returned: number
  stock_to_return: number
  harvested: number
  scrapped: number
}

export interface RefurbJobPart {
  id: string
  job_id: string
  part_id: string
  quantity: number
  unit_cost_at_time: string
  created_at: string
}

export interface Expense {
  id: string
  title: string
  description?: string
  amount: string
  date: string
  branch?: string
  entered_by_user_id: string
  entered_by?: { id: string; name: string; role: string }
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  device_id?: string
  part_id?: string
  from_location?: string
  to_location?: string
  from_status?: string
  to_status?: string
  user_id?: string
  timestamp: string
  reference_type?: string
  reference_id?: string
  notes?: string
}

export interface ReconciliationReport {
  total_received: number
  sellable: number
  in_refurb: number
  sent_external: number
  scrapped: number
  sold: number
  returned_to_stock: number
  reserved: number
  returned: number
  reconciled: boolean
  discrepancy: number
}
