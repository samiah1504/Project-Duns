import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { barcodeDataURL } from '../utils/barcode'
import { getCompanySettings } from '../hooks/useCompanySettings'
import {
  getPurchaseOrders, getSuppliers, createPurchaseOrder,
  receivePurchaseOrder, getPODevices,
} from '../services/api'
import { PurchaseOrder, Supplier, DeviceWithModel } from '../types'
import {
  PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select, fmt,
} from '../components/Layout'

// ─── Barcode helpers ──────────────────────────────────────────────────────────

interface LabelDevice {
  imei: string
  brand: string
  model_name: string
  storage: string
  colour: string
  grade: string
  purchase_cost: string
}

function buildLabelHTML(devices: LabelDevice[]): string {
  const co = getCompanySettings()
  const today = new Date().toLocaleDateString('en-NG', {
    day: '2-digit', month: 'short', year: 'numeric',
  })

  const labels = devices.map((d) => {
    const barcodeSrc = barcodeDataURL(d.imei)
    return `
      <div class="label">
        <div class="company">${co.name}</div>
        <div class="model-line">${d.brand} ${d.model_name}</div>
        <div class="specs">
          <span class="spec-item">💾 ${d.storage || '—'}</span>
          <span class="spec-item">🎨 ${d.colour || '—'}</span>
          <span class="spec-item">Grade: <strong>${d.grade}</strong></span>
        </div>
        <div class="imei-line">IMEI: ${d.imei}</div>
        <img class="barcode" src="${barcodeSrc}" alt="barcode" />
        <div class="date-line">Printed: ${today}</div>
      </div>`
  }).join('')

  return `<!DOCTYPE html><html><head><title>Barcode Labels</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #fff; }
    .grid { display: flex; flex-wrap: wrap; gap: 4mm; padding: 4mm; }
    .label {
      width: 85mm; border: 1px solid #999; border-radius: 3mm;
      padding: 4mm; page-break-inside: avoid; background: #fff;
    }
    .company { font-size: 9pt; color: #555; text-transform: uppercase; letter-spacing: 1px; }
    .model-line { font-size: 13pt; font-weight: 700; margin: 2mm 0 1mm; color: #111; }
    .specs { display: flex; gap: 4mm; font-size: 9pt; color: #333; margin-bottom: 2mm; flex-wrap: wrap; }
    .spec-item { background: #f0f0f0; padding: 1mm 2mm; border-radius: 2mm; }
    .imei-line { font-size: 8pt; color: #444; margin-bottom: 2mm; font-family: monospace; }
    .barcode { width: 100%; height: auto; display: block; margin-bottom: 1mm; }
    .date-line { font-size: 7pt; color: #999; text-align: right; }
    @media print {
      body { margin: 0; }
      .grid { gap: 2mm; padding: 2mm; }
      .label { border-color: #ccc; }
      .no-print { display: none; }
    }
  </style></head>
  <body>
    <div class="no-print" style="padding:8px;background:#1e293b;color:#fff;display:flex;gap:8px;align-items:center">
      <span style="flex:1">${devices.length} label(s) ready</span>
      <button onclick="window.print()" style="padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700">🖨 Print</button>
      <button onclick="window.close()" style="padding:6px 16px;background:#475569;color:#fff;border:none;border-radius:4px;cursor:pointer">Close</button>
    </div>
    <div class="grid">${labels}</div>
  </body></html>`
}

function printDeviceLabels(devices: LabelDevice[]) {
  if (!devices.length) return
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) { toast.error('Pop-up blocked — please allow pop-ups for this page'); return }
  w.document.write(buildLabelHTML(devices))
  w.document.close()
}

function deviceToLabel(d: DeviceWithModel): LabelDevice {
  return {
    imei: d.imei,
    brand: d.model?.brand ?? '—',
    model_name: d.model?.model_name ?? '—',
    storage: d.model?.storage ?? '—',
    colour: d.model?.colour ?? '—',
    grade: d.grade,
    purchase_cost: d.purchase_cost,
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
            {['IMEI', 'Model', 'Storage', 'Colour', 'Grade', 'Cost', 'Status', ''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#64748b', fontSize: 11, fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(devices as DeviceWithModel[]).map(d => (
            <tr key={d.id} style={{ borderBottom: '1px solid #f8fafc' }}>
              <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}>{d.imei}</td>
              <td style={{ padding: '6px 8px' }}>{d.model?.brand} {d.model?.model_name}</td>
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

const STORAGE_OPTIONS = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB']
const GRADES = ['A', 'B', 'C']

interface LineItem {
  brand: string
  model_name_str: string
  storage_str: string
  colour_str: string
  grade: string
  imei: string
  unit_cost: string
}

const emptyLine = (): LineItem => ({
  brand: '', model_name_str: '', storage_str: '', colour_str: '', grade: 'C', imei: '', unit_cost: '',
})

function NewPOModal({ open, onClose, suppliers, onSuccess }: {
  open: boolean; onClose: () => void
  suppliers: Supplier[]
  onSuccess: () => void
}) {
  const [supplierId, setSupplierId] = useState('')
  const [shippingCost, setShippingCost] = useState('0')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineItem[]>([emptyLine()])

  const updateLine = (i: number, field: keyof LineItem, value: string) => {
    setLines(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      return next
    })
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

    mut.mutate({
      supplier_id: supplierId,
      shipping_cost: parseFloat(shippingCost) || 0,
      notes,
      line_items: validLines.map(l => ({
        line_type: 'device',
        brand: l.brand.trim(),
        model_name_str: l.model_name_str.trim(),
        storage_str: l.storage_str.trim(),
        colour_str: l.colour_str.trim(),
        grade: l.grade,
        imei: l.imei.trim(),
        unit_cost: parseFloat(l.unit_cost) || 0,
      })),
    })
  }

  const cellStyle: React.CSSProperties = {
    padding: '5px 4px', border: '1px solid #d1d5db', borderRadius: 4,
    fontSize: 12, width: '100%', outline: 'none',
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Purchase Order">
      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#374151' }}>Supplier *</label>
            <select value={supplierId} onChange={e => setSupplierId(e.target.value)} required style={{ ...cellStyle, padding: '7px 8px' }}>
              <option value="">Select supplier…</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Input label="Shipping Cost (₦)" type="number" value={shippingCost}
            onChange={e => setShippingCost(e.target.value)} style={{ marginBottom: 0 }} />
        </div>
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />

        <div style={{ marginTop: 4, marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
            Devices / Items
          </div>

          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1.2fr 0.8fr 0.8fr 0.6fr 1.4fr 0.8fr 28px',
            gap: 4, marginBottom: 4,
          }}>
            {['Brand', 'Model Name', 'Storage', 'Colour', 'Grade', 'IMEI', 'Cost (₦)', ''].map(h => (
              <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#64748b', padding: '0 2px' }}>{h}</div>
            ))}
          </div>

          {lines.map((line, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1.2fr 0.8fr 0.8fr 0.6fr 1.4fr 0.8fr 28px',
              gap: 4, marginBottom: 6,
            }}>
              <input placeholder="Samsung" value={line.brand}
                onChange={e => updateLine(i, 'brand', e.target.value)}
                style={cellStyle} required />
              <input placeholder="Galaxy S21" value={line.model_name_str}
                onChange={e => updateLine(i, 'model_name_str', e.target.value)}
                style={cellStyle} required />
              <select value={line.storage_str} onChange={e => updateLine(i, 'storage_str', e.target.value)} style={cellStyle}>
                <option value="">—</option>
                {STORAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input placeholder="Black" value={line.colour_str}
                onChange={e => updateLine(i, 'colour_str', e.target.value)}
                style={cellStyle} />
              <select value={line.grade} onChange={e => updateLine(i, 'grade', e.target.value)} style={cellStyle}>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <input placeholder="353123456789012" value={line.imei}
                onChange={e => updateLine(i, 'imei', e.target.value)}
                style={{ ...cellStyle, fontFamily: 'monospace' }} required
                maxLength={20} />
              <input placeholder="0.00" type="number" value={line.unit_cost}
                onChange={e => updateLine(i, 'unit_cost', e.target.value)}
                style={cellStyle} required min="0" step="0.01" />
              <button type="button"
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
                disabled={lines.length === 1}
                style={{
                  background: 'none', border: 'none', cursor: lines.length === 1 ? 'not-allowed' : 'pointer',
                  color: '#ef4444', fontWeight: 700, fontSize: 16, opacity: lines.length === 1 ? 0.3 : 1,
                }}>✕</button>
            </div>
          ))}

          <Btn size="sm" variant="ghost" type="button"
            onClick={() => setLines([...lines, emptyLine()])}>
            + Add Device
          </Btn>
        </div>

        <div style={{
          marginTop: 16, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6,
          fontSize: 12, color: '#166534', border: '1px solid #bbf7d0',
        }}>
          ℹ️ Devices are added to inventory immediately when this PO is saved.
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
