/**
 * Label rendering engine.
 *
 * Layout rules (matches commercial POS label printers):
 *   1. Usable area = label size minus per-template margins.
 *   2. Enabled fields share the usable height proportionally.
 *      Barcode rows receive 3× the weight of a text row.
 *   3. Font sizes auto-calculate from row height when field.fontSize === 0.
 *   4. Barcode SVG fills the full usable width so it can never be clipped.
 *   5. Nothing ever renders outside the usable area.
 */

import { LabelTemplate, LabelField, FieldType, isBarcode } from '../hooks/useLabelTemplates'
import { LabelSize } from '../hooks/useLabelSizes'
import { getCompanySettings } from '../hooks/useCompanySettings'
import { barcodeSVG } from './barcode'

// ─── Public device interface ──────────────────────────────────────────────────

export interface DeviceForLabel {
  imei: string
  brand: string
  model_name: string
  ram?: string
  storage?: string
  colour?: string
  grade?: string
  condition?: string
  selling_price?: string | number
  sku?: string
  inventory_id?: string
  date_received?: string
  serial_number?: string
}

export const SAMPLE_DEVICE: DeviceForLabel = {
  imei: '352800112345678',
  brand: 'Samsung',
  model_name: 'Galaxy S21',
  ram: '8 GB',
  storage: '128 GB',
  colour: 'Phantom Gray',
  grade: 'A',
  condition: 'Refurbished',
  selling_price: '185000',
  sku: 'SAM-GS21-8-128',
  inventory_id: 'INV-0042',
  date_received: new Date().toISOString().slice(0, 10),
  serial_number: 'R58N80JXYZW',
}

// ─── Auto-layout computation ──────────────────────────────────────────────────

interface Layout {
  uw: number        // usable width (mm)
  uh: number        // usable height (mm)
  ml: number; mr: number; mt: number; mb: number
  unitH: number     // mm per text-weight unit
  barcodeH: number  // mm allocated to a barcode row
  textH: number     // mm allocated to a text row
  autoFontPt: number  // auto font size (pt) for text rows
}

const BARCODE_WEIGHT = 3   // barcode row = 3× a text row
const MIN_FONT_PT    = 5

function computeLayout(template: LabelTemplate, w: number, h: number): Layout {
  const ml = template.marginLeft  ?? 2
  const mr = template.marginRight ?? 2
  const mt = template.marginTop   ?? 1.5
  const mb = template.marginBottom ?? 1.5

  const uw = Math.max(2, w - ml - mr)
  const uh = Math.max(2, h - mt - mb)

  const enabled = template.fields.filter(f => f.enabled)
  const totalWeight = enabled.reduce((s, f) => s + (isBarcode(f) ? BARCODE_WEIGHT : 1), 0) || 1

  const unitH      = uh / totalWeight
  const textH      = unitH
  const barcodeH   = unitH * BARCODE_WEIGHT
  // Font: 70% of row height converted pt (1mm = 2.835pt)
  const autoFontPt = Math.max(MIN_FONT_PT, textH * 0.70 * 2.835)

  return { uw, uh, ml, mr, mt, mb, unitH, barcodeH, textH, autoFontPt }
}

// ─── Field value helpers ──────────────────────────────────────────────────────

function fieldValue(type: FieldType, device: DeviceForLabel, co: { name: string }): string {
  switch (type) {
    case 'company_name':  return co.name || 'Company'
    case 'phone_model':   return `${device.brand} ${device.model_name}`.trim()
    case 'brand':         return device.brand
    case 'grade':         return device.grade ? `Grade ${device.grade}` : ''
    case 'ram':           return device.ram  ? `RAM: ${device.ram}` : ''
    case 'rom':           return device.storage ? `ROM: ${device.storage}` : ''
    case 'colour':        return device.colour  ? `Colour: ${device.colour}` : ''
    case 'condition':     return device.condition || ''
    case 'selling_price': return device.selling_price ? `₦${Number(device.selling_price).toLocaleString()}` : ''
    case 'sku':           return device.sku          ? `SKU: ${device.sku}` : ''
    case 'inventory_id':  return device.inventory_id ? `ID: ${device.inventory_id}` : ''
    case 'date_received': return device.date_received ? `Rcvd: ${device.date_received}` : ''
    case 'imei_text':     return device.imei ? `IMEI: ${device.imei}` : ''
    case 'serial_number': return device.serial_number ? `S/N: ${device.serial_number}` : ''
    default:              return ''
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Barcode rendering ────────────────────────────────────────────────────────

/**
 * Render barcode SVG scaled to exactly `wMm` × `hMm`.
 * The SVG has a viewBox so the browser scales bars proportionally.
 * Internal quiet zones (margin=8 units in barcode.ts) scale with the rest —
 * no bar will ever touch the edge of the usable area.
 */
function scaledBarcode(imei: string, wMm: number, hMm: number): string {
  if (!imei) return ''
  // Generate at high internal resolution; we'll override display size via CSS.
  const svg = barcodeSVG(imei, { height: 100, scale: 2 })

  // Inject CSS dimensions — the viewBox preserves the aspect ratio automatically.
  const styled = svg.replace(
    '<svg ',
    `<svg style="width:${wMm.toFixed(2)}mm;height:${hMm.toFixed(2)}mm;display:block;max-width:100%;" `
  )
  return styled
}

// ─── Single-field HTML ────────────────────────────────────────────────────────

function renderFieldHTML(
  field: LabelField,
  device: DeviceForLabel,
  co: { name: string },
  layout: Layout,
): string {
  const rowH  = isBarcode(field) ? layout.barcodeH : layout.textH
  const rowHStyle = `height:${rowH.toFixed(2)}mm;flex-shrink:0;`

  if (isBarcode(field)) {
    if (!device.imei) return ''
    // Barcode fills 90% of the usable width; the SVG's own quiet zones handle the rest.
    const bw = layout.uw * 0.95
    const bh = rowH * 0.85   // leave a little vertical breathing room
    const flexJustify = field.align === 'left' ? 'flex-start' : field.align === 'right' ? 'flex-end' : 'center'
    return `<div style="${rowHStyle}display:flex;align-items:center;justify-content:${flexJustify};">
      ${scaledBarcode(device.imei, bw, bh)}
    </div>`
  }

  const val = fieldValue(field.type, device, co)
  if (!val) return `<div style="${rowHStyle}"></div>`

  const fsPt  = field.fontSize > 0 ? field.fontSize : layout.autoFontPt
  const fw    = field.bold ? 700 : 400
  const align = field.align

  return `<div style="${rowHStyle}display:flex;align-items:center;justify-content:${align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'};overflow:hidden;">
    <span style="font-size:${fsPt.toFixed(1)}pt;font-weight:${fw};text-align:${align};line-height:1.1;word-break:break-word;max-width:100%;">${esc(val)}</span>
  </div>`
}

// ─── Full label body ──────────────────────────────────────────────────────────

function labelBody(template: LabelTemplate, device: DeviceForLabel, layout: Layout): string {
  const co = getCompanySettings()
  return template.fields
    .filter(f => f.enabled)
    .map(f => renderFieldHTML(f, device, co, layout))
    .join('')
}

// ─── Label wrapper CSS ────────────────────────────────────────────────────────

function labelCSS(w: number, h: number, ml: number, mr: number, mt: number, mb: number): string {
  return [
    `width:${w}mm`,
    `height:${h}mm`,
    `padding-top:${mt}mm`,
    `padding-bottom:${mb}mm`,
    `padding-left:${ml}mm`,
    `padding-right:${mr}mm`,
    'display:flex',
    'flex-direction:column',
    'align-items:stretch',
    'overflow:hidden',
    'box-sizing:border-box',
    'background:#fff',
    'font-family:Arial,Helvetica,sans-serif',
  ].join(';')
}

// ─── Public: preview HTML (iframe srcDoc) ────────────────────────────────────

export function buildPreviewHTML(
  template: LabelTemplate,
  device: DeviceForLabel,
  size: LabelSize,
): string {
  const { widthMm: w, heightMm: h } = size
  const layout = computeLayout(template, w, h)
  const { ml, mr, mt, mb } = layout
  const body = labelBody(template, device, layout)

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #e2e8f0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; }
  .label { ${labelCSS(w, h, ml, mr, mt, mb)};
    border: 0.5px solid #94a3b8; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
</style>
</head><body>
<div class="label">${body}</div>
</body></html>`
}

// ─── Public: print HTML (popup window) ───────────────────────────────────────

function printPageCSS(w: number, h: number): string {
  const orientation = w >= h ? 'landscape' : 'portrait'
  return `
@page { size: ${w}mm ${h}mm ${orientation}; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #e2e8f0; font-family: Arial, sans-serif; }
.toolbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  display: flex; gap: 8px; align-items: center; flex-wrap: nowrap;
  padding: 6px 12px; background: #0f172a; color: #fff; font-size: 13px;
  min-height: 44px;
}
.toolbar select, .toolbar input {
  padding: 4px 7px; border-radius: 5px; border: 1px solid #475569;
  background: #1e293b; color: #fff; font-size: 12px;
}
.toolbar button {
  padding: 5px 14px; border-radius: 5px; border: none;
  cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap;
}
.btn-print { background: #22c55e; color: #fff; }
.btn-close  { background: #ef4444; color: #fff; }
.spacer { flex: 1; }
.labels-wrap { padding-top: 52px; display: flex; flex-direction: column; align-items: center; gap: 8px; padding-bottom: 16px; }
@media print {
  .toolbar { display: none !important; }
  .labels-wrap { padding: 0; gap: 0; background: #fff; }
  .label { page-break-after: always; break-after: page; }
}`
}

export function buildPrintHTML(
  template: LabelTemplate,
  devices: DeviceForLabel[],
  size: LabelSize,
  allSizes: LabelSize[],
  allTemplates: LabelTemplate[],
  copies: number,
): string {
  const { widthMm: w, heightMm: h } = size
  const layout  = computeLayout(template, w, h)
  const { ml, mr, mt, mb } = layout

  const rows: DeviceForLabel[] = []
  for (const d of devices) for (let i = 0; i < copies; i++) rows.push(d)

  const labelsHtml = rows.map(d =>
    `<div style="${labelCSS(w, h, ml, mr, mt, mb)};page-break-after:always;break-after:page;">${labelBody(template, d, layout)}</div>`
  ).join('\n')

  const sizeOptions = allSizes.map(s =>
    `<option value="${esc(s.id)}" ${s.id === size.id ? 'selected' : ''}>${esc(s.name)} (${s.widthMm}\xd7${s.heightMm}mm)</option>`
  ).join('')
  const tmplOptions = allTemplates.map(t =>
    `<option value="${esc(t.id)}" ${t.id === template.id ? 'selected' : ''}>${esc(t.name)}</option>`
  ).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print Labels</title>
<style>${printPageCSS(w, h)}</style>
</head><body>
<div class="toolbar">
  <span style="font-weight:700;color:#38bdf8;margin-right:6px;">Labels</span>
  <label style="font-size:11px;color:#94a3b8;">Template:</label>
  <select id="tmplSel">${tmplOptions}</select>
  <label style="font-size:11px;color:#94a3b8;">Size:</label>
  <select id="sizeSel">${sizeOptions}</select>
  <label style="font-size:11px;color:#94a3b8;">Copies:</label>
  <input id="copiesIn" type="number" value="${copies}" min="1" max="50" style="width:52px;">
  <div class="spacer"></div>
  <button class="btn-print" onclick="window.print()">🖨 Print</button>
  <button class="btn-close" onclick="window.close()">✕ Close</button>
</div>
<div class="labels-wrap">${labelsHtml}</div>
<script>
var _sizes = ${JSON.stringify(allSizes)};
var _tmpls = ${JSON.stringify(allTemplates)};
function rerender() {
  var sizeId  = document.getElementById('sizeSel').value;
  var tmplId  = document.getElementById('tmplSel').value;
  var copies  = parseInt(document.getElementById('copiesIn').value) || 1;
  var sz = _sizes.find(function(s){ return s.id === sizeId; }) || _sizes[0];
  var tm = _tmpls.find(function(t){ return t.id === tmplId; }) || _tmpls[0];
  if (window.opener && window.opener.__labelRerender) {
    window.opener.__labelRerender(sz, tm, copies);
  }
}
['sizeSel','tmplSel','copiesIn'].forEach(function(id){
  document.getElementById(id).addEventListener('change', rerender);
});
</script>
</body></html>`
}
