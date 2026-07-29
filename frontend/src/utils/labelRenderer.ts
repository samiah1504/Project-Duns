import { LabelTemplate, LabelField, FieldType } from '../hooks/useLabelTemplates'
import { LabelSize } from '../hooks/useLabelSizes'
import { getCompanySettings } from '../hooks/useCompanySettings'
import { barcodeSVG } from './barcode'

export interface DeviceForLabel {
  imei: string
  brand: string
  model_name: string
  ram?: string
  storage?: string    // ROM
  colour?: string
  grade?: string
  condition?: string
  selling_price?: string | number
  sku?: string
  inventory_id?: string
  date_received?: string
  serial_number?: string
}

const SAMPLE_DEVICE: DeviceForLabel = {
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

function getFieldValue(field: LabelField, device: DeviceForLabel, co: { name: string }): string {
  switch (field.type as FieldType) {
    case 'company_name': return co.name || 'Company Name'
    case 'phone_model': return `${device.brand} ${device.model_name}`
    case 'brand': return device.brand
    case 'grade': return device.grade ? `Grade: ${device.grade}` : 'Grade: —'
    case 'ram': return device.ram ? `RAM: ${device.ram}` : ''
    case 'rom': return device.storage ? `ROM: ${device.storage}` : ''
    case 'colour': return device.colour ? `Colour: ${device.colour}` : ''
    case 'condition': return device.condition || ''
    case 'selling_price': return device.selling_price ? `₦${Number(device.selling_price).toLocaleString()}` : ''
    case 'sku': return device.sku ? `SKU: ${device.sku}` : ''
    case 'inventory_id': return device.inventory_id ? `ID: ${device.inventory_id}` : ''
    case 'date_received': return device.date_received ? `Rcvd: ${device.date_received}` : ''
    case 'imei_text': return device.imei ? `IMEI: ${device.imei}` : ''
    case 'serial_number': return device.serial_number ? `S/N: ${device.serial_number}` : ''
    default: return ''
  }
}

function renderField(field: LabelField, device: DeviceForLabel, co: { name: string }, labelW: number): string {
  const type = field.type as FieldType

  const ptop = `${field.paddingTop}mm`
  const pbot = `${field.paddingBottom}mm`
  const align = field.align

  if (type === 'barcode' || type === 'qr_code') {
    if (!device.imei) return ''
    const barcodeH = field.barcodeHeight ?? 12
    const scale = field.barcodeModuleWidth ?? 2
    let svg = barcodeSVG(device.imei, { height: barcodeH * 3.78, scale })
    // inject style into the SVG tag to make it responsive
    svg = svg.replace('<svg ', `<svg style="height:${barcodeH}mm;width:auto;max-width:90%;display:block;" `)
    return `
      <div style="padding-top:${ptop};padding-bottom:${pbot};text-align:${align};width:100%;">
        <div style="display:inline-block;">${svg}</div>
      </div>`
  }

  const value = getFieldValue(field, device, co)
  if (!value) return ''

  return `
    <div style="
      padding-top:${ptop};
      padding-bottom:${pbot};
      text-align:${align};
      font-size:${field.fontSize}pt;
      font-weight:${field.bold ? 700 : 400};
      width:100%;
      box-sizing:border-box;
      word-break:break-word;
      line-height:1.2;
    ">${escHtml(value)}</div>`
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildLabelBody(template: LabelTemplate, device: DeviceForLabel): string {
  const co = getCompanySettings()
  return template.fields
    .filter(f => f.enabled)
    .map(f => renderField(f, device, co, 0))
    .join('')
}

function pageCSS(w: number, h: number): string {
  const orientation = w >= h ? 'landscape' : 'portrait'
  return `
    @page { size: ${w}mm ${h}mm ${orientation}; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #fff; }
    .toolbar { position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      display: flex; gap: 8px; align-items: center; padding: 6px 12px;
      background: #0f172a; color: #fff; font-family: sans-serif; font-size: 13px; }
    .toolbar select, .toolbar input { padding: 4px 7px; border-radius: 5px; border: 1px solid #475569;
      background: #1e293b; color: #fff; font-size: 12px; }
    .toolbar button { padding: 5px 14px; border-radius: 5px; border: none; cursor: pointer;
      font-size: 12px; font-weight: 600; }
    .toolbar .btn-print { background: #22c55e; color: #fff; }
    .toolbar .btn-close { background: #ef4444; color: #fff; }
    .spacer { flex: 1; }
    .labels-wrap { padding-top: 44px; }
    .label { width: ${w}mm; min-height: ${h}mm; display: flex; flex-direction: column;
      align-items: center; justify-content: center; overflow: hidden;
      page-break-after: always; padding: 1mm; }
    @media print {
      .toolbar { display: none !important; }
      .labels-wrap { padding-top: 0; }
      .label { page-break-after: always; }
    }
  `
}

export function buildPrintHTML(
  template: LabelTemplate,
  devices: DeviceForLabel[],
  size: LabelSize,
  allSizes: LabelSize[],
  allTemplates: LabelTemplate[],
  copies: number,
): string {
  const w = size.widthMm
  const h = size.heightMm

  // expand devices by copies
  const rows: DeviceForLabel[] = []
  for (const d of devices) for (let i = 0; i < copies; i++) rows.push(d)

  const labelsHtml = rows.map(d =>
    `<div class="label">${buildLabelBody(template, d)}</div>`
  ).join('')

  const sizeOptions = allSizes.map(s =>
    `<option value="${escHtml(s.id)}" ${s.id === size.id ? 'selected' : ''}>${escHtml(s.name)} (${s.widthMm}×${s.heightMm}mm)</option>`
  ).join('')
  const tmplOptions = allTemplates.map(t =>
    `<option value="${escHtml(t.id)}" ${t.id === template.id ? 'selected' : ''}>${escHtml(t.name)}</option>`
  ).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Print Labels</title>
<style>${pageCSS(w, h)}</style>
</head><body>
<div class="toolbar">
  <span style="font-weight:700;color:#38bdf8;margin-right:4px;">Labels</span>
  <label style="font-size:11px;color:#94a3b8;">Template:</label>
  <select id="tmplSel">${tmplOptions}</select>
  <label style="font-size:11px;color:#94a3b8;">Size:</label>
  <select id="sizeSel">${sizeOptions}</select>
  <label style="font-size:11px;color:#94a3b8;">Copies:</label>
  <input id="copiesIn" type="number" value="${copies}" min="1" max="50" style="width:52px;">
  <div class="spacer"></div>
  <button class="btn-print" onclick="window.print()">Print</button>
  <button class="btn-close" onclick="window.close()">Close</button>
</div>
<div class="labels-wrap" id="labelsWrap">${labelsHtml}</div>
<script>
var _sizes = ${JSON.stringify(allSizes)};
var _tmpls = ${JSON.stringify(allTemplates)};
var _devices = ${JSON.stringify(devices)};

function rerender() {
  var sizeId = document.getElementById('sizeSel').value;
  var tmplId = document.getElementById('tmplSel').value;
  var copies = parseInt(document.getElementById('copiesIn').value) || 1;
  var size = _sizes.find(function(s){return s.id===sizeId;}) || _sizes[0];
  var tmpl = _tmpls.find(function(t){return t.id===tmplId;}) || _tmpls[0];
  window._pendingRerender = {size: size, tmpl: tmpl, copies: copies};
  // post message to parent to re-open
  if(window.opener && window.opener.__labelRerender) {
    window.opener.__labelRerender(size, tmpl, copies);
  }
}

document.getElementById('sizeSel').addEventListener('change', rerender);
document.getElementById('tmplSel').addEventListener('change', rerender);
document.getElementById('copiesIn').addEventListener('change', rerender);
</script>
</body></html>`
}

export function buildPreviewHTML(template: LabelTemplate, device: DeviceForLabel, size: LabelSize): string {
  const w = size.widthMm
  const h = size.heightMm
  const body = buildLabelBody(template, device)

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f1f5f9; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; font-family: Arial, sans-serif; }
  .label { width: ${w}mm; min-height: ${h}mm; background: #fff;
    border: 1px solid #cbd5e1; border-radius: 2px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    overflow: hidden; padding: 1mm; }
</style>
</head><body>
<div class="label">${body}</div>
</body></html>`
}

export { SAMPLE_DEVICE }
