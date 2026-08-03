import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  getLabelSizes, getSelectedLabelSize, saveSelectedLabelSizeId, LabelSize,
} from '../hooks/useLabelSizes'
import { buildPrintHTML, DeviceForLabel } from '../utils/labelRenderer'
import { fetchTemplates } from '../hooks/useLabelTemplateAPI'
import { getPurchaseOrders, getSuppliers, createSimplePO } from '../services/api'
import { PurchaseOrder, POReceivedDevice, Supplier } from '../types'
import { PageHeader, Card, Btn, fmt } from '../components/Layout'

// ─── Label printing ─────────────────────────────────────────────────────────

async function printDeviceLabels(devices: DeviceForLabel[]) {
  if (!devices.length) return
  const selectedSize = getSelectedLabelSize()
  if (!selectedSize) {
    toast.error('No label size configured. Go to Settings → Label Printing Sizes.')
    return
  }
  const sizes = getLabelSizes()
  const apiTemplates = await fetchTemplates().catch(() => [])
  const allTemplates = apiTemplates.map(t => t.data)
  const template = apiTemplates.find(t => t.is_default)?.data ?? allTemplates[0]
  if (!template) { toast.error('No label template found. Set one up in the Label Designer.'); return }

  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) { toast.error('Pop-up blocked — please allow pop-ups for this page'); return }

  const html = buildPrintHTML(template, devices, selectedSize, sizes, allTemplates, 1)
  w.document.open(); w.document.write(html); w.document.close(); w.focus()

  ;(window as typeof window & { __labelRerender: unknown }).__labelRerender = (
    size: LabelSize, tmpl: typeof template, copies: number
  ) => {
    const next = buildPrintHTML(tmpl, devices, size, sizes, allTemplates, copies)
    saveSelectedLabelSizeId(size.id)
    w.document.open(); w.document.write(next); w.document.close(); w.focus()
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RAM_OPTIONS = ['1GB', '2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB', '18GB', '24GB', 'Other']
const ROM_OPTIONS = ['8GB', '16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB', 'Other']
const GRADES = ['A', 'B', 'C']
const CONDITIONS = [
  { value: 'awaiting_refurb', label: 'Awaiting Refurbishment', color: '#d97706', bg: '#fef3c7' },
  { value: 'sellable',        label: 'Sellable',               color: '#16a34a', bg: '#dcfce7' },
  { value: 'stock_to_return', label: 'Stock to Be Returned',   color: '#9333ea', bg: '#f3e8ff' },
]

const PO_STATUS_COLORS: Record<string, [string, string]> = {
  ordered:             ['#dbeafe', '#1d4ed8'],
  open:                ['#dbeafe', '#1d4ed8'],
  partially_received:  ['#fef3c7', '#92400e'],
  fully_received:      ['#dcfce7', '#166534'],
  received:            ['#dcfce7', '#166534'],
  closed_discrepancy:  ['#fee2e2', '#991b1b'],
  cancelled:           ['#f1f5f9', '#475569'],
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const fs: React.CSSProperties = {
  width: '100%', padding: '9px 11px', border: '1px solid #d1d5db',
  borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff',
  boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px',
}

function F({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={lbl}>{label}{required && <span style={{ color: '#ef4444' }}> *</span>}</label>
      {children}
    </div>
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface DeviceEntry {
  id: string
  imei: string
  brand: string
  model_name_str: string
  ram_str: string
  ram_custom: string
  storage_str: string
  rom_custom: string
  colour_str: string
  grade: string
  initial_status: string
  selling_price: string
  notes: string
}

const newEntry = (): DeviceEntry => ({
  id: Math.random().toString(36).slice(2),
  imei: '', brand: '', model_name_str: '',
  ram_str: '', ram_custom: '', storage_str: '', rom_custom: '',
  colour_str: '', grade: 'C', initial_status: 'awaiting_refurb',
  selling_price: '', notes: '',
})

function validateImei(v: string): string {
  const d = v.replace(/\D/g, '')
  if (!d) return 'Required'
  if (d.length !== 15) return 'Must be 15 digits'
  return ''
}

// ─── Device Entry Row ────────────────────────────────────────────────────────

function DeviceRow({
  entry, index, onChange, onRemove, canRemove, duplicateImeis,
}: {
  entry: DeviceEntry
  index: number
  onChange: (patch: Partial<DeviceEntry>) => void
  onRemove: () => void
  canRemove: boolean
  duplicateImeis: Set<string>
}) {
  const imeiRef = useRef<HTMLInputElement>(null)
  const imeiDigits = entry.imei.replace(/\D/g, '')
  const imeiErr = entry.imei ? validateImei(entry.imei) : ''
  const isDup = imeiDigits.length === 15 && duplicateImeis.has(imeiDigits)
  const cond = CONDITIONS.find(c => c.value === entry.initial_status)

  return (
    <div style={{
      border: '1px solid #e2e8f0', borderRadius: 10, padding: '16px 18px',
      background: '#fafbfc', position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Device {index + 1}
        </span>
        {cond && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: cond.bg, color: cond.color }}>
            {cond.label}
          </span>
        )}
        {canRemove && (
          <button onClick={onRemove} style={{
            background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6,
            color: '#dc2626', cursor: 'pointer', padding: '4px 12px', fontSize: 12, fontWeight: 700,
          }}>Remove</button>
        )}
      </div>

      {/* Row 1: IMEI (prominent) */}
      <div style={{ marginBottom: 12 }}>
        <F label="IMEI" required>
          <input
            ref={imeiRef}
            value={entry.imei}
            onChange={e => onChange({ imei: e.target.value })}
            maxLength={15}
            inputMode="numeric"
            placeholder="Scan or type 15-digit IMEI"
            autoComplete="off"
            style={{
              ...fs,
              fontFamily: 'monospace', fontSize: 15, letterSpacing: '0.5px',
              borderColor: isDup ? '#9333ea' : imeiErr && entry.imei ? '#ef4444' : imeiDigits.length === 15 ? '#16a34a' : '#d1d5db',
              borderWidth: 2,
            }}
          />
          {isDup && <div style={{ fontSize: 11, color: '#9333ea', marginTop: 2 }}>Duplicate IMEI in this batch</div>}
          {!isDup && imeiErr && entry.imei && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>{imeiErr}</div>}
          {!isDup && !imeiErr && imeiDigits.length === 15 && (
            <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2 }}>Valid IMEI</div>
          )}
        </F>
      </div>

      {/* Row 2: Brand, Model, Colour */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
        <F label="Brand" required>
          <input value={entry.brand} onChange={e => onChange({ brand: e.target.value })}
            placeholder="Samsung" style={fs} />
        </F>
        <F label="Model" required>
          <input value={entry.model_name_str} onChange={e => onChange({ model_name_str: e.target.value })}
            placeholder="Galaxy S21" style={fs} />
        </F>
        <F label="Colour">
          <input value={entry.colour_str} onChange={e => onChange({ colour_str: e.target.value })}
            placeholder="Black" style={fs} />
        </F>
      </div>

      {/* Row 3: RAM, ROM, Grade, Condition, Selling Price */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 1fr 1fr', gap: 10, marginBottom: 10 }}>
        <F label="RAM">
          <select value={entry.ram_str} onChange={e => onChange({ ram_str: e.target.value })} style={fs}>
            <option value="">— Select —</option>
            {RAM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {entry.ram_str === 'Other' && (
            <input value={entry.ram_custom} onChange={e => onChange({ ram_custom: e.target.value })}
              placeholder="e.g. 3GB" style={{ ...fs, marginTop: 4 }} />
          )}
        </F>
        <F label="ROM (Storage)">
          <select value={entry.storage_str} onChange={e => onChange({ storage_str: e.target.value })} style={fs}>
            <option value="">— Select —</option>
            {ROM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {entry.storage_str === 'Other' && (
            <input value={entry.rom_custom} onChange={e => onChange({ rom_custom: e.target.value })}
              placeholder="e.g. 4TB" style={{ ...fs, marginTop: 4 }} />
          )}
        </F>
        <F label="Grade">
          <select value={entry.grade} onChange={e => onChange({ grade: e.target.value })} style={fs}>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </F>
        <F label="Condition" required>
          <select value={entry.initial_status} onChange={e => onChange({ initial_status: e.target.value })}
            style={{ ...fs, color: cond?.color, fontWeight: 700 }}>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </F>
        <F label="Selling Price (₦)">
          <input type="number" value={entry.selling_price}
            onChange={e => onChange({ selling_price: e.target.value })}
            placeholder="0.00" min="0" step="0.01"
            style={{ ...fs, borderColor: !entry.selling_price ? '#f59e0b' : '#d1d5db' }} />
          {!entry.selling_price && (
            <div style={{ fontSize: 10, color: '#d97706', marginTop: 2 }}>Recommended before sale</div>
          )}
        </F>
      </div>

      {/* Row 4: Notes */}
      <F label="Notes (optional)">
        <input value={entry.notes} onChange={e => onChange({ notes: e.target.value })}
          placeholder="Any notes about this device" style={fs} />
      </F>
    </div>
  )
}

// ─── New PO Modal ─────────────────────────────────────────────────────────────

function NewPOModal({ open, onClose, suppliers, onSuccess }: {
  open: boolean; onClose: () => void; suppliers: Supplier[]; onSuccess: (poId: string, devices: unknown[]) => void
}) {
  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const [entries, setEntries] = useState<DeviceEntry[]>([newEntry()])

  const update = (i: number, patch: Partial<DeviceEntry>) =>
    setEntries(prev => { const n = [...prev]; n[i] = { ...n[i], ...patch }; return n })

  // Detect duplicate IMEIs within the batch
  const imeiCounts: Record<string, number> = {}
  for (const e of entries) {
    const d = e.imei.replace(/\D/g, '')
    if (d.length === 15) imeiCounts[d] = (imeiCounts[d] ?? 0) + 1
  }
  const duplicateImeis = new Set(Object.keys(imeiCounts).filter(k => imeiCounts[k] > 1))

  const mut = useMutation({
    mutationFn: (body: unknown) => createSimplePO(body),
    onSuccess: (res) => {
      const data = res.data as { id: string }
      toast.success(`Purchase order created — ${entries.length} device(s) added to inventory`)
      onSuccess(data.id, [])
      reset()
    },
    onError: (e: any) => {
      const detail = e?.response?.data?.detail
      const msg = Array.isArray(detail)
        ? detail.map((d: any) => d.msg ?? JSON.stringify(d)).join('; ')
        : (typeof detail === 'string' ? detail : e?.message ?? 'Failed to create purchase order')
      toast.error(msg)
    },
  })

  const reset = () => {
    setSupplierId('')
    setNotes('')
    setEntries([newEntry()])
  }

  const handleClose = () => { reset(); onClose() }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplierId) { toast.error('Please select a supplier'); return }

    for (const [i, entry] of entries.entries()) {
      const imeiErr = validateImei(entry.imei)
      if (imeiErr) { toast.error(`Device ${i + 1}: IMEI ${imeiErr.toLowerCase()}`); return }
      if (!entry.brand.trim()) { toast.error(`Device ${i + 1}: Brand is required`); return }
      if (!entry.model_name_str.trim()) { toast.error(`Device ${i + 1}: Model is required`); return }
    }
    if (duplicateImeis.size > 0) {
      toast.error('Duplicate IMEIs detected in this batch — each device must have a unique IMEI')
      return
    }

    mut.mutate({
      supplier_id: supplierId,
      notes: notes || undefined,
      items: entries.map(e => ({
        imei: e.imei.replace(/\D/g, ''),
        brand: e.brand.trim(),
        model_name_str: e.model_name_str.trim(),
        ram_str: (e.ram_str === 'Other' ? e.ram_custom : e.ram_str).trim() || undefined,
        storage_str: (e.storage_str === 'Other' ? e.rom_custom : e.storage_str).trim() || undefined,
        colour_str: e.colour_str.trim() || undefined,
        grade: e.grade,
        initial_status: e.initial_status,
        selling_price: e.selling_price ? parseFloat(e.selling_price) : undefined,
        notes: e.notes.trim() || undefined,
      })),
    })
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '24px 16px', overflowY: 'auto',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 900,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)', marginBottom: 24,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Receive Stock</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              Goods have arrived. Enter each device individually to add it to inventory.
            </p>
          </div>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>&times;</button>
        </div>

        <form onSubmit={submit}>
          {/* PO Info */}
          <div style={{ padding: '18px 24px', borderBottom: '1px solid #f8fafc', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
            <F label="Supplier" required>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={fs} required>
                <option value="">Select supplier…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </F>
            <F label="PO Notes (optional)">
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. batch reference, delivery note" style={fs} />
            </F>
          </div>

          {/* Device entries */}
          <div style={{ padding: '18px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b' }}>
                Devices ({entries.length})
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                One record per device — no quantity field
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {entries.map((entry, i) => (
                <DeviceRow
                  key={entry.id}
                  entry={entry}
                  index={i}
                  onChange={patch => update(i, patch)}
                  onRemove={() => setEntries(prev => prev.filter((_, j) => j !== i))}
                  canRemove={entries.length > 1}
                  duplicateImeis={duplicateImeis}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => setEntries(prev => [...prev, newEntry()])}
              style={{
                marginTop: 14, width: '100%', padding: '11px', borderRadius: 8,
                border: '2px dashed #cbd5e1', background: 'transparent', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, color: '#64748b',
              }}
            >
              + Add Another Device
            </button>
          </div>

          {/* Summary + Actions */}
          <div style={{ padding: '14px 24px 20px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {CONDITIONS.map(c => {
                const count = entries.filter(e => e.initial_status === c.value).length
                if (!count) return null
                return (
                  <span key={c.value} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 12, background: c.bg, color: c.color, fontWeight: 700 }}>
                    {count} × {c.label}
                  </span>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn variant="secondary" onClick={handleClose} type="button">Cancel</Btn>
              <Btn type="submit" disabled={mut.isPending}>
                {mut.isPending ? `Adding ${entries.length} device(s) to inventory…` : `Create & Receive ${entries.length} Device(s)`}
              </Btn>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── PO History Section ───────────────────────────────────────────────────────

function POHistorySection() {
  const [expandedPO, setExpandedPO] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('')

  const { data: pos = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', filterStatus],
    queryFn: () => {
      const p: Record<string, string> = {}
      if (filterStatus) p.status = filterStatus
      return getPurchaseOrders(p).then(r => r.data)
    },
  })

  const handlePrintLabel = (rd: POReceivedDevice) => {
    printDeviceLabels([{
      imei: rd.imei,
      brand: rd.actual_brand ?? '',
      model_name: rd.actual_model_str ?? '',
      ram: rd.actual_ram_str ?? '',
      storage: rd.actual_storage_str ?? '',
      colour: rd.actual_colour_str ?? '',
      grade: rd.actual_grade ?? '',
    }])
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Purchase History</div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ ...fs, maxWidth: 200 }}
        >
          <option value="">All Statuses</option>
          <option value="fully_received">Fully Received</option>
          <option value="ordered">Ordered</option>
          <option value="partially_received">Partially Received</option>
          <option value="closed_discrepancy">Closed (Discrepancy)</option>
        </select>
      </div>

      {isLoading && <div style={{ color: '#94a3b8', padding: 16, textAlign: 'center' }}>Loading…</div>}

      {!isLoading && pos.length === 0 && (
        <div style={{ color: '#94a3b8', padding: 32, textAlign: 'center', fontSize: 14 }}>
          No purchase orders yet. Click <strong>+ Receive Stock</strong> to add your first batch.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pos.map(po => {
          const [bg, color] = PO_STATUS_COLORS[po.status] ?? ['#f1f5f9', '#475569']
          const isExpanded = expandedPO === po.id
          const allReceived = po.line_items.flatMap(li => li.received_devices ?? [])

          return (
            <Card key={po.id} style={{ overflow: 'hidden' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: 'pointer' }}
                onClick={() => setExpandedPO(isExpanded ? null : po.id)}
              >
                <div style={{ fontWeight: 800, fontSize: 14, color: '#1e293b', minWidth: 160 }}>{po.po_number}</div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 4, background: bg, color }}>
                  {(po.status_label ?? po.status).toUpperCase()}
                </span>
                <div style={{ fontSize: 13, color: '#64748b' }}>
                  {new Date(po.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginLeft: 'auto' }}>
                  {po.total_received} device(s) received
                </div>
                <span style={{ fontSize: 18, color: '#94a3b8' }}>{isExpanded ? '▲' : '▼'}</span>
              </div>

              {isExpanded && (
                <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 16px 16px' }}>
                  {allReceived.length === 0 ? (
                    <div style={{ color: '#94a3b8', fontSize: 13 }}>No devices recorded.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          {['IMEI', 'Device', 'Grade', 'Condition', 'Selling Price', ''].map(h => (
                            <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allReceived.map(rd => {
                          const cond = CONDITIONS.find(c => c.value === rd.actual_condition)
                          const spec = [rd.actual_brand, rd.actual_model_str, rd.actual_ram_str, rd.actual_storage_str, rd.actual_colour_str].filter(Boolean).join(' ')
                          return (
                            <tr key={rd.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12 }}>{rd.imei}</td>
                              <td style={{ padding: '8px 10px', fontWeight: 500 }}>{spec || '—'}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>{rd.actual_grade ?? '—'}</td>
                              <td style={{ padding: '8px 10px' }}>
                                {cond ? (
                                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: cond.bg, color: cond.color, fontWeight: 700 }}>
                                    {cond.label}
                                  </span>
                                ) : <span style={{ color: '#94a3b8' }}>{rd.actual_condition ?? '—'}</span>}
                              </td>
                              <td style={{ padding: '8px 10px', color: '#1d4ed8', fontWeight: 600 }}>
                                {rd.selling_price ? fmt(rd.selling_price) : <span style={{ color: '#94a3b8' }}>Not set</span>}
                              </td>
                              <td style={{ padding: '8px 10px' }}>
                                <button
                                  onClick={() => handlePrintLabel(rd)}
                                  style={{ fontSize: 11, padding: '3px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', fontWeight: 600 }}
                                >
                                  Print Label
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Intake() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => getSuppliers().then(r => r.data),
  })

  const handleSuccess = (_poId: string, _devices: unknown[]) => {
    qc.invalidateQueries({ queryKey: ['purchase-orders'] })
    qc.invalidateQueries({ queryKey: ['devices'] })
    qc.invalidateQueries({ queryKey: ['refurb-jobs'] })
    qc.invalidateQueries({ queryKey: ['dashboard-counts'] })
    setShowNew(false)
  }

  return (
    <div style={{ padding: 28 }}>
      <PageHeader
        title="Purchase Orders (Intake)"
        action={<Btn onClick={() => setShowNew(true)}>+ Receive Stock</Btn>}
      />

      {/* What happens automatically */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24,
      }}>
        {[
          { cond: CONDITIONS[0], icon: '🔧', desc: 'Device created → Refurb job opened automatically' },
          { cond: CONDITIONS[1], icon: '✅', desc: 'Device created → Added to Sellable Stock immediately' },
          { cond: CONDITIONS[2], icon: '↩️', desc: 'Device created → Moved to Stock to Be Returned' },
        ].map(({ cond, icon, desc }) => (
          <div key={cond.value} style={{
            padding: '14px 16px', borderRadius: 8, border: `1px solid`,
            borderColor: cond.color + '44', background: cond.bg,
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: cond.color, marginBottom: 4 }}>
              {icon} {cond.label}
            </div>
            <div style={{ fontSize: 12, color: '#475569' }}>{desc}</div>
          </div>
        ))}
      </div>

      <POHistorySection />

      <NewPOModal
        open={showNew}
        onClose={() => setShowNew(false)}
        suppliers={suppliers}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
