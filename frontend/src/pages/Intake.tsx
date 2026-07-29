import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getCompanySettings } from '../hooks/useCompanySettings'
import {
  getLabelSizes, getSelectedLabelSize, saveSelectedLabelSizeId, LabelSize,
} from '../hooks/useLabelSizes'
import {
  getPurchaseOrders, getSuppliers, createPurchaseOrder,
  receivePurchaseOrder, getPODevices,
} from '../services/api'
import { PurchaseOrder, Supplier, DeviceWithModel } from '../types'
import {
  PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select, fmt,
} from '../components/Layout'

// ─── Label printing ───────────────────────────────────────────────────────────

interface LabelDevice {
  imei: string
  brand: string
  model_name: string
  ram: string
  storage: string
  colour: string
}

/**
 * Responsive label engine.
 *
 * All dimensions are in mm. Font sizes are derived from the label area so the
 * layout adapts to any selected size without clipping or rotation issues.
 *
 * The @page rule sets the exact paper size and strips all browser margins,
 * headers and footers. Orientation is implicit: width < height → portrait,
 * width > height → landscape — the browser respects whichever the @page size
 * declares without needing an explicit orientation keyword.
 */
function buildLabelHTML(devices: LabelDevice[], size: LabelSize): string {
  const co = getCompanySettings()
  const w = size.widthMm
  const h = size.heightMm

  // Drive all sizing off the smaller dimension (usually height on a label).
  // 1 mm = 2.835 pt. Multiply the mm fraction by 2.835 to get pt.
  const ref = Math.min(w, h)
  const pt = (fraction: number) => `${(ref * fraction * 2.835).toFixed(2)}pt`
  const mm = (fraction: number) => `${(ref * fraction).toFixed(2)}mm`

  // Model text: shrink slightly for long names so nothing is clipped.
  const modelFontForDevice = (d: LabelDevice) => {
    const name = `${d.brand} ${d.model_name}`
    const fraction = name.length > 22 ? 0.11 : 0.13
    return pt(fraction)
  }

  const labels = devices.map((d) => {
    const model = `${d.brand} ${d.model_name}`
    const ramRom = [d.ram && `RAM: ${d.ram}`, d.storage && `ROM: ${d.storage}`]
      .filter(Boolean).join(' | ')
    return `
      <div class="label">
        <div class="company">${co.name}</div>
        <div class="model" style="font-size:${modelFontForDevice(d)}">${model}</div>
        ${ramRom ? `<div class="specs">${ramRom}</div>` : ''}
        ${d.colour ? `<div class="colour">Colour: ${d.colour}</div>` : ''}
        <div class="imei-label">IMEI</div>
        <div class="imei">${d.imei}</div>
      </div>`
  }).join('')

  // Explicit orientation keyword so browsers/drivers don't guess wrong.
  const orientation = w >= h ? 'landscape' : 'portrait'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Phone Labels</title>
<style>
  @page {
    size: ${w}mm ${h}mm ${orientation};
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Screen styles ─────────────────────────────────────────────────────── */
  html {
    font-family: Arial, Helvetica, sans-serif;
    background: #e2e8f0;
  }
  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #e2e8f0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    /* Do NOT constrain body width here — that's what broke the toolbar */
  }
  .toolbar {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 100;
    padding: 10px 16px;
    background: #1e293b;
    color: #fff;
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: nowrap;
    min-height: 44px;
  }
  .grid {
    margin-top: 56px; /* clear the fixed toolbar */
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
    gap: 12px;
  }
  .label {
    width: ${w}mm;
    height: ${h}mm;
    padding: ${mm(0.05)};
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: ${mm(0.04)};
    text-align: center;
    background: #fff;
    border: 0.3mm solid #ccc;
    box-shadow: 0 1px 4px rgba(0,0,0,0.12);
    overflow: hidden;
  }

  /* ── Type styles ───────────────────────────────────────────────────────── */
  .company {
    font-size: ${pt(0.10)};
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: #111;
    line-height: 1.2;
  }
  .model {
    font-weight: 700;
    color: #111;
    line-height: 1.2;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .specs {
    font-size: ${pt(0.09)};
    font-weight: 500;
    color: #333;
    line-height: 1.2;
  }
  .colour {
    font-size: ${pt(0.09)};
    font-weight: 500;
    color: #444;
    line-height: 1.2;
  }
  .imei-label {
    font-size: ${pt(0.09)};
    font-weight: 700;
    color: #111;
    letter-spacing: 0.5px;
    line-height: 1.2;
  }
  .imei {
    font-size: ${pt(0.17)};
    font-weight: 700;
    font-family: 'Courier New', Courier, monospace;
    color: #000;
    letter-spacing: 0.5px;
    line-height: 1.2;
    word-break: break-all;
  }

  /* ── Print overrides ───────────────────────────────────────────────────── */
  @media print {
    html, body { background: #fff; margin: 0; padding: 0; }
    .toolbar { display: none !important; }
    .grid { margin-top: 0; padding: 0; gap: 0; align-items: flex-start; background: #fff; }
    .label { border: none; box-shadow: none; page-break-after: always; break-after: page; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <span style="flex:1;font-size:13px;white-space:nowrap">${devices.length} label(s) — ${size.name}</span>
    <label style="font-size:12px;color:#94a3b8;white-space:nowrap">Size:
      <select id="sizeSelect" style="margin-left:6px;padding:4px 8px;border-radius:4px;border:none;font-size:12px">
        ${getLabelSizes().map(s =>
          `<option value="${s.id}" ${s.id === size.id ? 'selected' : ''}>${s.name}</option>`
        ).join('')}
      </select>
    </label>
    <button onclick="window.print()" style="padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700;white-space:nowrap">🖨 Print</button>
    <button onclick="window.close()" style="padding:6px 16px;background:#475569;color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap">Close</button>
  </div>
  <div class="grid">${labels}</div>
  <script>
    document.getElementById('sizeSelect').addEventListener('change', function() {
      window.__onSizeChange && window.__onSizeChange(this.value)
    })
  </script>
</body>
</html>`
}

function printDeviceLabels(devices: LabelDevice[], size?: LabelSize) {
  if (!devices.length) return
  const selectedSize = size ?? getSelectedLabelSize()
  if (!selectedSize) {
    toast.error('No label size configured. Go to Settings → Label Printing Sizes and add one.')
    return
  }
  const sizes = getLabelSizes()
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) { toast.error('Pop-up blocked — please allow pop-ups for this page'); return }

  type PopupWindow = typeof window & {
    __labelSizes: LabelSize[]
    __onSizeChange: (id: string) => void
  }
  const pw = w as PopupWindow

  function renderInPopup(renderSize: LabelSize) {
    pw.__labelSizes = sizes
    pw.document.open()
    pw.document.write(buildLabelHTML(devices, renderSize))
    pw.document.close()
    pw.__onSizeChange = (id: string) => {
      const next = sizes.find(s => s.id === id) ?? renderSize
      saveSelectedLabelSizeId(id)
      renderInPopup(next)
    }
  }

  renderInPopup(selectedSize)
}

function deviceToLabel(d: DeviceWithModel): LabelDevice {
  return {
    imei: d.imei,
    brand: d.model?.brand ?? '',
    model_name: d.model?.model_name ?? '',
    ram: d.model?.ram ?? '',
    storage: d.model?.storage ?? '',
    colour: d.model?.colour ?? '',
  }
}

// ─── PO Devices panel ─────────────────────────────────────────────────────────

function PODevicesPanel({ poId, poNumber }: { poId: string; poNumber: string }) {
  const { data: devices = [], isLoading } = useQuery<DeviceWithModel[]>({
    queryKey: ['po-devices', poId],
    queryFn: () => getPODevices(poId).then(r => r.data),
  })

  if (isLoading) return <div style={{ padding: 12, color: '#64748b', fontSize: 13 }}>Loading devices…</div>
  if (!devices.length) return <div style={{ padding: 12, color: '#94a3b8', fontSize: 13 }}>No devices yet.</div>

  return (
    <div style={{ padding: '8px 16px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          {devices.length} device(s) in this PO
        </span>
        <Btn size="sm" variant="ghost" onClick={() => printDeviceLabels(devices.map(deviceToLabel))}>
          🖨 Print All Barcodes
        </Btn>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
            {['IMEI', 'Model', 'RAM', 'ROM', 'Colour', 'Grade', 'Cost', 'Status', ''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#64748b', fontSize: 11, fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(devices as DeviceWithModel[]).map(d => (
            <tr key={d.id} style={{ borderBottom: '1px solid #f8fafc' }}>
              <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{d.imei}</td>
              <td style={{ padding: '6px 8px' }}>{d.model?.brand} {d.model?.model_name}</td>
              <td style={{ padding: '6px 8px' }}>{d.model?.ram ?? '—'}</td>
              <td style={{ padding: '6px 8px' }}>{d.model?.storage ?? '—'}</td>
              <td style={{ padding: '6px 8px' }}>{d.model?.colour ?? '—'}</td>
              <td style={{ padding: '6px 8px' }}><strong>{d.grade}</strong></td>
              <td style={{ padding: '6px 8px' }}>{fmt(d.purchase_cost)}</td>
              <td style={{ padding: '6px 8px' }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                  background: '#fef3c7', color: '#92400e',
                }}>{d.status.replace(/_/g, ' ')}</span>
              </td>
              <td style={{ padding: '6px 8px' }}>
                <Btn size="sm" variant="secondary" onClick={() => printDeviceLabels([deviceToLabel(d)])}>
                  🖨 Label
                </Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── New PO Modal ─────────────────────────────────────────────────────────────

const RAM_OPTIONS = ['4GB', '6GB', '8GB', '12GB', '16GB', '18GB', '24GB', 'Other']
const ROM_OPTIONS = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB', 'Other']
const GRADES = ['A', 'B', 'C']

const CONDITIONS = [
  { value: 'awaiting_refurb', label: 'Awaiting Refurb' },
  { value: 'sellable', label: 'Sellable' },
  { value: 'scrapped', label: 'Parts / Harvest' },
]

const conditionColor = (v: string) =>
  v === 'sellable' ? '#16a34a' : v === 'scrapped' ? '#dc2626' : '#d97706'

interface LineItem {
  brand: string
  model_name_str: string
  ram_str: string
  ram_custom: string
  storage_str: string
  rom_custom: string
  colour_str: string
  grade: string
  initial_status: string
  imei: string
  unit_cost: string
  imeiError: string
}

const emptyLine = (): LineItem => ({
  brand: '', model_name_str: '',
  ram_str: '', ram_custom: '',
  storage_str: '', rom_custom: '',
  colour_str: '',
  grade: 'C', initial_status: 'awaiting_refurb',
  imei: '', unit_cost: '',
  imeiError: '',
})

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 13, outline: 'none', background: '#fff',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function NewPOModal({ open, onClose, suppliers, onSuccess }: {
  open: boolean; onClose: () => void
  suppliers: Supplier[]
  onSuccess: () => void
}) {
  const [supplierId, setSupplierId] = useState('')
  const [shippingCost, setShippingCost] = useState('0')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineItem[]>([emptyLine()])

  const updateLine = (i: number, patch: Partial<LineItem>) => {
    setLines(prev => {
      const next = [...prev]
      next[i] = { ...next[i], ...patch }
      return next
    })
  }

  const validateIMEI = (imei: string, idx: number): string => {
    const digits = imei.replace(/\D/g, '')
    if (!digits) return ''
    if (digits.length !== 15) return 'IMEI must be exactly 15 digits'
    const dupe = lines.findIndex((l, j) => j !== idx && l.imei.replace(/\D/g, '') === digits)
    if (dupe !== -1) return `Duplicate of Device ${dupe + 1}`
    return ''
  }

  const handleIMEIChange = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, '')
    const error = validateIMEI(digits, i)
    updateLine(i, { imei: digits, imeiError: error })
  }

  const mut = useMutation({
    mutationFn: (data: unknown) => createPurchaseOrder(data),
    onSuccess: () => { toast.success('PO created — devices added to inventory'); onSuccess() },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Failed to create PO'),
  })

  const reset = () => {
    setSupplierId(''); setShippingCost('0'); setNotes(''); setLines([emptyLine()])
  }

  const handleClose = () => { reset(); onClose() }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplierId) { toast.error('Please select a supplier'); return }

    const validLines = lines.filter(l => l.imei.trim() && l.brand.trim() && l.model_name_str.trim())
    if (!validLines.length) { toast.error('Add at least one device with IMEI, brand and model'); return }

    const errors = lines.map((l, i) => ({ i, err: validateIMEI(l.imei, i) })).filter(x => x.err)
    if (errors.length) {
      toast.error('Fix IMEI errors before submitting')
      setLines(prev => prev.map((l, i) => ({ ...l, imeiError: validateIMEI(l.imei, i) })))
      return
    }

    const missingFields = validLines.filter(l => !l.colour_str.trim())
    if (missingFields.length) { toast.error('Colour is required for all devices'); return }

    mut.mutate({
      supplier_id: supplierId,
      shipping_cost: parseFloat(shippingCost) || 0,
      notes,
      line_items: validLines.map(l => ({
        line_type: 'device',
        brand: l.brand.trim(),
        model_name_str: l.model_name_str.trim(),
        ram_str: (l.ram_str === 'Other' ? l.ram_custom : l.ram_str).trim() || undefined,
        storage_str: (l.storage_str === 'Other' ? l.rom_custom : l.storage_str).trim() || undefined,
        colour_str: l.colour_str.trim(),
        grade: l.grade,
        initial_status: l.initial_status,
        imei: l.imei.trim(),
        unit_cost: parseFloat(l.unit_cost) || 0,
      })),
    })
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Purchase Order" maxWidth={1100}>
      <form onSubmit={submit}>
        {/* PO header fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>
          <div>
            <label style={{ ...labelStyle, marginBottom: 6 }}>Supplier *</label>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} required
              style={{ ...fieldStyle }}>
              <option value="">Select supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Input label="Shipping Cost (₦)" type="number" value={shippingCost}
            onChange={e => setShippingCost(e.target.value)} style={{ marginBottom: 0 }} />
          <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)}
            style={{ marginBottom: 0 }} />
        </div>

        {/* Devices section */}
        <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: 16, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 14 }}>
            Devices / Items
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lines.map((line, i) => (
              <div key={i} style={{
                border: '1px solid #cbd5e1',
                borderRadius: 10,
                padding: '16px 20px',
                background: '#f8fafc',
                position: 'relative',
              }}>
                {/* Card title */}
                <div style={{
                  fontSize: 12, fontWeight: 700, color: '#475569',
                  marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  Device {i + 1}
                </div>

                {/* Row 1: IMEI, Brand, Model Name */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.2fr', gap: 12, marginBottom: 12 }}>
                  <Field label="IMEI *">
                    <input
                      placeholder="353123456789012"
                      value={line.imei}
                      onChange={e => handleIMEIChange(i, e.target.value)}
                      maxLength={15}
                      inputMode="numeric"
                      style={{
                        ...fieldStyle,
                        fontFamily: 'monospace',
                        fontSize: 14,
                        borderColor: line.imeiError ? '#ef4444' : '#d1d5db',
                      }}
                    />
                    {line.imeiError && (
                      <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>{line.imeiError}</div>
                    )}
                    {line.imei && !line.imeiError && line.imei.length === 15 && (
                      <div style={{ fontSize: 11, color: '#16a34a', marginTop: 3 }}>✓ Valid IMEI</div>
                    )}
                  </Field>
                  <Field label="Brand *">
                    <input
                      placeholder="Samsung"
                      value={line.brand}
                      onChange={e => updateLine(i, { brand: e.target.value })}
                      style={fieldStyle}
                    />
                  </Field>
                  <Field label="Model Name *">
                    <input
                      placeholder="Galaxy S21"
                      value={line.model_name_str}
                      onChange={e => updateLine(i, { model_name_str: e.target.value })}
                      style={fieldStyle}
                    />
                  </Field>
                </div>

                {/* Row 2: RAM, ROM, Colour */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <Field label="RAM">
                    <select value={line.ram_str} onChange={e => updateLine(i, { ram_str: e.target.value })} style={fieldStyle}>
                      <option value="">— Select —</option>
                      {RAM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {line.ram_str === 'Other' && (
                      <input
                        placeholder="e.g. 3GB"
                        value={line.ram_custom}
                        onChange={e => updateLine(i, { ram_custom: e.target.value })}
                        style={{ ...fieldStyle, marginTop: 6 }}
                      />
                    )}
                  </Field>
                  <Field label="ROM (Storage)">
                    <select value={line.storage_str} onChange={e => updateLine(i, { storage_str: e.target.value })} style={fieldStyle}>
                      <option value="">— Select —</option>
                      {ROM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {line.storage_str === 'Other' && (
                      <input
                        placeholder="e.g. 4TB"
                        value={line.rom_custom}
                        onChange={e => updateLine(i, { rom_custom: e.target.value })}
                        style={{ ...fieldStyle, marginTop: 6 }}
                      />
                    )}
                  </Field>
                  <Field label="Colour *">
                    <input
                      placeholder="Black"
                      value={line.colour_str}
                      onChange={e => updateLine(i, { colour_str: e.target.value })}
                      style={fieldStyle}
                    />
                  </Field>
                </div>

                {/* Row 3: Grade, Condition, Cost, Remove */}
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 160px auto', gap: 12, alignItems: 'end' }}>
                  <Field label="Grade">
                    <select value={line.grade} onChange={e => updateLine(i, { grade: e.target.value })} style={fieldStyle}>
                      {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </Field>
                  <Field label="Condition">
                    <select
                      value={line.initial_status}
                      onChange={e => updateLine(i, { initial_status: e.target.value })}
                      style={{ ...fieldStyle, color: conditionColor(line.initial_status), fontWeight: 600 }}
                    >
                      {CONDITIONS.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Cost (₦) *">
                    <input
                      placeholder="0.00"
                      type="number"
                      value={line.unit_cost}
                      onChange={e => updateLine(i, { unit_cost: e.target.value })}
                      style={fieldStyle}
                      min="0"
                      step="0.01"
                    />
                  </Field>
                  <div style={{ paddingBottom: 2 }}>
                    <button
                      type="button"
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      disabled={lines.length === 1}
                      style={{
                        background: lines.length === 1 ? '#f1f5f9' : '#fee2e2',
                        border: '1px solid',
                        borderColor: lines.length === 1 ? '#cbd5e1' : '#fca5a5',
                        borderRadius: 6,
                        color: lines.length === 1 ? '#94a3b8' : '#dc2626',
                        cursor: lines.length === 1 ? 'not-allowed' : 'pointer',
                        padding: '8px 14px',
                        fontWeight: 700,
                        fontSize: 13,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <Btn size="sm" variant="ghost" type="button"
              onClick={() => setLines([...lines, emptyLine()])}>
              + Add Device
            </Btn>
          </div>
        </div>

        <div style={{
          marginTop: 16, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6,
          fontSize: 12, color: '#166534', border: '1px solid #bbf7d0',
        }}>
          ℹ️ Devices are added to inventory immediately. Condition sets their initial status:
          <strong> Sellable</strong> → Sales Stock &nbsp;|&nbsp;
          <strong> Awaiting Refurb</strong> → Intake &nbsp;|&nbsp;
          <strong> Parts / Harvest</strong> → Scrapped
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Btn variant="secondary" onClick={handleClose} type="button">Cancel</Btn>
          <Btn type="submit" disabled={mut.isPending}>
            {mut.isPending ? 'Creating…' : 'Create PO & Add Inventory'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Intake() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [expandedPO, setExpandedPO] = useState<string | null>(null)

  const { data: pos = [] } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', filterStatus],
    queryFn: () => {
      const p: Record<string, string> = {}
      if (filterStatus) p.status = filterStatus
      return getPurchaseOrders(p).then(r => r.data)
    },
  })

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => getSuppliers().then(r => r.data),
  })

  const receiveMut = useMutation({
    mutationFn: (id: string) => receivePurchaseOrder(id, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      toast.success('PO marked as received')
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const statusBadge = (status: string) => {
    const cfg: Record<string, [string, string]> = {
      open: ['#dbeafe', '#1d4ed8'],
      received: ['#dcfce7', '#166534'],
      cancelled: ['#fee2e2', '#991b1b'],
    }
    const [bg, color] = cfg[status] ?? ['#f1f5f9', '#475569']
    return (
      <span style={{ padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: bg, color }}>
        {status.toUpperCase()}
      </span>
    )
  }

  return (
    <div style={{ padding: 28 }}>
      <PageHeader
        title="Purchase Orders (Intake)"
        action={<Btn onClick={() => setShowNew(true)}>+ New PO</Btn>}
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <Select label="Filter by Status" value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{ maxWidth: 180, marginBottom: 0 }}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
      </Card>

      <Card style={{ padding: 0 }}>
        <Table headers={['PO Number', 'Supplier', 'Date', 'Devices', 'Shipping', 'Status', 'Actions']}>
          {(pos as PurchaseOrder[]).map(po => {
            const supplier = (suppliers as Supplier[]).find(s => s.id === po.supplier_id)
            const isExpanded = expandedPO === po.id
            const deviceCount = po.line_items.filter(l => l.line_type === 'device').length

            return (
              <Fragment key={po.id}>
                <TR onClick={() => setExpandedPO(isExpanded ? null : po.id)}>
                  <TD><strong style={{ color: '#2563eb', fontFamily: 'monospace' }}>{po.po_number}</strong></TD>
                  <TD>{supplier?.name ?? <span style={{ color: '#94a3b8' }}>—</span>}</TD>
                  <TD>{po.date}</TD>
                  <TD><strong>{deviceCount}</strong> device{deviceCount !== 1 ? 's' : ''}</TD>
                  <TD>{fmt(po.shipping_cost)}</TD>
                  <TD>{statusBadge(po.status)}</TD>
                  <TD onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {po.status === 'open' && (
                        <Btn size="sm" onClick={() => {
                          if (confirm('Mark this PO as received?')) receiveMut.mutate(po.id)
                        }}>
                          ✓ Receive
                        </Btn>
                      )}
                      <Btn size="sm" variant="secondary"
                        onClick={() => setExpandedPO(isExpanded ? null : po.id)}>
                        {isExpanded ? '▲ Hide' : '▼ Devices'}
                      </Btn>
                    </div>
                  </TD>
                </TR>
                {isExpanded && (
                  <tr>
                    <td colSpan={7} style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <PODevicesPanel poId={po.id} poNumber={po.po_number} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </Table>
        {(pos as PurchaseOrder[]).length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
            No purchase orders yet. Click "+ New PO" to create one.
          </div>
        )}
      </Card>

      <NewPOModal
        open={showNew}
        onClose={() => setShowNew(false)}
        suppliers={suppliers as Supplier[]}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['purchase-orders'] })
          setShowNew(false)
        }}
      />
    </div>
  )
}
