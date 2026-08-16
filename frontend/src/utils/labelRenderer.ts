/**
 * Label renderer — absolute-positioned layout.
 * Every field has an explicit x/y/w/h in mm so print output
 * exactly matches the visual designer canvas.
 */

import { LabelTemplate, LabelField, FieldType, isBarcode, autoPlaceFields, needsPlacement } from '../hooks/useLabelTemplates'
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

// ─── Field value ──────────────────────────────────────────────────────────────

export function fieldValue(type: FieldType, device: DeviceForLabel, co: { name: string }): string {
  switch (type) {
    case 'company_name':  return co.name || 'COMPANY'
    case 'model_storage': return [device.brand, device.model_name, device.storage].filter(Boolean).join(' ')
    case 'phone_model':   return `${device.brand} ${device.model_name}`.trim()
    case 'brand':         return device.brand
    case 'grade':         return device.grade ? `Grade ${device.grade}` : ''
    case 'ram':           return device.ram    ? `RAM: ${device.ram}` : ''
    case 'rom':           return device.storage ?? ''
    case 'colour':        return device.colour  ? `Colour: ${device.colour}` : ''
    case 'condition':     return device.condition || ''
    case 'selling_price': return device.selling_price ? `₦${Number(device.selling_price).toLocaleString()}` : ''
    case 'sku':           return device.sku           ? `SKU: ${device.sku}` : ''
    case 'inventory_id':  return device.inventory_id  ? `ID: ${device.inventory_id}` : ''
    case 'date_received': return device.date_received  ? `Rcvd: ${device.date_received}` : ''
    case 'imei_text':     return device.imei           ? `IMEI: ${device.imei}` : ''
    case 'serial_number': return device.serial_number  ? `S/N: ${device.serial_number}` : ''
    default:              return ''
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Barcode helper ───────────────────────────────────────────────────────────

/**
 * Returns an SVG that fills `wMm × hMm`.
 * The SVG viewBox preserves bar aspect ratio; CSS width/height set physical size.
 */
function scaledBarcodeSVG(imei: string, wMm: number, hMm: number, scale: number): string {
  if (!imei) return ''
  const svg = barcodeSVG(imei, { height: 100, scale: Math.max(1, Math.round(scale)) })
  return svg.replace(
    '<svg ',
    `<svg style="width:${wMm.toFixed(2)}mm;height:${hMm.toFixed(2)}mm;display:block;" `
  )
}

// ─── Single field HTML (absolute position) ────────────────────────────────────

function renderFieldHTML(
  field: LabelField,
  device: DeviceForLabel,
  co: { name: string },
): string {
  const x = field.x ?? 0, y = field.y ?? 0
  const w = field.w ?? 30, h = field.h ?? 5

  const baseStyle =
    `position:absolute;left:${x.toFixed(2)}mm;top:${y.toFixed(2)}mm;` +
    `width:${w.toFixed(2)}mm;height:${h.toFixed(2)}mm;` +
    `overflow:hidden;box-sizing:border-box;`

  if (isBarcode(field)) {
    if (!device.imei) return ''
    // Barcode uses 92% of field width; the SVG's own quiet zones handle the rest
    const bw = w * 0.92
    const bh = h * 0.88
    const bms = field.barcodeModuleWidth ?? 2
    const svg = scaledBarcodeSVG(device.imei, bw, bh, bms)
    const justify = field.align === 'left' ? 'flex-start' : field.align === 'right' ? 'flex-end' : 'center'
    if (field.barcodeShowText) {
      const fontSize = Math.max(5, h * 0.14 * 2.835)
      return `<div style="${baseStyle}display:flex;flex-direction:column;align-items:${justify};justify-content:flex-start;gap:0.5mm;padding-top:0.3mm;">
        ${svg}
        <span style="font-size:${fontSize.toFixed(1)}pt;font-family:Arial,sans-serif;font-weight:700;letter-spacing:0.8pt;text-align:center;width:100%;">${esc(device.imei)}</span>
      </div>`
    }
    return `<div style="${baseStyle}display:flex;align-items:center;justify-content:${justify};">${svg}</div>`
  }

  const val = fieldValue(field.type, device, co)
  if (!val) return ''

  const fsPt  = field.fontSize > 0 ? field.fontSize : Math.max(5, h * 0.60 * 2.835)
  const fw    = field.bold ? 700 : 400
  const fi    = field.italic ? 'italic' : 'normal'
  const fc    = field.color || '#000000'
  const lh    = field.lineHeight || 1.1
  const ls    = field.letterSpacing || 0
  const align = field.align

  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'

  return `<div style="${baseStyle}display:flex;align-items:center;justify-content:${justify};padding:0 0.5mm;">
    <span style="font-size:${fsPt.toFixed(1)}pt;font-weight:${fw};font-style:${fi};color:${fc};text-align:${align};line-height:${lh};letter-spacing:${ls}pt;word-break:break-word;max-width:100%;">${esc(val)}</span>
  </div>`
}

// ─── Label body (all enabled fields sorted by z-index) ───────────────────────

function labelBodyHTML(template: LabelTemplate, device: DeviceForLabel): string {
  const co = getCompanySettings()
  return buildLabelElementsHTML(template, device, co)
}

/**
 * Returns the HTML for all enabled fields in the template using the exact same
 * rendering pipeline as the print output.  Import this in the designer canvas
 * so designer and print use a single shared renderer.
 */
export function buildLabelElementsHTML(
  template: LabelTemplate,
  device: DeviceForLabel,
  co: { name: string } = { name: 'COMPANY' },
): string {
  return [...template.fields]
    .filter(f => f.enabled)
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map(f => renderFieldHTML(f, device, co))
    .join('')
}

function resolveTemplate(template: LabelTemplate, size: LabelSize): LabelTemplate {
  return needsPlacement(template)
    ? autoPlaceFields(template, size.widthMm, size.heightMm)
    : template
}

// ─── Preview HTML (iframe srcDoc) ────────────────────────────────────────────

export function buildPreviewHTML(
  template: LabelTemplate,
  device: DeviceForLabel,
  size: LabelSize,
): string {
  const t = resolveTemplate(template, size)
  const w = size.widthMm, h = size.heightMm
  const { marginLeft: ml, marginRight: mr, marginTop: mt, marginBottom: mb } = t

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #e2e8f0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; font-family: Arial, sans-serif; }
  .label { position: relative; width: ${w}mm; height: ${h}mm;
    background: #fff; overflow: hidden;
    border: 0.3px solid #94a3b8; box-shadow: 0 2px 8px rgba(0,0,0,0.18); }
  .safe-area {
    position: absolute;
    left: ${ml}mm; top: ${mt}mm;
    width: ${Math.max(0, w - ml - mr)}mm; height: ${Math.max(0, h - mt - mb)}mm;
    border: 0.2mm dashed #cbd5e1; pointer-events: none;
  }
</style>
</head><body>
<div class="label">
  <div class="safe-area"></div>
  ${labelBodyHTML(t, device)}
</div>
</body></html>`
}

// ─── Print HTML (popup window) ────────────────────────────────────────────────

export function buildPrintHTML(
  template: LabelTemplate,
  devices: DeviceForLabel[],
  size: LabelSize,
  allSizes: LabelSize[],
  allTemplates: LabelTemplate[],
  copies: number,
): string {
  const t = resolveTemplate(template, size)
  const w = size.widthMm, h = size.heightMm

  const rows: DeviceForLabel[] = []
  for (const d of devices) for (let i = 0; i < copies; i++) rows.push(d)

  const labelsHtml = rows.map(d =>
    `<div style="position:relative;width:${w}mm;height:${h}mm;overflow:hidden;background:#fff;page-break-after:always;break-after:page;">${labelBodyHTML(t, d)}</div>`
  ).join('\n')

  const sizeOptions = allSizes.map(s =>
    `<option value="${esc(s.id)}" ${s.id === size.id ? 'selected' : ''}>${esc(s.name)} (${s.widthMm}\xd7${s.heightMm}mm)</option>`
  ).join('')
  const tmplOptions = allTemplates.map(t2 =>
    `<option value="${esc(t2.id)}" ${t2.id === template.id ? 'selected' : ''}>${esc(t2.name)}</option>`
  ).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print Labels</title>
<style>
@page { margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: Arial, sans-serif; background: #e2e8f0; }
.toolbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  display: flex; gap: 8px; align-items: center; flex-wrap: nowrap;
  padding: 6px 12px; background: #0f172a; color: #fff; min-height: 44px;
}
.toolbar select, .toolbar input {
  padding: 4px 7px; border-radius: 5px; border: 1px solid #475569;
  background: #1e293b; color: #fff; font-size: 12px;
}
.toolbar button { padding: 5px 14px; border-radius: 5px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; }
.spacer { flex: 1; }
.print-tip {
  font-size: 10px; color: #fbbf24; background: #1e293b; border: 1px solid #fbbf24;
  border-radius: 4px; padding: 3px 8px; white-space: nowrap;
}
.wrap { padding-top: 56px; display: flex; flex-direction: column; align-items: center; gap: 8px; padding-bottom: 16px; }
#__printErr {
  display: none; position: fixed; top: 50px; left: 0; right: 0; z-index: 99999;
  background: #fee2e2; color: #991b1b; border-bottom: 2px solid #f87171;
  padding: 10px 20px; font-size: 13px; text-align: center;
}
@media print {
  .toolbar, #__printErr { display: none !important; }
  html, body {
    margin: 0 !important; padding: 0 !important;
    background: #fff !important; width: ${w}mm !important;
  }
  /* Block layout so each label starts at top-left of its page, not centred */
  .wrap {
    display: block !important;
    margin: 0 !important; padding: 0 !important; gap: 0 !important;
    background: #fff !important; width: ${w}mm !important;
  }
}
</style>
</head><body>
<div id="__printErr"></div>
<div class="toolbar">
  <span style="font-weight:700;color:#38bdf8;margin-right:4px;">Labels</span>
  <span class="print-tip">⚠ Print dialog: Margins=None · Scale=100% · No headers/footers · Printer paper size must be set to ${w}×${h}mm in Windows printer settings</span>
  <label style="font-size:11px;color:#94a3b8;">Template:</label>
  <select id="tmplSel">${tmplOptions}</select>
  <label style="font-size:11px;color:#94a3b8;">Size:</label>
  <select id="sizeSel">${sizeOptions}</select>
  <label style="font-size:11px;color:#94a3b8;">Copies:</label>
  <input id="copiesIn" type="number" value="${copies}" min="1" max="50" style="width:52px;">
  <span style="font-size:10px;color:#64748b;">${w}×${h}mm</span>
  <div class="spacer"></div>
  <button id="__printBtn" style="background:#22c55e;color:#fff;" onclick="doPrint()">🖨 Print</button>
  <button style="background:#ef4444;color:#fff;" onclick="window.close()">✕ Close</button>
</div>
<div class="wrap">${labelsHtml}</div>
<script>
(function() {
  var _printed = false;

  function showError(msg) {
    var el = document.getElementById('__printErr');
    if (el) { el.textContent = '⚠ Print error: ' + msg; el.style.display = 'block'; }
  }

  /* Exposed globally so the toolbar button can call it too */
  window.doPrint = function() {
    document.getElementById('__printErr').style.display = 'none';
    try {
      window.focus(); /* ensure window has focus — critical for WebView2 */
      window.print();
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    }
  };

  /* Close preview automatically when print dialog is dismissed (print or cancel) */
  window.addEventListener('afterprint', function() {
    window.close();
  });

  /* Auto-trigger print once the page is fully painted.
     Two requestAnimationFrame calls guarantee at least one layout+paint cycle
     has completed — no arbitrary timeouts needed. */
  function autoPrint() {
    if (_printed) return;
    _printed = true;
    if (typeof document.fonts !== 'undefined' && document.fonts.ready) {
      document.fonts.ready.then(function() {
        requestAnimationFrame(function() {
          requestAnimationFrame(window.doPrint);
        });
      }).catch(function() {
        requestAnimationFrame(function() {
          requestAnimationFrame(window.doPrint);
        });
      });
    } else {
      requestAnimationFrame(function() {
        requestAnimationFrame(window.doPrint);
      });
    }
  }

  if (document.readyState === 'complete') {
    autoPrint();
  } else {
    window.addEventListener('load', autoPrint);
  }

  /* Template / size / copies re-render for the toolbar selectors */
  var _sizes=${JSON.stringify(allSizes)},_tmpls=${JSON.stringify(allTemplates)};
  function rerender(){
    var sz=_sizes.find(function(s){return s.id===document.getElementById('sizeSel').value;})||_sizes[0];
    var tm=_tmpls.find(function(t){return t.id===document.getElementById('tmplSel').value;})||_tmpls[0];
    var cp=parseInt(document.getElementById('copiesIn').value)||1;
    if(window.opener&&window.opener.__labelRerender){
      _printed = false; /* allow auto-print after rerender */
      window.opener.__labelRerender(sz,tm,cp);
    }
  }
  ['sizeSel','tmplSel','copiesIn'].forEach(function(id){document.getElementById(id).addEventListener('change',rerender);});
})();
</script>
</body></html>`
}

// ─── Calibration print ────────────────────────────────────────────────────────

export function buildCalibrationHTML(widthMm: number, heightMm: number): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Label Calibration ${widthMm}×${heightMm}mm</title>
<style>
@page { margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: Arial, sans-serif; }
.label {
  width: ${widthMm}mm; height: ${heightMm}mm;
  border: 0.5mm solid #000;
  position: relative; overflow: hidden;
}
.ch { position: absolute; left: 0; right: 0; top: 50%; border-top: 0.2mm dashed #aaa; }
.cv { position: absolute; top: 0; bottom: 0; left: 50%; border-left: 0.2mm dashed #aaa; }
.corner { position: absolute; width: 3mm; height: 3mm; border-color: #000; border-style: solid; }
.tl { top: 0; left: 0; border-width: 0.4mm 0 0 0.4mm; }
.tr { top: 0; right: 0; border-width: 0.4mm 0.4mm 0 0; }
.bl { bottom: 0; left: 0; border-width: 0 0 0.4mm 0.4mm; }
.br { bottom: 0; right: 0; border-width: 0 0.4mm 0.4mm 0; }
.info { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-55%); text-align: center; }
.info-big { font-size: 6pt; font-weight: bold; }
.info-sm  { font-size: 5pt; color: #555; }
@media screen {
  body { background: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .tip { margin-top: 18px; font-size: 13px; color: #475569; text-align: center; max-width: 380px; line-height: 1.6; }
}
@media print { .tip { display: none; } }
</style></head><body>
<div class="label">
  <div class="corner tl"></div><div class="corner tr"></div>
  <div class="corner bl"></div><div class="corner br"></div>
  <div class="ch"></div><div class="cv"></div>
  <div class="info">
    <div class="info-big">${widthMm} × ${heightMm} mm</div>
    <div class="info-sm">Measure the black border</div>
  </div>
</div>
<div class="tip">
  <strong>Calibration label — ${widthMm} × ${heightMm} mm</strong><br>
  Print this page and measure the outer black rectangle.<br>
  Width should be <strong>${widthMm} mm</strong>, height should be <strong>${heightMm} mm</strong>.<br>
  <em>In the print dialog: set Margins to <strong>None</strong> and uncheck Headers &amp; Footers.</em>
</div>
<script>
(function() {
  function doPrint() {
    try { window.focus(); window.print(); } catch(e) {}
  }
  window.addEventListener('afterprint', function() { window.close(); });
  if (document.readyState === 'complete') {
    requestAnimationFrame(function() { requestAnimationFrame(doPrint); });
  } else {
    window.addEventListener('load', function() {
      requestAnimationFrame(function() { requestAnimationFrame(doPrint); });
    });
  }
})();
</script>
</body></html>`
}
