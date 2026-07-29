const KEY = 'tardmart_label_templates'
const DEFAULT_KEY = 'tardmart_default_template'

export type FieldType =
  | 'company_name'
  | 'phone_model'
  | 'brand'
  | 'barcode'
  | 'grade'
  | 'ram'
  | 'rom'
  | 'colour'
  | 'condition'
  | 'selling_price'
  | 'sku'
  | 'inventory_id'
  | 'date_received'
  | 'imei_text'
  | 'serial_number'
  | 'qr_code'

export interface LabelField {
  type: FieldType
  enabled: boolean
  label?: string          // override display label
  fontSize: number        // pt
  bold: boolean
  align: 'left' | 'center' | 'right'
  paddingTop: number      // mm
  paddingBottom: number   // mm
  // barcode-specific
  barcodeHeight?: number  // mm
  barcodeModuleWidth?: number // multiplier
}

export interface LabelTemplate {
  id: string
  name: string
  fields: LabelField[]
}

export const FIELD_LABELS: Record<FieldType, string> = {
  company_name: 'Company Name',
  phone_model: 'Phone Model',
  brand: 'Brand',
  barcode: 'Barcode (IMEI)',
  grade: 'Grade',
  ram: 'RAM',
  rom: 'ROM',
  colour: 'Colour',
  condition: 'Condition',
  selling_price: 'Selling Price',
  sku: 'SKU',
  inventory_id: 'Inventory ID',
  date_received: 'Date Received',
  imei_text: 'IMEI (text)',
  serial_number: 'Serial Number',
  qr_code: 'QR Code',
}

const ALL_FIELD_TYPES: FieldType[] = [
  'company_name', 'phone_model', 'brand', 'barcode', 'grade',
  'ram', 'rom', 'colour', 'condition', 'selling_price',
  'sku', 'inventory_id', 'date_received', 'imei_text', 'serial_number', 'qr_code',
]

function defaultField(type: FieldType, enabled: boolean): LabelField {
  const isBarcode = type === 'barcode' || type === 'qr_code'
  return {
    type,
    enabled,
    fontSize: type === 'company_name' ? 10 : type === 'phone_model' ? 9 : 8,
    bold: type === 'company_name' || type === 'phone_model',
    align: 'center',
    paddingTop: 0.5,
    paddingBottom: 0.5,
    ...(isBarcode ? { barcodeHeight: 12, barcodeModuleWidth: 2 } : {}),
  }
}

function buildDefaultTemplate(): LabelTemplate {
  const enabledSet = new Set<FieldType>(['company_name', 'phone_model', 'barcode', 'grade'])
  return {
    id: 'default',
    name: 'Default Phone Label',
    fields: ALL_FIELD_TYPES.map(t => defaultField(t, enabledSet.has(t))),
  }
}

const PRESET_TEMPLATES: LabelTemplate[] = [
  buildDefaultTemplate(),
  {
    id: 'barcode-only',
    name: 'Barcode Only',
    fields: ALL_FIELD_TYPES.map(t => ({ ...defaultField(t, false), ...(t === 'barcode' ? { enabled: true } : {}) })),
  },
  {
    id: 'showroom',
    name: 'Showroom Label',
    fields: ALL_FIELD_TYPES.map(t => ({
      ...defaultField(t, ['company_name', 'phone_model', 'grade', 'colour', 'selling_price'].includes(t)),
    })),
  },
  {
    id: 'warehouse',
    name: 'Warehouse Label',
    fields: ALL_FIELD_TYPES.map(t => ({
      ...defaultField(t, ['barcode', 'phone_model', 'inventory_id', 'date_received'].includes(t)),
    })),
  },
  {
    id: 'accessory',
    name: 'Accessory Label',
    fields: ALL_FIELD_TYPES.map(t => ({
      ...defaultField(t, ['company_name', 'sku', 'selling_price', 'barcode'].includes(t)),
    })),
  },
]

export function getTemplates(): LabelTemplate[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  const templates = PRESET_TEMPLATES.map(t => ({ ...t, fields: t.fields.map(f => ({ ...f })) }))
  saveTemplates(templates)
  return templates
}

export function saveTemplates(templates: LabelTemplate[]): void {
  localStorage.setItem(KEY, JSON.stringify(templates))
}

export function getDefaultTemplateId(): string {
  return localStorage.getItem(DEFAULT_KEY) ?? 'default'
}

export function saveDefaultTemplateId(id: string): void {
  localStorage.setItem(DEFAULT_KEY, id)
}

export function getDefaultTemplate(): LabelTemplate {
  const templates = getTemplates()
  const id = getDefaultTemplateId()
  return templates.find(t => t.id === id) ?? templates[0]
}

export function createTemplate(name: string, copyFrom?: LabelTemplate): LabelTemplate {
  const base = copyFrom ?? buildDefaultTemplate()
  const tmpl: LabelTemplate = {
    id: `tmpl-${Date.now()}`,
    name,
    fields: base.fields.map(f => ({ ...f })),
  }
  const templates = getTemplates()
  templates.push(tmpl)
  saveTemplates(templates)
  return tmpl
}

export function updateTemplate(tmpl: LabelTemplate): void {
  const templates = getTemplates()
  const idx = templates.findIndex(t => t.id === tmpl.id)
  if (idx >= 0) templates[idx] = tmpl
  saveTemplates(templates)
}

export function deleteTemplate(id: string): void {
  const templates = getTemplates().filter(t => t.id !== id)
  saveTemplates(templates)
  if (getDefaultTemplateId() === id && templates.length) {
    saveDefaultTemplateId(templates[0].id)
  }
}
