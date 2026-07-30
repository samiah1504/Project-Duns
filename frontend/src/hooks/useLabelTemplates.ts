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

export interface LabelField {
  type: FieldType
  enabled: boolean
  fontSize: number        // pt — 0 means auto-calculate from available space
  bold: boolean
  align: 'left' | 'center' | 'right'
}

export interface LabelTemplate {
  id: string
  name: string
  // Margins in mm — default 2/2/1.5/1.5
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
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
}

const ALL_FIELD_TYPES: FieldType[] = [
  'company_name', 'phone_model', 'brand', 'barcode', 'grade',
  'ram', 'rom', 'colour', 'condition', 'selling_price',
  'sku', 'inventory_id', 'date_received', 'imei_text', 'serial_number',
]

export const isBarcode = (f: LabelField) => f.type === 'barcode'

function defaultField(type: FieldType, enabled: boolean): LabelField {
  return {
    type,
    enabled,
    fontSize: 0,   // 0 = auto
    bold: type === 'company_name' || type === 'phone_model',
    align: 'center',
  }
}

const DEFAULT_MARGINS = { marginTop: 1.5, marginBottom: 1.5, marginLeft: 2, marginRight: 2 }

function buildDefaultTemplate(): LabelTemplate {
  // Field order: company → phone model → grade → barcode (spec: §6)
  const enabledSet = new Set<FieldType>(['company_name', 'phone_model', 'grade', 'barcode'])
  // Put barcode last in the fields array
  const order: FieldType[] = ['company_name', 'phone_model', 'grade', 'barcode',
    'brand', 'ram', 'rom', 'colour', 'condition', 'selling_price',
    'sku', 'inventory_id', 'date_received', 'imei_text', 'serial_number']
  return {
    id: 'default',
    name: 'Default Phone Label',
    ...DEFAULT_MARGINS,
    fields: order.map(t => defaultField(t, enabledSet.has(t))),
  }
}

function buildTemplate(id: string, name: string, enabled: FieldType[], margins?: Partial<typeof DEFAULT_MARGINS>): LabelTemplate {
  const enabledSet = new Set(enabled)
  return {
    id,
    name,
    ...DEFAULT_MARGINS,
    ...margins,
    fields: ALL_FIELD_TYPES.map(t => defaultField(t, enabledSet.has(t))),
  }
}

const PRESET_TEMPLATES: LabelTemplate[] = [
  buildDefaultTemplate(),
  buildTemplate('barcode-only', 'Barcode Only', ['barcode']),
  buildTemplate('showroom', 'Showroom Label', ['company_name', 'phone_model', 'grade', 'colour', 'selling_price']),
  buildTemplate('warehouse', 'Warehouse Label', ['barcode', 'phone_model', 'inventory_id', 'date_received']),
  buildTemplate('accessory', 'Accessory Label', ['company_name', 'sku', 'selling_price', 'barcode']),
]

export function getTemplates(): LabelTemplate[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved: LabelTemplate[] = JSON.parse(raw)
      // Back-fill margin fields for templates saved before this version
      return saved.map(t => ({
        ...DEFAULT_MARGINS,
        ...t,
        fields: t.fields.map(f => ({ ...f, fontSize: f.fontSize ?? 0 })),
      }))
    }
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
    ...base,
    id: `tmpl-${Date.now()}`,
    name,
    fields: base.fields.map(f => ({ ...f })),
  }
  const templates = getTemplates()
  templates.push(tmpl)
  saveTemplates(templates)
  return tmpl
}

export function deleteTemplate(id: string): void {
  const templates = getTemplates().filter(t => t.id !== id)
  saveTemplates(templates)
  if (getDefaultTemplateId() === id && templates.length) {
    saveDefaultTemplateId(templates[0].id)
  }
}
