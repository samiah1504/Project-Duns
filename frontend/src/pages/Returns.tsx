import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  getReturnBatches, createReturnBatch, updateReturnBatchStatus, resolveReturnItem,
  getCustomers, getSales, getDevices, getSellableDevices,
} from '../services/api'
import { ReturnBatch, ReturnRMA, Customer, Sale, Device } from '../types'
import { PageHeader, Card, Btn, Modal, Input, Select, fmt } from '../components/Layout'

// FastAPI returns detail as string OR array of {loc,msg,type} objects.
// Passing a non-string to toast.error crashes React (blank page), so always coerce.
function apiErr(e: any, fallback = 'An error occurred'): string {
  const d = e?.response?.data?.detail
  if (!d) return fallback
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x: any) => `${(x.loc ?? []).slice(1).join('.')}: ${x.msg ?? String(x)}`).join('; ')
  return fallback
}

// ── constants ─────────────────────────────────────────────────────────────────

const REASONS = [
  { value: 'DOA', label: 'DOA (Dead on Arrival)' },
  { value: 'fault_developed', label: 'Fault Developed' },
  { value: 'wrong_item', label: 'Wrong Item' },
  { value: 'not_as_described', label: 'Not as Described' },
  { value: 'buyer_remorse', label: 'Buyer Remorse' },
  { value: 'warranty_claim', label: 'Warranty Claim' },
]

const RESOLUTIONS = [
  { value: 'refund', label: 'Refund' },
  { value: 'replace', label: 'Replacement' },
  { value: 'repair_and_return', label: 'Repair & Return to Customer' },
  { value: 'restock', label: 'Restock' },
  { value: 'reject', label: 'Reject Return' },
  { value: 'scrap', label: 'Scrap' },
]

const RESTOCK_OUTCOMES = [
  { value: 'sellable', label: '→ Sellable (Sales Stock)' },
  { value: 'awaiting_refurb', label: '→ Awaiting Refurb (Engineer Bench)' },
  { value: 'scrapped', label: '→ Scrapped' },
]

const BATCH_STATUSES = [
  { value: 'draft',              label: 'Draft',              bg: '#f1f5f9', color: '#475569' },
  { value: 'received',           label: 'Received',           bg: '#dbeafe', color: '#1d4ed8' },
  { value: 'under_inspection',   label: 'Under Inspection',   bg: '#fef3c7', color: '#92400e' },
  { value: 'partially_resolved', label: 'Partially Resolved', bg: '#fed7aa', color: '#c2410c' },
  { value: 'completed',          label: 'Completed',          bg: '#dcfce7', color: '#166534' },
  { value: 'cancelled',          label: 'Cancelled',          bg: '#fee2e2', color: '#991b1b' },
]

function statusBadge(status: string) {
  const cfg = BATCH_STATUSES.find(s => s.value === status) ?? BATCH_STATUSES[0]
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 3, fontWeight: 600, background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}

function resolutionLabel(r?: string) {
  if (!r) return <span style={{ color: '#94a3b8', fontSize: 12 }}>Pending</span>
  const label = RESOLUTIONS.find(x => x.value === r)?.label ?? r
  return <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 12 }}>{label}</span>
}

// ── item draft type ───────────────────────────────────────────────────────────

interface ItemDraft {
  device_id: string
  imei: string
  inventory_number: string
  model_label: string
  grade: string
  reason_code: string
  condition_on_return: string
  within_warranty: boolean
  resolution: string
  refund_amount: string
  restock_outcome: string
  replacement_device_id: string
  notes: string
}

const emptyItem = (d?: any): ItemDraft => ({
  device_id: d?.id ?? '',
  imei: d?.imei ?? '',
  inventory_number: d?.inventory_number ?? '',
  model_label: d ? `${d.model?.brand ?? ''} ${d.model?.model_name ?? ''}`.trim() : '',
  grade: d?.grade ?? '',
  reason_code: 'DOA',
  condition_on_return: '',
  within_warranty: false,
  resolution: '',
  refund_amount: '',
  restock_outcome: '',
  replacement_device_id: '',
  notes: '',
})

const cellSt: React.CSSProperties = {
  padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, width: '100%',
}

// ── replacement device picker (scan/type IMEI, dropdown fallback) ─────────────

function ReplacementPicker({ devices, value, onChange, compact }: {
  devices: any[]
  value: string
  onChange: (deviceId: string) => void
  compact?: boolean
}) {
  const [scanValue, setScanValue] = useState('')
  const [scanError, setScanError] = useState('')

  const selected = devices.find(d => d.id === value)

  const doScan = () => {
    const val = scanValue.trim()
    if (!val) return
    const found = devices.find(d => d.imei === val || d.inventory_number === val)
    if (!found) { setScanError(`${val} not found in sellable stock`); return }
    setScanError('')
    setScanValue('')
    onChange(found.id)
  }

  const fs = compact ? 12 : 13

  return (
    <div>
      {selected ? (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
          padding: '6px 10px', background: '#f0fdf4', border: '1px solid #86efac',
          borderRadius: 6, fontSize: fs, marginBottom: 4,
        }}>
          <span>
            ✓ <strong>{selected.model?.brand} {selected.model?.model_name}</strong>
            {selected.model?.storage ? ` ${selected.model.storage}` : ''} · Grade {selected.grade}
            <span style={{ fontFamily: 'monospace', marginLeft: 6, color: '#166534' }}>
              {selected.imei ?? selected.inventory_number}
            </span>
          </span>
          <button type="button" onClick={() => onChange('')}
            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 700, fontSize: fs }}>✕</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
            <input
              value={scanValue}
              onChange={e => { setScanValue(e.target.value); setScanError('') }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doScan() } }}
              placeholder="Scan or type IMEI / inventory number…"
              style={{ ...cellSt, fontSize: fs, flex: 1, padding: '6px 8px' }}
            />
            <Btn size="sm" onClick={doScan} type="button">Add</Btn>
          </div>
          {scanError && (
            <div style={{ color: '#dc2626', fontSize: 11, marginBottom: 4 }}>{scanError}</div>
          )}
          <select value={value} onChange={e => onChange(e.target.value)} style={{ ...cellSt, fontSize: fs }}>
            <option value="">— or select from list —</option>
            {devices.map(d => (
              <option key={d.id} value={d.id}>
                {d.imei ?? d.inventory_number} — {d.model?.brand} {d.model?.model_name} {d.grade}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}

// ── new batch modal ───────────────────────────────────────────────────────────

function NewBatchModal({ open, onClose, onSuccess }: {
  open: boolean
  onClose: () => void
  onSuccess: (id: string) => void
}) {
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [customerId, setCustomerId] = useState('')
  const [saleId, setSaleId] = useState('')
  const [returnDate, setReturnDate] = useState('')
  const [batchNotes, setBatchNotes] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([])
  const [scanInput, setScanInput] = useState('')
  const [resolveNow, setResolveNow] = useState(false)

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ['customers'], queryFn: () => getCustomers().then(r => r.data) })
  const { data: soldDevices = [] } = useQuery<Device[]>({ queryKey: ['sold-devices'], queryFn: () => getDevices({ status: 'SOLD' }).then(r => r.data), enabled: open })
  const { data: allSales = [] } = useQuery<Sale[]>({ queryKey: ['sales'], queryFn: () => getSales().then(r => r.data), enabled: open })
  const { data: sellableDevices = [] } = useQuery<Device[]>({ queryKey: ['sellable-devices'], queryFn: () => getSellableDevices().then(r => r.data), enabled: open })

  const customerSales = useMemo(
    () => (allSales as Sale[]).filter(s => s.customer_id === customerId),
    [allSales, customerId]
  )

  const saleDevices = useMemo(() => {
    if (!saleId) return []
    const sale = (allSales as Sale[]).find(s => s.id === saleId)
    if (!sale) return []
    const ids = new Set(sale.line_items.filter(l => l.device_id).map(l => l.device_id!))
    return (soldDevices as any[]).filter(d => ids.has(d.id))
  }, [saleId, allSales, soldDevices])

  const mut = useMutation({
    mutationFn: (data: unknown) => createReturnBatch(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['return-batches'] })
      toast.success('Return batch created')
      onSuccess(res.data.id)
      resetAll()
    },
    onError: (e: any) => toast.error(apiErr(e, 'Error creating return')),
  })

  const resetAll = () => {
    setStep(1); setCustomerId(''); setSaleId(''); setReturnDate('')
    setBatchNotes(''); setItems([]); setScanInput(''); setResolveNow(false)
  }

  const handleClose = () => { resetAll(); onClose() }

  const addFromSale = (device: any) => {
    if (items.some(i => i.device_id === device.id)) { toast.error('Already added'); return }
    setItems(p => [...p, emptyItem(device)])
  }

  const addByScan = () => {
    const val = scanInput.trim()
    if (!val) return
    const found = (soldDevices as any[]).find(d => d.imei === val || d.inventory_number === val)
    if (!found) { toast.error(`No SOLD device: ${val}`); return }
    if (items.some(i => i.device_id === found.id)) { toast.error('Already added'); return }
    setItems(p => [...p, emptyItem(found)])
    setScanInput('')
  }

  const updateItem = (idx: number, field: keyof ItemDraft, value: string | boolean) =>
    setItems(p => p.map((it, i) => i === idx ? { ...it, [field]: value } : it))

  const removeItem = (idx: number) => setItems(p => p.filter((_, i) => i !== idx))

  const needsRestock = (res: string) => ['refund', 'restock', 'replace'].includes(res)

  const submit = () => {
    if (!customerId) { toast.error('Select a customer'); return }
    if (!items.length) { toast.error('Add at least one device'); return }
    mut.mutate({
      customer_id: customerId,
      original_sale_id: saleId || undefined,
      date: returnDate || undefined,
      notes: batchNotes || undefined,
      items: items.map(it => ({
        device_id: it.device_id,
        reason_code: it.reason_code,
        condition_on_return: it.condition_on_return || undefined,
        within_warranty: it.within_warranty,
        notes: it.notes || undefined,
        ...(resolveNow && it.resolution ? {
          resolution: it.resolution,
          refund_amount: it.refund_amount ? parseFloat(it.refund_amount) : undefined,
          restock_outcome: needsRestock(it.resolution) && it.restock_outcome ? it.restock_outcome : undefined,
          replacement_device_id: it.resolution === 'replace' && it.replacement_device_id ? it.replacement_device_id : undefined,
        } : {}),
      })),
    })
  }

  const stepLabels = ['1: Customer & Sale', '2: Add Devices', '3: Review & Save']

  return (
    <Modal open={open} onClose={handleClose} title="New Return / Batch RMA">
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {stepLabels.map((label, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', padding: '4px 0', borderRadius: 4, fontSize: 12, fontWeight: 600,
            background: step === i + 1 ? '#2563eb' : step > i + 1 ? '#dcfce7' : '#e2e8f0',
            color: step === i + 1 ? '#fff' : step > i + 1 ? '#166534' : '#64748b',
          }}>{label}</div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <Select label="Customer *" value={customerId} onChange={e => { setCustomerId(e.target.value); setSaleId('') }} required>
            <option value="">Select customer…</option>
            {(customers as Customer[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {customerId && (
            <Select label="Original Invoice (optional)" value={saleId} onChange={e => setSaleId(e.target.value)}>
              <option value="">No specific invoice</option>
              {customerSales.map(s => <option key={s.id} value={s.id}>{s.invoice_number} — {fmt(s.total)} — {s.date}</option>)}
            </Select>
          )}
          <Input label="Return Date" type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
          <Input label="Notes (optional)" value={batchNotes} onChange={e => setBatchNotes(e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Btn variant="secondary" onClick={handleClose} type="button">Cancel</Btn>
            <Btn onClick={() => { if (!customerId) { toast.error('Select a customer'); return } setStep(2) }}>Next →</Btn>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={scanInput} onChange={e => setScanInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addByScan()}
              placeholder="Scan barcode or type IMEI / inventory number…"
              style={{ ...cellSt, flex: 1, padding: '7px 10px' }} autoFocus />
            <Btn size="sm" onClick={addByScan}>Add</Btn>
          </div>

          {saleId && saleDevices.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>Devices from invoice (click to add):</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {saleDevices.map(d => {
                  const already = items.some(i => i.device_id === d.id)
                  return (
                    <button key={d.id} type="button" onClick={() => !already && addFromSale(d)}
                      style={{
                        padding: '3px 10px', borderRadius: 4, border: '1px solid',
                        background: already ? '#f0fdf4' : '#eff6ff',
                        borderColor: already ? '#86efac' : '#93c5fd',
                        color: already ? '#166534' : '#1d4ed8',
                        cursor: already ? 'default' : 'pointer', fontSize: 12, fontFamily: 'monospace',
                      }}>
                      {already ? '✓ ' : '+ '}{(d as any).inventory_number ?? d.imei}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {items.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Device', 'Reason', 'Condition on Return', 'Warranty', ''].map(h => (
                    <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: '#64748b', fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '5px 8px' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{it.inventory_number || it.imei}</div>
                      <div style={{ color: '#64748b', fontSize: 11 }}>{it.model_label} · {it.grade}</div>
                    </td>
                    <td style={{ padding: '4px 5px' }}>
                      <select value={it.reason_code} onChange={e => updateItem(idx, 'reason_code', e.target.value)} style={cellSt}>
                        {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '4px 5px' }}>
                      <input value={it.condition_on_return} onChange={e => updateItem(idx, 'condition_on_return', e.target.value)}
                        placeholder="e.g. cracked screen" style={cellSt} />
                    </td>
                    <td style={{ padding: '4px 5px', textAlign: 'center' }}>
                      <input type="checkbox" checked={it.within_warranty}
                        onChange={e => updateItem(idx, 'within_warranty', e.target.checked)} />
                    </td>
                    <td style={{ padding: '4px 5px' }}>
                      <button type="button" onClick={() => removeItem(idx)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: 6, marginBottom: 10 }}>
              No devices added yet. Scan or select from the invoice above.
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
            <input type="checkbox" checked={resolveNow} onChange={e => setResolveNow(e.target.checked)} />
            Set resolution for each device now (optional — can be done later)
          </label>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Btn variant="secondary" onClick={() => setStep(1)} type="button">← Back</Btn>
            <Btn onClick={() => { if (!items.length) { toast.error('Add at least one device'); return } setStep(3) }}>
              Next → ({items.length} device{items.length !== 1 ? 's' : ''})
            </Btn>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f0f9ff', borderRadius: 6, fontSize: 12, color: '#0369a1' }}>
            Review the return. Each device can have a different resolution. You can also save now and resolve later.
          </div>

          {items.map((it, idx) => (
            <div key={idx} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: resolveNow ? 10 : 0 }}>
                <div>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{it.inventory_number || it.imei}</span>
                  {it.model_label && <span style={{ marginLeft: 8, color: '#64748b', fontSize: 12 }}>{it.model_label} · Grade {it.grade}</span>}
                </div>
                <span style={{ fontSize: 11, color: '#64748b' }}>{REASONS.find(r => r.value === it.reason_code)?.label}</span>
              </div>

              {resolveNow && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Resolution</div>
                    <select value={it.resolution} onChange={e => updateItem(idx, 'resolution', e.target.value)} style={{ ...cellSt, fontSize: 12 }}>
                      <option value="">— set later —</option>
                      {RESOLUTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                  {needsRestock(it.resolution) && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Device Routing</div>
                      <select value={it.restock_outcome} onChange={e => updateItem(idx, 'restock_outcome', e.target.value)} style={{ ...cellSt, fontSize: 12 }}>
                        <option value="">— select —</option>
                        {RESTOCK_OUTCOMES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                  )}
                  {(it.resolution === 'refund' || it.resolution === 'replace') && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Refund Amount (₦)</div>
                      <input type="number" value={it.refund_amount}
                        onChange={e => updateItem(idx, 'refund_amount', e.target.value)}
                        placeholder="0.00" style={{ ...cellSt, fontSize: 12 }} min="0" step="0.01" />
                    </div>
                  )}
                  {it.resolution === 'replace' && (
                    <div style={{ gridColumn: '1/-1' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Replacement Device</div>
                      <ReplacementPicker
                        devices={sellableDevices as any[]}
                        value={it.replacement_device_id}
                        onChange={id => updateItem(idx, 'replacement_device_id', id)}
                        compact
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, fontSize: 13, marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <div><strong>Customer:</strong> {(customers as Customer[]).find(c => c.id === customerId)?.name ?? '—'}</div>
            <div><strong>Devices:</strong> {items.length}</div>
            {saleId && <div style={{ gridColumn: '1/-1' }}><strong>Invoice:</strong> {(allSales as Sale[]).find(s => s.id === saleId)?.invoice_number ?? '—'}</div>}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Btn variant="secondary" onClick={() => setStep(2)} type="button">← Back</Btn>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="secondary" onClick={handleClose} type="button">Cancel</Btn>
              <Btn onClick={submit} disabled={mut.isPending}>
                {mut.isPending ? 'Saving…' : `Save Return (${items.length} device${items.length !== 1 ? 's' : ''})`}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── resolve item modal ────────────────────────────────────────────────────────

function ResolveItemModal({ item, batch, onClose }: { item: ReturnRMA; batch: ReturnBatch; onClose: () => void }) {
  const qc = useQueryClient()
  const [resolution, setResolution] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [restockOutcome, setRestockOutcome] = useState('')
  const [replacementId, setReplacementId] = useState('')
  const [notes, setNotes] = useState('')

  const { data: sellableDevices = [] } = useQuery<Device[]>({
    queryKey: ['sellable-devices'],
    queryFn: () => getSellableDevices().then(r => r.data),
  })

  const mut = useMutation({
    mutationFn: (data: unknown) => resolveReturnItem(batch.id, item.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['return-batches'] })
      toast.success('Item resolved')
      onClose()
    },
    onError: (e: any) => toast.error(apiErr(e)),
  })

  const needsRestock = ['refund', 'restock', 'replace'].includes(resolution)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!resolution) { toast.error('Select a resolution'); return }
    mut.mutate({
      resolution,
      refund_amount: refundAmount ? parseFloat(refundAmount) : undefined,
      restock_outcome: needsRestock && restockOutcome ? restockOutcome : undefined,
      replacement_device_id: resolution === 'replace' && replacementId ? replacementId : undefined,
      notes: notes || undefined,
    })
  }

  return (
    <Modal open onClose={onClose} title={`Resolve ${item.rma_number}`}>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 12 }}>
          <div><strong>Device:</strong> {item.device?.inventory_number ?? item.device?.imei ?? item.device_id}</div>
          <div><strong>IMEI:</strong> {item.device?.imei ?? '—'}</div>
          <div><strong>Reason:</strong> {REASONS.find(r => r.value === item.reason_code)?.label ?? item.reason_code}</div>
          {item.condition_on_return && <div><strong>Condition:</strong> {item.condition_on_return}</div>}
          <div><strong>Warranty:</strong> {item.within_warranty ? 'Yes' : 'No'}</div>
        </div>

        <Select label="Resolution *" value={resolution} onChange={e => setResolution(e.target.value)} required>
          <option value="">Select…</option>
          {RESOLUTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>

        {needsRestock && (
          <Select label="Device Routing *" value={restockOutcome} onChange={e => setRestockOutcome(e.target.value)} required>
            <option value="">Select…</option>
            {RESTOCK_OUTCOMES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        )}

        {(resolution === 'refund' || resolution === 'replace') && (
          <Input label="Refund Amount (₦)" type="number" value={refundAmount}
            onChange={e => setRefundAmount(e.target.value)} min="0" step="0.01" />
        )}

        {resolution === 'replace' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
              Replacement Device (scan IMEI or pick from list)
            </div>
            <ReplacementPicker
              devices={sellableDevices as any[]}
              value={replacementId}
              onChange={setReplacementId}
            />
          </div>
        )}

        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Btn variant="secondary" onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save Resolution'}</Btn>
        </div>
      </form>
    </Modal>
  )
}

// ── batch detail panel ────────────────────────────────────────────────────────

function BatchDetailPanel({ batch, customers }: { batch: ReturnBatch; customers: Customer[] }) {
  const qc = useQueryClient()
  const [resolvingItem, setResolvingItem] = useState<ReturnRMA | null>(null)

  const statusMut = useMutation({
    mutationFn: (status: string) => updateReturnBatchStatus(batch.id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['return-batches'] }),
    onError: (e: any) => toast.error(apiErr(e)),
  })

  const customer = customers.find(c => c.id === batch.customer_id)
  const totalRefund = batch.items.reduce((s, i) => s + parseFloat(i.refund_amount ?? '0'), 0)
  const resolved = batch.items.filter(i => i.resolution).length

  const printAcknowledgement = () => {
    const today = new Date().toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
    const rows = batch.items.map(it => `
      <tr>
        <td>${it.rma_number}</td>
        <td>${it.device?.inventory_number ?? '—'}</td>
        <td>${it.device?.imei ?? '—'}</td>
        <td>${it.device?.grade ?? '—'}</td>
        <td>${REASONS.find(r => r.value === it.reason_code)?.label ?? it.reason_code}</td>
        <td>${it.condition_on_return ?? '—'}</td>
        <td>${it.within_warranty ? 'Yes' : 'No'}</td>
      </tr>`).join('')
    const html = `<!DOCTYPE html><html><head><title>Return Acknowledgement ${batch.batch_number}</title>
    <style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;padding:20mm}h1{font-size:14pt;margin-bottom:4px}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #999;padding:6px 8px;font-size:10pt;text-align:left}
    th{background:#f0f0f0;font-weight:700}.meta{font-size:10pt;margin-bottom:3px}
    .hdr{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px}
    @media print{.no-print{display:none}}</style></head>
    <body>
    <div class="no-print" style="padding:8px;background:#1e293b;color:#fff;display:flex;gap:8px;margin-bottom:12px">
      <button onclick="window.print()" style="padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700">🖨 Print</button>
      <button onclick="window.close()" style="padding:6px 14px;background:#475569;color:#fff;border:none;border-radius:4px;cursor:pointer">Close</button>
    </div>
    <h1>Return Acknowledgement</h1>
    <div class="hdr">
      <div>
        <div class="meta"><strong>Batch #:</strong> ${batch.batch_number}</div>
        <div class="meta"><strong>Customer:</strong> ${customer?.name ?? '—'}</div>
        <div class="meta"><strong>Return Date:</strong> ${batch.date}</div>
        <div class="meta"><strong>Status:</strong> ${batch.status.replace(/_/g, ' ').toUpperCase()}</div>
      </div>
      <div>
        <div class="meta"><strong>Devices:</strong> ${batch.items.length}</div>
        <div class="meta"><strong>Printed:</strong> ${today}</div>
      </div>
    </div>
    <table><thead><tr><th>RMA #</th><th>Inv #</th><th>IMEI</th><th>Grade</th><th>Reason</th><th>Condition</th><th>Warranty</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${batch.notes ? `<p style="margin-top:10px;font-size:10pt"><strong>Notes:</strong> ${batch.notes}</p>` : ''}
    </body></html>`
    const w = window.open('', '_blank', 'width=900,height=700')
    if (w) { w.document.write(html); w.document.close() }
  }

  const printRefundReceipt = () => {
    const refundItems = batch.items.filter(i => i.refund_amount && parseFloat(i.refund_amount) > 0)
    if (!refundItems.length) { toast.error('No refunds on this batch'); return }
    const today = new Date().toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
    const rows = refundItems.map(it => `
      <tr>
        <td>${it.rma_number}</td>
        <td>${it.device?.inventory_number ?? it.device?.imei ?? '—'}</td>
        <td>${REASONS.find(r => r.value === it.reason_code)?.label ?? it.reason_code}</td>
        <td style="text-align:right">₦${parseFloat(it.refund_amount!).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
      </tr>`).join('')
    const html = `<!DOCTYPE html><html><head><title>Refund Receipt ${batch.batch_number}</title>
    <style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;padding:20mm}h1{font-size:14pt;margin-bottom:4px}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #999;padding:6px 8px;font-size:10pt}
    th{background:#f0f0f0;font-weight:700}.total{text-align:right;font-size:12pt;font-weight:700;margin-top:12px}
    @media print{.no-print{display:none}}</style></head>
    <body>
    <div class="no-print" style="padding:8px;background:#1e293b;color:#fff;display:flex;gap:8px;margin-bottom:12px">
      <button onclick="window.print()" style="padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700">🖨 Print</button>
      <button onclick="window.close()" style="padding:6px 14px;background:#475569;color:#fff;border:none;border-radius:4px;cursor:pointer">Close</button>
    </div>
    <h1>Refund Receipt</h1>
    <p style="font-size:10pt"><strong>Customer:</strong> ${customer?.name ?? '—'} &nbsp;|&nbsp; <strong>Date:</strong> ${today} &nbsp;|&nbsp; <strong>Ref:</strong> ${batch.batch_number}</p>
    <table><thead><tr><th>RMA #</th><th>Device</th><th>Reason</th><th style="text-align:right">Refund (₦)</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="total">Total Refunded: ₦${totalRefund.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div>
    </body></html>`
    const w = window.open('', '_blank', 'width=700,height=600')
    if (w) { w.document.write(html); w.document.close() }
  }

  const printSummary = () => {
    const today = new Date().toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
    const rows = batch.items.map(it => `
      <tr>
        <td>${it.rma_number}</td>
        <td>${it.device?.inventory_number ?? '—'}</td>
        <td>${it.device?.imei ?? '—'}</td>
        <td>${it.device?.grade ?? '—'}</td>
        <td>${REASONS.find(r => r.value === it.reason_code)?.label ?? it.reason_code}</td>
        <td>${it.condition_on_return ?? '—'}</td>
        <td>${it.within_warranty ? 'Yes' : 'No'}</td>
        <td>${it.resolution ? RESOLUTIONS.find(r => r.value === it.resolution)?.label ?? it.resolution : 'Pending'}</td>
        <td style="text-align:right">${it.refund_amount ? '₦' + parseFloat(it.refund_amount).toLocaleString('en-NG', { minimumFractionDigits: 2 }) : '—'}</td>
        <td>${it.restock_outcome ? RESTOCK_OUTCOMES.find(r => r.value === it.restock_outcome)?.label ?? it.restock_outcome : '—'}</td>
      </tr>`).join('')
    const html = `<!DOCTYPE html><html><head><title>Return Summary ${batch.batch_number}</title>
    <style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;padding:16mm;font-size:9pt}h1{font-size:13pt}
    table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #999;padding:4px 6px;font-size:8pt;text-align:left}
    th{background:#f0f0f0;font-weight:700}.stats{display:flex;gap:24px;margin:10px 0;font-size:10pt}
    @media print{.no-print{display:none}}</style></head>
    <body>
    <div class="no-print" style="padding:8px;background:#1e293b;color:#fff;display:flex;gap:8px;margin-bottom:10px">
      <button onclick="window.print()" style="padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700">🖨 Print</button>
      <button onclick="window.close()" style="padding:6px 14px;background:#475569;color:#fff;border:none;border-radius:4px;cursor:pointer">Close</button>
    </div>
    <h1>Return Summary — ${batch.batch_number}</h1>
    <p><strong>Customer:</strong> ${customer?.name ?? '—'} &nbsp;|&nbsp; <strong>Date:</strong> ${batch.date} &nbsp;|&nbsp; <strong>Status:</strong> ${batch.status.replace(/_/g, ' ').toUpperCase()} &nbsp;|&nbsp; <strong>Printed:</strong> ${today}</p>
    <div class="stats">
      <span><strong>Total Devices:</strong> ${batch.items.length}</span>
      <span><strong>Resolved:</strong> ${resolved}/${batch.items.length}</span>
      ${totalRefund > 0 ? `<span><strong>Total Refunded:</strong> ₦${totalRefund.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>` : ''}
    </div>
    <table><thead><tr><th>RMA #</th><th>Inv #</th><th>IMEI</th><th>Grade</th><th>Reason</th><th>Condition</th><th>Warranty</th><th>Resolution</th><th style="text-align:right">Refund</th><th>Routing</th></tr></thead>
    <tbody>${rows}</tbody></table>
    </body></html>`
    const w = window.open('', '_blank', 'width=1100,height=700')
    if (w) { w.document.write(html); w.document.close() }
  }

  return (
    <div style={{ padding: '12px 16px 20px', background: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13 }}>
          <div><strong>Customer:</strong> {customer?.name ?? '—'}</div>
          <div><strong>Date:</strong> {batch.date}</div>
          {batch.notes && <div style={{ color: '#64748b', marginTop: 2 }}><strong>Notes:</strong> {batch.notes}</div>}
          <div style={{ marginTop: 6 }}>
            <span style={{ marginRight: 12 }}>
              <strong>{resolved}/{batch.items.length}</strong> resolved
            </span>
            {totalRefund > 0 && <span>· Total refund: <strong>{fmt(totalRefund.toString())}</strong></span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={batch.status} onChange={e => statusMut.mutate(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12, fontWeight: 600 }}>
            {BATCH_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <Btn size="sm" variant="ghost" onClick={printAcknowledgement}>🖨 Acknowledgement</Btn>
          <Btn size="sm" variant="ghost" onClick={printSummary}>🖨 Summary</Btn>
          <Btn size="sm" variant="ghost" onClick={printRefundReceipt}>🖨 Refund Receipt</Btn>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f1f5f9' }}>
              {['RMA #', 'Inv #', 'IMEI', 'Grade', 'Reason', 'Condition', 'Warranty', 'Resolution', 'Refund', 'Routing', ''].map(h => (
                <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batch.items.map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{item.rma_number}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{item.device?.inventory_number ?? '—'}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{item.device?.imei ?? '—'}</td>
                <td style={{ padding: '6px 8px' }}><strong>{item.device?.grade ?? '—'}</strong></td>
                <td style={{ padding: '6px 8px', color: '#64748b', fontSize: 11 }}>{REASONS.find(r => r.value === item.reason_code)?.label ?? item.reason_code}</td>
                <td style={{ padding: '6px 8px', color: '#64748b', fontSize: 11 }}>{item.condition_on_return ?? '—'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                    background: item.within_warranty ? '#dcfce7' : '#fee2e2',
                    color: item.within_warranty ? '#166534' : '#991b1b' }}>
                    {item.within_warranty ? 'Yes' : 'No'}
                  </span>
                </td>
                <td style={{ padding: '6px 8px' }}>{resolutionLabel(item.resolution)}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>
                  {item.refund_amount ? fmt(item.refund_amount) : '—'}
                </td>
                <td style={{ padding: '6px 8px', color: '#64748b', fontSize: 11 }}>
                  {item.restock_outcome
                    ? RESTOCK_OUTCOMES.find(r => r.value === item.restock_outcome)?.label?.replace('→ ', '') ?? item.restock_outcome
                    : '—'}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  {!item.resolution && (
                    <Btn size="sm" onClick={() => setResolvingItem(item)}>Resolve</Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resolvingItem && (
        <ResolveItemModal item={resolvingItem} batch={batch} onClose={() => setResolvingItem(null)} />
      )}
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Returns() {
  const [showNew, setShowNew] = useState(false)
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null)

  const { data: batches = [], isLoading, isError, error, refetch } = useQuery<ReturnBatch[]>({
    queryKey: ['return-batches'],
    queryFn: () => getReturnBatches().then(r => r.data),
  })
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: () => getCustomers().then(r => r.data),
  })

  const customerMap = Object.fromEntries((customers as Customer[]).map(c => [c.id, c.name]))

  const handleNewSuccess = (batchId: string) => {
    setShowNew(false)
    setExpandedBatch(batchId)
  }

  return (
    <div style={{ padding: 28 }}>
      <PageHeader title="Returns / RMA" action={<Btn onClick={() => setShowNew(true)}>+ New Return</Btn>} />

      {isError && (
        <div style={{
          margin: '0 0 14px', padding: '10px 14px', background: '#fef2f2',
          border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        }}>
          <span>Could not load returns: {apiErr(error, 'server error')}</span>
          <Btn size="sm" variant="secondary" onClick={() => refetch()}>Retry</Btn>
        </div>
      )}

      <Card style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
              {['Batch #', 'Customer', 'Date', 'Devices', 'Resolved', 'Refund Total', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#374151' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(batches as ReturnBatch[]).map(batch => {
              const isExpanded = expandedBatch === batch.id
              const totalRefund = batch.items.reduce((s, i) => s + parseFloat(i.refund_amount ?? '0'), 0)
              const resolved = batch.items.filter(i => i.resolution).length
              return (
                <>
                  <tr key={batch.id} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                    onClick={() => setExpandedBatch(isExpanded ? null : batch.id)}>
                    <td style={{ padding: '10px 14px' }}>
                      <strong style={{ color: '#2563eb', fontFamily: 'monospace' }}>{batch.batch_number}</strong>
                    </td>
                    <td style={{ padding: '10px 14px' }}>{customerMap[batch.customer_id] ?? '—'}</td>
                    <td style={{ padding: '10px 14px', color: '#64748b' }}>{batch.date}</td>
                    <td style={{ padding: '10px 14px' }}><strong>{batch.items.length}</strong></td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ color: resolved === batch.items.length && batch.items.length > 0 ? '#16a34a' : '#d97706', fontWeight: 600 }}>
                        {resolved}/{batch.items.length}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 13 }}>
                      {totalRefund > 0 ? fmt(totalRefund.toString()) : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{statusBadge(batch.status)}</td>
                    <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                      <Btn size="sm" variant="secondary" onClick={() => setExpandedBatch(isExpanded ? null : batch.id)}>
                        {isExpanded ? '▲ Hide' : '▼ Details'}
                      </Btn>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${batch.id}-detail`}>
                      <td colSpan={8} style={{ padding: 0 }}>
                        <BatchDetailPanel batch={batch} customers={customers as Customer[]} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>

        {!isLoading && !isError && (batches as ReturnBatch[]).length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
            No returns yet. Click "+ New Return" to create one.
          </div>
        )}
      </Card>

      <NewBatchModal open={showNew} onClose={() => setShowNew(false)} onSuccess={handleNewSuccess} />
    </div>
  )
}
