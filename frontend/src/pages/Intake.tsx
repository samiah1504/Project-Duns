import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  getLabelSizes, getSelectedLabelSize, saveSelectedLabelSizeId, LabelSize,
} from '../hooks/useLabelSizes'
import { buildPrintHTML, DeviceForLabel } from '../utils/labelRenderer'
import { fetchTemplates } from '../hooks/useLabelTemplateAPI'
import {
  getPurchaseOrders, getSuppliers, createPurchaseOrder,
  addPOLineItem, updatePOLineItem, deletePOLineItem,
  receiveLineItem, markLineItemNotReceived, closePOWithDiscrepancy,
  getPOReconciliation,
} from '../services/api'
import { PurchaseOrder, POLineItem, POReceivedDevice, Supplier, DeviceWithModel } from '../types'
import {
  PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select, fmt,
} from '../components/Layout'

// ─── Label printing ────────────────────────────────────────────────────────────

async function printDeviceLabels(devices: DeviceForLabel[]) {
  if (!devices.length) return
  const selectedSize = getSelectedLabelSize()
  if (!selectedSize) {
    toast.error('No label size configured. Go to Settings → Label Printing Sizes.')
    return
  }
  const sizes = getLabelSizes()
  let apiTemplates = await fetchTemplates().catch(() => [])
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

// ─── Constants ─────────────────────────────────────────────────────────────────

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

const PO_STATUS_COLORS: Record<string, [string, string]> = {
  open:                ['#dbeafe', '#1d4ed8'],
  ordered:             ['#dbeafe', '#1d4ed8'],
  partially_received:  ['#fef3c7', '#92400e'],
  received:            ['#dcfce7', '#166534'],
  fully_received:      ['#dcfce7', '#166534'],
  closed_discrepancy:  ['#fee2e2', '#991b1b'],
  cancelled:           ['#f1f5f9', '#475569'],
}

const LINE_STATUS_COLORS: Record<string, [string, string]> = {
  pending:              ['#f1f5f9', '#475569'],
  partially_received:   ['#fef3c7', '#92400e'],
  fully_received:       ['#dcfce7', '#166534'],
  not_received:         ['#fee2e2', '#991b1b'],
  short_supplied:       ['#fef3c7', '#78350f'],
}

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

function StatusBadge({ status, label }: { status: string; label?: string }) {
  const [bg, color] = PO_STATUS_COLORS[status] ?? ['#f1f5f9', '#475569']
  return (
    <span style={{ padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: bg, color }}>
      {label ?? status.replace(/_/g, ' ').toUpperCase()}
    </span>
  )
}

function LineStatusBadge({ status }: { status: string }) {
  const [bg, color] = LINE_STATUS_COLORS[status] ?? ['#f1f5f9', '#475569']
  return (
    <span style={{ padding: '2px 7px', borderRadius: 3, fontSize: 10, fontWeight: 700, background: bg, color }}>
      {status.replace(/_/g, ' ').toUpperCase()}
    </span>
  )
}

// ─── Receive Device Modal ──────────────────────────────────────────────────────

interface ReceiveModalProps {
  poId: string
  lineItem: POLineItem
  onClose: () => void
  onSuccess: () => void
}

function ReceiveDeviceModal({ poId, lineItem, onClose, onSuccess }: ReceiveModalProps) {
  const [imei, setImei] = useState('')
  const [imeiError, setImeiError] = useState('')
  const [brand, setBrand] = useState(lineItem.brand ?? '')
  const [model, setModel] = useState(lineItem.model_name_str ?? '')
  const [ram, setRam] = useState(lineItem.ram_str ?? '')
  const [ram_custom, setRamCustom] = useState('')
  const [storage, setStorage] = useState(lineItem.storage_str ?? '')
  const [rom_custom, setRomCustom] = useState('')
  const [colour, setColour] = useState(lineItem.colour_str ?? '')
  const [grade, setGrade] = useState(lineItem.grade ?? 'C')
  const [condition, setCondition] = useState('awaiting_refurb')
  const [sellingPrice, setSellingPrice] = useState(
    lineItem.selling_price ? String(parseFloat(lineItem.selling_price)) : ''
  )
  const [notes, setNotes] = useState('')

  const mut = useMutation({
    mutationFn: () => receiveLineItem(poId, lineItem.id, {
      imei: imei.replace(/\D/g, ''),
      actual_brand: brand || undefined,
      actual_model_str: model || undefined,
      actual_ram_str: (ram === 'Other' ? ram_custom : ram) || undefined,
      actual_storage_str: (storage === 'Other' ? rom_custom : storage) || undefined,
      actual_colour_str: colour || undefined,
      actual_grade: grade || undefined,
      actual_condition: condition,
      selling_price: sellingPrice ? parseFloat(sellingPrice) : undefined,
      notes: notes || undefined,
    }),
    onSuccess: () => { toast.success(`Device ${imei} received and added to inventory`); onSuccess() },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Failed to receive device'),
  })

  const validateImei = (v: string) => {
    const d = v.replace(/\D/g, '')
    if (!d) return 'IMEI is required'
    if (d.length !== 15) return 'IMEI must be exactly 15 digits'
    return ''
  }

  const outstanding = lineItem.outstanding_qty
  const effRam = ram === 'Other' ? ram_custom : ram
  const effStorage = storage === 'Other' ? rom_custom : storage
  const sp = sellingPrice ? parseFloat(sellingPrice) : null

  return (
    <Modal open onClose={onClose} title={`Receive Device — ${lineItem.brand ?? ''} ${lineItem.model_name_str ?? ''}`} maxWidth={520}>
      <div style={{ marginBottom: 14, padding: '10px 14px', background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd', fontSize: 13 }}>
        <strong>Ordered:</strong> {lineItem.brand} {lineItem.model_name_str} {lineItem.ram_str} / {lineItem.storage_str} {lineItem.colour_str} Grade {lineItem.grade} &nbsp;·&nbsp;
        <strong>{outstanding}</strong> of {lineItem.quantity} remaining
        {lineItem.selling_price && (
          <span style={{ marginLeft: 8 }}>· Selling price: <strong>{fmt(lineItem.selling_price)}</strong></span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="IMEI *">
          <input
            placeholder="353123456789012"
            value={imei}
            onChange={e => {
              setImei(e.target.value)
              setImeiError(validateImei(e.target.value))
            }}
            maxLength={15}
            inputMode="numeric"
            style={{
              ...fieldStyle, fontFamily: 'monospace', fontSize: 14,
              borderColor: imeiError ? '#ef4444' : '#d1d5db',
            }}
            autoFocus
          />
          {imeiError && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>{imeiError}</div>}
          {!imeiError && imei.replace(/\D/g, '').length === 15 && (
            <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2 }}>✓ Valid IMEI</div>
          )}
        </Field>

        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginTop: 4 }}>
          Actual received spec (pre-filled from order — correct if different)
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Brand">
            <input value={brand} onChange={e => setBrand(e.target.value)} style={fieldStyle} placeholder="Samsung" />
          </Field>
          <Field label="Model">
            <input value={model} onChange={e => setModel(e.target.value)} style={fieldStyle} placeholder="Galaxy S21" />
          </Field>
          <Field label="RAM">
            <select value={ram} onChange={e => setRam(e.target.value)} style={fieldStyle}>
              <option value="">— Select —</option>
              {RAM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {ram === 'Other' && (
              <input placeholder="e.g. 3GB" value={ram_custom} onChange={e => setRamCustom(e.target.value)} style={{ ...fieldStyle, marginTop: 4 }} />
            )}
          </Field>
          <Field label="ROM (Storage)">
            <select value={storage} onChange={e => setStorage(e.target.value)} style={fieldStyle}>
              <option value="">— Select —</option>
              {ROM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {storage === 'Other' && (
              <input placeholder="e.g. 4TB" value={rom_custom} onChange={e => setRomCustom(e.target.value)} style={{ ...fieldStyle, marginTop: 4 }} />
            )}
          </Field>
          <Field label="Colour">
            <input value={colour} onChange={e => setColour(e.target.value)} style={fieldStyle} placeholder="Black" />
          </Field>
          <Field label="Grade">
            <select value={grade} onChange={e => setGrade(e.target.value)} style={fieldStyle}>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Condition">
            <select value={condition} onChange={e => setCondition(e.target.value)}
              style={{ ...fieldStyle, color: conditionColor(condition), fontWeight: 600 }}>
              {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Selling Price (₦)">
            <input
              type="number" value={sellingPrice} min="0" step="0.01"
              onChange={e => setSellingPrice(e.target.value)}
              style={{ ...fieldStyle, borderColor: !sellingPrice ? '#f59e0b' : '#d1d5db' }}
              placeholder="0.00"
            />
            {!sellingPrice && <div style={{ fontSize: 10, color: '#d97706', marginTop: 2 }}>Required before sale</div>}
          </Field>
        </div>

        <Field label="Notes (optional)">
          <input value={notes} onChange={e => setNotes(e.target.value)} style={fieldStyle} />
        </Field>

        {sp !== null && (
          <div style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 12, color: '#475569' }}>
            Device will be added to inventory as: {brand} {model} {effRam}/{effStorage} {colour} Grade {grade} · Selling price: {fmt(sp)}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn
          onClick={() => mut.mutate()}
          disabled={mut.isPending || !!validateImei(imei)}
        >
          {mut.isPending ? 'Adding to Inventory…' : 'Confirm Receipt'}
        </Btn>
      </div>
    </Modal>
  )
}

// ─── Reconciliation Modal ──────────────────────────────────────────────────────

function ReconciliationModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { data: recon, isLoading } = useQuery<Record<string, unknown>>({
    queryKey: ['po-reconciliation', poId],
    queryFn: () => getPOReconciliation(poId).then(r => r.data),
  })

  if (isLoading) return (
    <Modal open onClose={onClose} title="Reconciliation" maxWidth={700}>
      <div style={{ padding: 24, color: '#64748b' }}>Loading…</div>
    </Modal>
  )

  const items = (recon?.line_items ?? []) as Array<Record<string, unknown>>
  const statusColorMap: Record<string, string> = {
    exact_match: '#166534', partial_match: '#92400e', discrepancy: '#991b1b', awaiting: '#475569',
  }
  const overall = recon?.overall_status as string ?? 'awaiting'

  return (
    <Modal open onClose={onClose} title={`Reconciliation — ${recon?.po_number}`} maxWidth={700}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13 }}>
          <span><strong>Ordered:</strong> {recon?.total_ordered as number}</span>
          <span><strong>Received:</strong> {recon?.total_received as number}</span>
          <span><strong>Outstanding:</strong> {recon?.total_outstanding as number}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 700, color: statusColorMap[overall] }}>
            {overall.replace(/_/g, ' ').toUpperCase()}
          </span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              {['Expected Spec', 'Ordered', 'Received', 'Outstanding', 'Status', 'IMEIs'].map(h => (
                <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item: Record<string, unknown>, i: number) => (
              <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '8px', fontWeight: 500 }}>{item.expected_spec as string}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>{item.ordered_qty as number}</td>
                <td style={{ padding: '8px', textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>{item.received_qty as number}</td>
                <td style={{ padding: '8px', textAlign: 'center', color: (item.outstanding_qty as number) > 0 ? '#d97706' : '#16a34a', fontWeight: 600 }}>
                  {item.outstanding_qty as number}
                </td>
                <td style={{ padding: '8px' }}>
                  <LineStatusBadge status={item.item_status as string} />
                </td>
                <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: 11, color: '#475569' }}>
                  {((item.received_imeis as string[]) ?? []).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn variant="secondary" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  )
}

// ─── Line Item Card (within expanded PO) ──────────────────────────────────────

interface LineItemCardProps {
  po: PurchaseOrder
  lineItem: POLineItem
  onReceive: (li: POLineItem) => void
  onNotReceived: (li: POLineItem) => void
  onEdit: (li: POLineItem) => void
  onDelete: (li: POLineItem) => void
  onPrintLabel: (imei: string, rd: POReceivedDevice) => void
}

function LineItemCard({ po, lineItem: li, onReceive, onNotReceived, onEdit, onDelete, onPrintLabel }: LineItemCardProps) {
  const isClosedPO = ['cancelled', 'fully_received', 'received', 'closed_discrepancy'].includes(po.status)
  const canReceive = !isClosedPO && li.item_status !== 'not_received' && li.outstanding_qty > 0
  const canMarkNotReceived = !isClosedPO && li.received_qty === 0 && li.item_status !== 'not_received'
  const canDelete = li.received_qty === 0 && !isClosedPO
  const canEdit = !isClosedPO

  const specParts = [li.brand, li.model_name_str, li.ram_str, li.storage_str, li.colour_str].filter(Boolean)
  const spec = specParts.join(' / ')

  return (
    <div style={{
      border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px',
      background: li.item_status === 'fully_received' ? '#f0fdf4'
        : li.item_status === 'not_received' ? '#fef2f2' : '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{spec || 'Device'}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Grade {li.grade ?? '—'}
            {li.selling_price && <span style={{ marginLeft: 8 }}>· Selling: <strong style={{ color: '#1d4ed8' }}>{fmt(li.selling_price)}</strong></span>}
          </div>
        </div>
        <LineStatusBadge status={li.item_status} />
      </div>

      {/* Progress bar */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 10 }}>
        <span>Ordered: <strong>{li.quantity}</strong></span>
        <span style={{ color: '#16a34a' }}>Received: <strong>{li.received_qty}</strong></span>
        <span style={{ color: li.outstanding_qty > 0 ? '#d97706' : '#16a34a' }}>
          Outstanding: <strong>{li.outstanding_qty}</strong>
        </span>
      </div>

      {/* Received devices */}
      {li.received_devices.length > 0 && (
        <div style={{ background: '#f8fafc', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>Received Units</div>
          {li.received_devices.map(rd => (
            <div key={rd.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{rd.imei}</span>
              <span style={{ color: '#94a3b8' }}>
                {[rd.actual_brand, rd.actual_model_str, rd.actual_ram_str, rd.actual_storage_str, rd.actual_colour_str].filter(Boolean).join(' ')}
              </span>
              {rd.selling_price && <span style={{ color: '#1d4ed8', fontWeight: 600 }}>{fmt(rd.selling_price)}</span>}
              <button
                onClick={() => onPrintLabel(rd.imei, rd)}
                style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer' }}
              >
                🖨 Label
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {canReceive && (
          <Btn size="sm" onClick={() => onReceive(li)}>+ Receive Next Unit</Btn>
        )}
        {canMarkNotReceived && (
          <Btn size="sm" variant="secondary" onClick={() => onNotReceived(li)}>Mark Not Received</Btn>
        )}
        {canEdit && (
          <Btn size="sm" variant="ghost" onClick={() => onEdit(li)}>Edit Expected</Btn>
        )}
        {canDelete && (
          <Btn size="sm" variant="ghost" onClick={() => onDelete(li)}>Remove</Btn>
        )}
      </div>
    </div>
  )
}

// ─── Edit Line Item Modal ──────────────────────────────────────────────────────

function EditLineItemModal({ poId, lineItem, onClose }: { poId: string; lineItem: POLineItem; onClose: () => void }) {
  const qc = useQueryClient()
  const [brand, setBrand] = useState(lineItem.brand ?? '')
  const [model, setModel] = useState(lineItem.model_name_str ?? '')
  const [ram, setRam] = useState(lineItem.ram_str ?? '')
  const [ram_custom, setRamCustom] = useState('')
  const [storage, setStorage] = useState(lineItem.storage_str ?? '')
  const [rom_custom, setRomCustom] = useState('')
  const [colour, setColour] = useState(lineItem.colour_str ?? '')
  const [grade, setGrade] = useState(lineItem.grade ?? 'C')
  const [condition, setCondition] = useState('awaiting_refurb')
  const [sellingPrice, setSellingPrice] = useState(lineItem.selling_price ? String(parseFloat(lineItem.selling_price)) : '')
  const [quantity, setQuantity] = useState(String(lineItem.quantity))
  const [notes, setNotes] = useState(lineItem.notes ?? '')

  const mut = useMutation({
    mutationFn: () => updatePOLineItem(poId, lineItem.id, {
      brand: brand || undefined,
      model_name_str: model || undefined,
      ram_str: (ram === 'Other' ? ram_custom : ram) || undefined,
      storage_str: (storage === 'Other' ? rom_custom : storage) || undefined,
      colour_str: colour || undefined,
      grade: grade || undefined,
      initial_status: condition,
      selling_price: sellingPrice ? parseFloat(sellingPrice) : undefined,
      quantity: parseInt(quantity) || 1,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      toast.success('Line item updated')
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      onClose()
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Failed to update'),
  })

  return (
    <Modal open onClose={onClose} title="Edit Expected Item" maxWidth={500}>
      {lineItem.received_qty > 0 && (
        <div style={{ padding: '8px 12px', background: '#fef3c7', borderRadius: 6, marginBottom: 12, fontSize: 12, color: '#92400e' }}>
          ⚠️ {lineItem.received_qty} unit(s) already received — quantity cannot go below {lineItem.received_qty}.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Brand"><input value={brand} onChange={e => setBrand(e.target.value)} style={fieldStyle} /></Field>
        <Field label="Model"><input value={model} onChange={e => setModel(e.target.value)} style={fieldStyle} /></Field>
        <Field label="RAM">
          <select value={ram} onChange={e => setRam(e.target.value)} style={fieldStyle}>
            <option value="">— Select —</option>
            {RAM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {ram === 'Other' && <input value={ram_custom} onChange={e => setRamCustom(e.target.value)} style={{ ...fieldStyle, marginTop: 4 }} />}
        </Field>
        <Field label="ROM">
          <select value={storage} onChange={e => setStorage(e.target.value)} style={fieldStyle}>
            <option value="">— Select —</option>
            {ROM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {storage === 'Other' && <input value={rom_custom} onChange={e => setRomCustom(e.target.value)} style={{ ...fieldStyle, marginTop: 4 }} />}
        </Field>
        <Field label="Colour"><input value={colour} onChange={e => setColour(e.target.value)} style={fieldStyle} /></Field>
        <Field label="Grade">
          <select value={grade} onChange={e => setGrade(e.target.value)} style={fieldStyle}>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Condition">
          <select value={condition} onChange={e => setCondition(e.target.value)} style={{ ...fieldStyle, color: conditionColor(condition), fontWeight: 600 }}>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Selling Price (₦)">
          <input type="number" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} style={fieldStyle} min="0" step="0.01" />
        </Field>
        <Field label="Ordered Qty">
          <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} style={fieldStyle} min={lineItem.received_qty || 1} />
        </Field>
        <Field label="Notes">
          <input value={notes} onChange={e => setNotes(e.target.value)} style={fieldStyle} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</Btn>
      </div>
    </Modal>
  )
}

// ─── PO Detail Panel ──────────────────────────────────────────────────────────

function PODetailPanel({ po }: { po: PurchaseOrder }) {
  const qc = useQueryClient()
  const [receivingLI, setReceivingLI] = useState<POLineItem | null>(null)
  const [editingLI, setEditingLI] = useState<POLineItem | null>(null)
  const [showRecon, setShowRecon] = useState(false)
  const [showAddLine, setShowAddLine] = useState(false)

  const notReceivedMut = useMutation({
    mutationFn: (li: POLineItem) => markLineItemNotReceived(po.id, li.id, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('Marked as not received') },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const deleteLIMut = useMutation({
    mutationFn: (li: POLineItem) => deletePOLineItem(po.id, li.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('Item removed') },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const closeDiscMut = useMutation({
    mutationFn: () => closePOWithDiscrepancy(po.id, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('PO closed with discrepancy') },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const handlePrintLabel = (imei: string, rd: POReceivedDevice) => {
    printDeviceLabels([{
      imei,
      brand: rd.actual_brand ?? '',
      model_name: rd.actual_model_str ?? '',
      ram: rd.actual_ram_str ?? '',
      storage: rd.actual_storage_str ?? '',
      colour: rd.actual_colour_str ?? '',
      grade: rd.actual_grade ?? '',
    }])
  }

  const deviceLines = po.line_items.filter(li => li.line_type === 'device')
  const canClose = ['ordered', 'open', 'partially_received'].includes(po.status) &&
    deviceLines.some(li => li.received_qty > 0 || li.item_status === 'not_received')

  return (
    <div style={{ padding: '12px 16px 20px', borderTop: '1px solid #f1f5f9' }}>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 16, fontSize: 13 }}>
        <span>Total Ordered: <strong>{po.total_ordered}</strong></span>
        <span style={{ color: '#16a34a' }}>Received: <strong>{po.total_received}</strong></span>
        <span style={{ color: po.total_ordered - po.total_received > 0 ? '#d97706' : '#16a34a' }}>
          Outstanding: <strong>{po.total_ordered - po.total_received}</strong>
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Btn size="sm" variant="ghost" onClick={() => setShowRecon(true)}>📊 Reconciliation</Btn>
          {!['cancelled', 'fully_received', 'received', 'closed_discrepancy'].includes(po.status) && (
            <Btn size="sm" variant="ghost" onClick={() => setShowAddLine(true)}>+ Add Item</Btn>
          )}
          {canClose && (
            <Btn size="sm" variant="secondary" onClick={() => {
              if (confirm('Close this PO with discrepancy? Some items will remain unreceived.'))
                closeDiscMut.mutate()
            }}>
              Close with Discrepancy
            </Btn>
          )}
        </div>
      </div>

      {/* Line items */}
      {deviceLines.length === 0 ? (
        <div style={{ color: '#94a3b8', fontSize: 13, padding: 12 }}>No device lines on this PO.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {deviceLines.map(li => (
            <LineItemCard
              key={li.id}
              po={po}
              lineItem={li}
              onReceive={setReceivingLI}
              onNotReceived={li => {
                if (confirm('Mark this item as not received? This cannot be undone if nothing has been received.'))
                  notReceivedMut.mutate(li)
              }}
              onEdit={setEditingLI}
              onDelete={li => {
                if (confirm('Remove this expected item?')) deleteLIMut.mutate(li)
              }}
              onPrintLabel={handlePrintLabel}
            />
          ))}
        </div>
      )}

      {receivingLI && (
        <ReceiveDeviceModal
          poId={po.id}
          lineItem={receivingLI}
          onClose={() => setReceivingLI(null)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['purchase-orders'] })
            setReceivingLI(null)
          }}
        />
      )}
      {editingLI && (
        <EditLineItemModal poId={po.id} lineItem={editingLI} onClose={() => setEditingLI(null)} />
      )}
      {showRecon && <ReconciliationModal poId={po.id} onClose={() => setShowRecon(false)} />}
      {showAddLine && (
        <AddLineItemModal poId={po.id} onClose={() => setShowAddLine(false)}
          onSuccess={() => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); setShowAddLine(false) }}
        />
      )}
    </div>
  )
}

// ─── Add Line Item Modal ───────────────────────────────────────────────────────

function AddLineItemModal({ poId, onClose, onSuccess }: { poId: string; onClose: () => void; onSuccess: () => void }) {
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [ram, setRam] = useState('')
  const [ram_custom, setRamCustom] = useState('')
  const [storage, setStorage] = useState('')
  const [rom_custom, setRomCustom] = useState('')
  const [colour, setColour] = useState('')
  const [grade, setGrade] = useState('C')
  const [condition, setCondition] = useState('awaiting_refurb')
  const [sellingPrice, setSellingPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [notes, setNotes] = useState('')

  const mut = useMutation({
    mutationFn: () => addPOLineItem(poId, {
      line_type: 'device',
      brand: brand.trim() || undefined,
      model_name_str: model.trim() || undefined,
      ram_str: (ram === 'Other' ? ram_custom : ram).trim() || undefined,
      storage_str: (storage === 'Other' ? rom_custom : storage).trim() || undefined,
      colour_str: colour.trim() || undefined,
      grade, initial_status: condition,
      selling_price: sellingPrice ? parseFloat(sellingPrice) : undefined,
      quantity: parseInt(quantity) || 1,
      unit_cost: 0,
      notes: notes || undefined,
    }),
    onSuccess,
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Failed to add item'),
  })

  return (
    <Modal open onClose={onClose} title="Add Expected Item" maxWidth={480}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Brand *"><input value={brand} onChange={e => setBrand(e.target.value)} style={fieldStyle} placeholder="Samsung" /></Field>
        <Field label="Model *"><input value={model} onChange={e => setModel(e.target.value)} style={fieldStyle} placeholder="Galaxy S21" /></Field>
        <Field label="RAM">
          <select value={ram} onChange={e => setRam(e.target.value)} style={fieldStyle}>
            <option value="">— Select —</option>
            {RAM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {ram === 'Other' && <input value={ram_custom} onChange={e => setRamCustom(e.target.value)} style={{ ...fieldStyle, marginTop: 4 }} />}
        </Field>
        <Field label="ROM">
          <select value={storage} onChange={e => setStorage(e.target.value)} style={fieldStyle}>
            <option value="">— Select —</option>
            {ROM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {storage === 'Other' && <input value={rom_custom} onChange={e => setRomCustom(e.target.value)} style={{ ...fieldStyle, marginTop: 4 }} />}
        </Field>
        <Field label="Colour"><input value={colour} onChange={e => setColour(e.target.value)} style={fieldStyle} placeholder="Black" /></Field>
        <Field label="Grade">
          <select value={grade} onChange={e => setGrade(e.target.value)} style={fieldStyle}>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Condition">
          <select value={condition} onChange={e => setCondition(e.target.value)} style={{ ...fieldStyle, color: conditionColor(condition), fontWeight: 600 }}>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Selling Price (₦)">
          <input type="number" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} style={fieldStyle} min="0" step="0.01" />
        </Field>
        <Field label="Qty">
          <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} style={fieldStyle} min="1" />
        </Field>
        <Field label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} style={fieldStyle} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => mut.mutate()} disabled={mut.isPending || !brand.trim() || !model.trim()}>
          {mut.isPending ? 'Adding…' : 'Add Item'}
        </Btn>
      </div>
    </Modal>
  )
}

// ─── New PO Modal ─────────────────────────────────────────────────────────────

interface NewPOLine {
  brand: string; model_name_str: string
  ram_str: string; ram_custom: string
  storage_str: string; rom_custom: string
  colour_str: string; grade: string
  initial_status: string; selling_price: string
  quantity: string; notes: string
}

const emptyLine = (): NewPOLine => ({
  brand: '', model_name_str: '',
  ram_str: '', ram_custom: '', storage_str: '', rom_custom: '',
  colour_str: '', grade: 'C', initial_status: 'awaiting_refurb',
  selling_price: '', quantity: '1', notes: '',
})

function NewPOModal({ open, onClose, suppliers, onSuccess }: {
  open: boolean; onClose: () => void; suppliers: Supplier[]; onSuccess: () => void
}) {
  const [supplierId, setSupplierId] = useState('')
  const [shippingCost, setShippingCost] = useState('0')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<NewPOLine[]>([emptyLine()])

  const updateLine = (i: number, patch: Partial<NewPOLine>) => {
    setLines(prev => { const n = [...prev]; n[i] = { ...n[i], ...patch }; return n })
  }

  const mut = useMutation({
    mutationFn: (data: unknown) => createPurchaseOrder(data),
    onSuccess: () => { toast.success('Purchase order created — use "Receive Items" when goods arrive'); onSuccess() },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Failed to create PO'),
  })

  const reset = () => { setSupplierId(''); setShippingCost('0'); setNotes(''); setLines([emptyLine()]) }
  const handleClose = () => { reset(); onClose() }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplierId) { toast.error('Please select a supplier'); return }
    const validLines = lines.filter(l => l.brand.trim() && l.model_name_str.trim())
    if (!validLines.length) { toast.error('Add at least one device with brand and model'); return }
    if (validLines.some(l => !l.selling_price || parseFloat(l.selling_price) <= 0)) {
      toast.error('Selling price is required for all items'); return
    }

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
        colour_str: l.colour_str.trim() || undefined,
        grade: l.grade,
        initial_status: l.initial_status,
        selling_price: parseFloat(l.selling_price) || 0,
        quantity: parseInt(l.quantity) || 1,
        unit_cost: 0,
        notes: l.notes || undefined,
      })),
    })
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Purchase Order" maxWidth={1000}>
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>
          <div>
            <label style={{ ...labelStyle, marginBottom: 6 }}>Supplier *</label>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} required style={fieldStyle}>
              <option value="">Select supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Input label="Shipping Cost (₦)" type="number" value={shippingCost}
            onChange={e => setShippingCost(e.target.value)} style={{ marginBottom: 0 }} />
          <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} style={{ marginBottom: 0 }} />
        </div>

        <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: 16, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 14 }}>Expected Items</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            📋 Record what you <em>expect</em> to receive. IMEIs are scanned when physical goods arrive.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lines.map((line, i) => (
              <div key={i} style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '16px 20px', background: '#f8fafc', position: 'relative' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 12, textTransform: 'uppercase' }}>
                  Item {i + 1}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 12, marginBottom: 12 }}>
                  <Field label="Brand *">
                    <input placeholder="Samsung" value={line.brand} onChange={e => updateLine(i, { brand: e.target.value })} style={fieldStyle} />
                  </Field>
                  <Field label="Model Name *">
                    <input placeholder="Galaxy S21" value={line.model_name_str} onChange={e => updateLine(i, { model_name_str: e.target.value })} style={fieldStyle} />
                  </Field>
                  <Field label="Qty">
                    <input type="number" min="1" value={line.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} style={fieldStyle} />
                  </Field>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <Field label="RAM">
                    <select value={line.ram_str} onChange={e => updateLine(i, { ram_str: e.target.value })} style={fieldStyle}>
                      <option value="">— Select —</option>
                      {RAM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {line.ram_str === 'Other' && (
                      <input placeholder="e.g. 3GB" value={line.ram_custom} onChange={e => updateLine(i, { ram_custom: e.target.value })} style={{ ...fieldStyle, marginTop: 6 }} />
                    )}
                  </Field>
                  <Field label="ROM (Storage)">
                    <select value={line.storage_str} onChange={e => updateLine(i, { storage_str: e.target.value })} style={fieldStyle}>
                      <option value="">— Select —</option>
                      {ROM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {line.storage_str === 'Other' && (
                      <input placeholder="e.g. 4TB" value={line.rom_custom} onChange={e => updateLine(i, { rom_custom: e.target.value })} style={{ ...fieldStyle, marginTop: 6 }} />
                    )}
                  </Field>
                  <Field label="Colour">
                    <input placeholder="Black" value={line.colour_str} onChange={e => updateLine(i, { colour_str: e.target.value })} style={fieldStyle} />
                  </Field>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 160px auto', gap: 12, alignItems: 'end' }}>
                  <Field label="Grade">
                    <select value={line.grade} onChange={e => updateLine(i, { grade: e.target.value })} style={fieldStyle}>
                      {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </Field>
                  <Field label="Condition">
                    <select value={line.initial_status} onChange={e => updateLine(i, { initial_status: e.target.value })}
                      style={{ ...fieldStyle, color: conditionColor(line.initial_status), fontWeight: 600 }}>
                      {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Selling Price (₦) *">
                    <input placeholder="0.00" type="number" value={line.selling_price}
                      onChange={e => updateLine(i, { selling_price: e.target.value })}
                      style={{ ...fieldStyle, borderColor: !line.selling_price ? '#f59e0b' : '#d1d5db' }}
                      min="0" step="0.01" />
                  </Field>
                  <div style={{ paddingBottom: 2 }}>
                    <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      disabled={lines.length === 1}
                      style={{
                        background: lines.length === 1 ? '#f1f5f9' : '#fee2e2',
                        border: '1px solid', borderColor: lines.length === 1 ? '#cbd5e1' : '#fca5a5',
                        borderRadius: 6, color: lines.length === 1 ? '#94a3b8' : '#dc2626',
                        cursor: lines.length === 1 ? 'not-allowed' : 'pointer',
                        padding: '8px 14px', fontWeight: 700, fontSize: 13,
                      }}>Remove</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <Btn size="sm" variant="ghost" type="button" onClick={() => setLines([...lines, emptyLine()])}>
              + Add Another Item
            </Btn>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: '8px 12px', background: '#eff6ff', borderRadius: 6, fontSize: 12, color: '#1e40af', border: '1px solid #bfdbfe' }}>
          ℹ️ This creates a <strong>planned order</strong>. No inventory is added yet.
          Use <strong>Receive Items</strong> on the PO to add devices to stock as they physically arrive.
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Btn variant="secondary" onClick={handleClose} type="button">Cancel</Btn>
          <Btn type="submit" disabled={mut.isPending}>
            {mut.isPending ? 'Creating…' : 'Create Purchase Order'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

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

  return (
    <div style={{ padding: 28 }}>
      <PageHeader
        title="Purchase Orders (Intake)"
        action={<Btn onClick={() => setShowNew(true)}>+ New PO</Btn>}
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', padding: '12px 16px' }}>
          <Select label="Filter by Status" value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{ maxWidth: 200, marginBottom: 0 }}>
            <option value="">All</option>
            <option value="open">Ordered</option>
            <option value="partially_received">Partially Received</option>
            <option value="fully_received">Fully Received</option>
            <option value="closed_discrepancy">Closed (Discrepancy)</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
      </Card>

      {pos.length === 0 ? (
        <Card><div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>No purchase orders found.</div></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pos.map(po => {
            const isExpanded = expandedPO === po.id
            const outstanding = po.total_ordered - po.total_received
            return (
              <Card key={po.id} style={{ overflow: 'hidden' }}>
                {/* PO header row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
                  onClick={() => setExpandedPO(isExpanded ? null : po.id)}
                >
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#1e293b', minWidth: 140 }}>{po.po_number}</div>
                  <StatusBadge status={po.status} label={po.status_label} />
                  <div style={{ fontSize: 13, color: '#64748b', flex: 1 }}>
                    {new Date(po.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                  <div style={{ fontSize: 12, color: '#475569' }}>
                    {po.total_ordered} ordered · <span style={{ color: '#16a34a' }}>{po.total_received} received</span>
                    {outstanding > 0 && <span style={{ color: '#d97706' }}> · {outstanding} outstanding</span>}
                  </div>
                  <div style={{ fontSize: 20, color: '#94a3b8', marginLeft: 8 }}>{isExpanded ? '▲' : '▼'}</div>
                </div>

                {isExpanded && <PODetailPanel po={po} />}
              </Card>
            )
          })}
        </div>
      )}

      <NewPOModal
        open={showNew}
        onClose={() => setShowNew(false)}
        suppliers={suppliers}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); setShowNew(false) }}
      />
    </div>
  )
}
