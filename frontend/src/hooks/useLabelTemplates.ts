const KEY = 'tardmart_label_templates'
const DEFAULT_KEY = 'tardmart_default_template'
const VERSION_KEY = 'tardmart_label_version'
export const PRESET_VERSION = '5'  // bump whenever presets change — triggers DB update

export type FieldType =
  | 'company_name' | 'phone_model' | 'brand' | 'barcode' | 'grade'
  | 'ram' | 'rom' | 'colour' | 'condition' | 'selling_price'
  | 'sku' | 'inventory_id' | 'date_received' | 'imei_text' | 'serial_number'
  | 'model_storage'

export interface LabelField {
  type: FieldType
  enabled: boolean
  // Absolute position on the label (mm from top-left corner)
  // Optional so old templates survive; designer fills them in via autoPlaceFields
  x?: number
  y?: number
  w?: number
  h?: number
  zIndex?: number
  // Text appearance
  fontSize: number          // pt — 0 means auto-derive from h
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  color: string             // hex
  lineHeight: number        // multiplier, 1.0–2.0
  letterSpacing: number     // pt
  // Barcode
  barcodeShowText: boolean
  barcodeModuleWidth: number // 1–4 bar-thickness scale
}

export interface LabelTemplate {
  id: string
  name: string
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  // Paper size saved with the template so loading restores the exact canvas
  paperWidthMm?: number
  paperHeightMm?: number
  fields: LabelField[]
  // Used to detect stale preset templates in the database and auto-update them
  preset_version?: string
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
  model_storage: 'Model + Storage',
}

export const isBarcode = (f: LabelField) => f.type === 'barcode'

const ALL_FIELD_TYPES: FieldType[] = [
  'company_name', 'model_storage', 'phone_model', 'brand', 'barcode', 'grade',
  'ram', 'rom', 'colour', 'condition', 'selling_price',
  'sku', 'inventory_id', 'date_received', 'imei_text', 'serial_number',
]

const DEFAULT_MARGINS = { marginTop: 1.5, marginBottom: 1.5, marginLeft: 2, marginRight: 2 }

function baseField(type: FieldType, enabled: boolean): LabelField {
  return {
    type, enabled,
    // position filled in by autoPlaceFields()
    x: undefined, y: undefined, w: undefined, h: undefined, zIndex: undefined,
    fontSize: 0,
    bold: type === 'company_name' || type === 'phone_model',
    italic: false,
    align: 'center',
    color: '#000000',
    lineHeight: 1.1,
    letterSpacing: 0,
    barcodeShowText: true,
    barcodeModuleWidth: 3,
  }
}

// ─── Auto-placement ───────────────────────────────────────────────────────────

const BARCODE_WEIGHT = 3  // barcode row height = 3× text row

/** Fill in x/y/w/h/zIndex for any field missing position data. */
export function autoPlaceFields(
  template: LabelTemplate,
  labelW: number,
  labelH: number,
): LabelTemplate {
  const { marginLeft: ml, marginRight: mr, marginTop: mt, marginBottom: mb } = template
  const uw = Math.max(2, labelW - ml - mr)
  const uh = Math.max(2, labelH - mt - mb)

  const enabled = template.fields.filter(f => f.enabled)
  const totalWeight = enabled.reduce((s, f) => s + (isBarcode(f) ? BARCODE_WEIGHT : 1), 0) || 1
  const unitH = uh / totalWeight

  let cy = mt
  const placed = template.fields.map((f, i) => {
    if (f.x !== undefined && f.y !== undefined) return f  // already placed
    const fh = isBarcode(f) ? unitH * BARCODE_WEIGHT : unitH
    const out: LabelField = {
      ...f,
      x: ml,
      y: f.enabled ? cy : mt + uh * 0.1 * i,  // stack disabled off to side
      w: uw,
      h: fh,
      zIndex: i,
    }
    if (f.enabled) cy += fh
    return out
  })

  return { ...template, fields: placed }
}

export function needsPlacement(template: LabelTemplate): boolean {
  return template.fields.some(f => f.enabled && f.x === undefined)
}

// ─── Preset templates ─────────────────────────────────────────────────────────

function buildTemplate(
  id: string,
  name: string,
  enabledSet: FieldType[],
  order?: FieldType[],
): LabelTemplate {
  const orderedTypes = order ?? ALL_FIELD_TYPES
  const enabled = new Set(enabledSet)
  return {
    id, name,
    ...DEFAULT_MARGINS,
    preset_version: PRESET_VERSION,
    fields: orderedTypes.map(t => baseField(t, enabled.has(t))),
  }
}

// 50×15mm thermal label
// Row 1: Phone Model (left, bold) | ROM / Storage (right, bold) — same line
// Row 2: Full-width barcode with IMEI text underneath
const THERMAL_50x15: LabelTemplate = {
  id: 'thermal-50x15',
  name: '50×15mm Thermal Label',
  preset_version: PRESET_VERSION,
  marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.5, marginRight: 0.5,
  paperWidthMm: 50, paperHeightMm: 15,
  fields: [
    // ── Phone Model — left 33mm of top row
    {
      type: 'phone_model', enabled: true,
      x: 0.5, y: 0.5, w: 33, h: 4, zIndex: 0,
      fontSize: 9, bold: true, italic: false,
      align: 'left', color: '#000000',
      lineHeight: 1.0, letterSpacing: 0,
      barcodeShowText: false, barcodeModuleWidth: 3,
    },
    // ── ROM / Storage — right 16mm of top row
    {
      type: 'rom', enabled: true,
      x: 33.5, y: 0.5, w: 16, h: 4, zIndex: 1,
      fontSize: 9, bold: true, italic: false,
      align: 'right', color: '#000000',
      lineHeight: 1.0, letterSpacing: 0,
      barcodeShowText: false, barcodeModuleWidth: 3,
    },
    // ── Barcode — full width, IMEI printed underneath
    {
      type: 'barcode', enabled: true,
      x: 0.5, y: 5, w: 49, h: 9.5, zIndex: 2,
      fontSize: 0, bold: false, italic: false,
      align: 'center', color: '#000000',
      lineHeight: 1.0, letterSpacing: 0,
      barcodeShowText: true, barcodeModuleWidth: 3,
    },
    // ── Disabled fields (preserved for template editor)
    ...(['company_name', 'model_storage', 'brand', 'grade', 'ram',
         'colour', 'condition', 'selling_price', 'sku', 'inventory_id',
         'date_received', 'imei_text', 'serial_number'] as FieldType[])
      .map(t => ({ ...baseField(t, false) })),
  ],
}

// Default label: model+storage on one bold line, then barcode with IMEI
const DEFAULT_LABEL: LabelTemplate = {
  id: 'default',
  name: 'Default Phone Label',
  preset_version: PRESET_VERSION,
  marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.5, marginRight: 0.5,
  fields: [
    {
      type: 'model_storage', enabled: true,
      x: undefined, y: undefined, w: undefined, h: undefined, zIndex: undefined,
      fontSize: 0, bold: true, italic: false,
      align: 'center', color: '#000000',
      lineHeight: 1.0, letterSpacing: 0.2,
      barcodeShowText: false, barcodeModuleWidth: 3,
    },
    {
      type: 'barcode', enabled: true,
      x: undefined, y: undefined, w: undefined, h: undefined, zIndex: undefined,
      fontSize: 0, bold: false, italic: false,
      align: 'center', color: '#000000',
      lineHeight: 1.0, letterSpacing: 0,
      barcodeShowText: true, barcodeModuleWidth: 3,
    },
    ...(['company_name', 'phone_model', 'brand', 'grade', 'ram', 'rom',
         'colour', 'condition', 'selling_price', 'sku', 'inventory_id',
         'date_received', 'imei_text', 'serial_number'] as FieldType[])
      .map(t => ({ ...baseField(t, false) })),
  ],
}

const PRESET_TEMPLATES: LabelTemplate[] = [
  DEFAULT_LABEL,
  THERMAL_50x15,
  buildTemplate('barcode-only', 'Barcode Only', ['barcode']),
  buildTemplate('showroom', 'Showroom Label', ['company_name', 'phone_model', 'grade', 'colour', 'selling_price']),
  buildTemplate('warehouse', 'Warehouse Label', ['barcode', 'phone_model', 'inventory_id', 'date_received']),
  buildTemplate('accessory', 'Accessory Label', ['company_name', 'sku', 'selling_price', 'barcode']),
]

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function migrateField(f: Partial<LabelField> & { type: FieldType; enabled: boolean }): LabelField {
  return {
    ...baseField(f.type, f.enabled),
    ...f,
  } as LabelField
}

export function getTemplates(): LabelTemplate[] {
  return PRESET_TEMPLATES.map(t => ({ ...t, fields: t.fields.map(f => ({ ...f })) }))
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
  const base = copyFrom ?? PRESET_TEMPLATES[0]
  const tmpl: LabelTemplate = {
    ...base,
    id: `tmpl-${Date.now()}`,
    name,
    fields: base.fields.map(f => ({ ...f, x: undefined, y: undefined, w: undefined, h: undefined, zIndex: undefined })),
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
