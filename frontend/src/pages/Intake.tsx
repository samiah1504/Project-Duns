import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSuppliers, createSimplePO } from '../services/api'
import { Supplier } from '../types'
import { PageHeader } from '../components/Layout'

// ─── Constants ──────────────────────────────────────────────────────────────────

const RAM_OPTIONS = ['4GB', '6GB', '8GB', '12GB', '16GB', '18GB', '24GB', 'Other']
const ROM_OPTIONS = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB', 'Other']
const GRADES = ['A', 'B', 'C']
const CONDITIONS = [
  { value: 'awaiting_refurb', label: 'Awaiting Refurb' },
  { value: 'sellable', label: 'Sellable (Ready to Sell)' },
  { value: 'scrapped', label: 'Parts / Harvest' },
]

// ─── Styles ──────────────────────────────────────────────────────────────────────

const field: React.CSSProperties = {
  width: '100%', padding: '11px 14px', border: '1px solid #d1d5db',
  borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff',
  boxSizing: 'border-box',
}

const lbl: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 700, color: '#475569',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px',
}

function F({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label style={lbl}>{label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}</label>
      {children}
    </div>
  )
}

// ─── Device row state ────────────────────────────────────────────────────────────

interface DeviceRow {
  id: number
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
  selling_price: string
}

let _nextId = 1
const emptyRow = (): DeviceRow => ({
  id: _nextId++,
  brand: '', model_name_str: '',
  ram_str: '', ram_custom: '', storage_str: '', rom_custom: '',
  colour_str: '', grade: 'C', initial_status: 'awaiting_refurb',
  imei: '', selling_price: '',
})

function validateImei(v: string) {
  const d = v.replace(/\D/g, '')
  if (!d) return 'Required'
  if (d.length !== 15) return 'Must be 15 digits'
  return ''
}

// ─── Main Page ───────────────────────────────────────────────────────────────────

export default function Intake() {
  const qc = useQueryClient()
  const [supplierId, setSupplierId] = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<DeviceRow[]>([emptyRow()])

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => getSuppliers().then(r => r.data),
  })

  const mut = useMutation({
    mutationFn: (data: unknown) => createSimplePO(data),
    onSuccess: (res) => {
      const po = res.data
      toast.success(`${po.po_number} created — ${po.total_received} device(s) added to inventory`)
      qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      qc.invalidateQueries({ queryKey: ['devices'] })
      setSupplierId('')
      setShippingCost('')
      setNotes('')
      setRows([emptyRow()])
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Failed to create purchase order'),
  })

  const updateRow = (id: number, patch: Partial<DeviceRow>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))

  const removeRow = (id: number) => setRows(prev => prev.filter(r => r.id !== id))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!supplierId) { toast.error('Please select a supplier'); return }

    for (const row of rows) {
      if (!row.brand.trim()) { toast.error('Brand is required for all items'); return }
      if (!row.model_name_str.trim()) { toast.error('Model name is required for all items'); return }
      const imeiErr = validateImei(row.imei)
      if (imeiErr) { toast.error(`IMEI: ${imeiErr}`); return }
      if (!row.selling_price || parseFloat(row.selling_price) <= 0) {
        toast.error('Selling price is required for all items'); return
      }
    }

    mut.mutate({
      supplier_id: supplierId,
      shipping_cost: parseFloat(shippingCost) || 0,
      notes: notes || undefined,
      items: rows.map(r => ({
        brand: r.brand.trim(),
        model_name_str: r.model_name_str.trim(),
        ram_str: (r.ram_str === 'Other' ? r.ram_custom : r.ram_str).trim() || undefined,
        storage_str: (r.storage_str === 'Other' ? r.rom_custom : r.storage_str).trim() || undefined,
        colour_str: r.colour_str.trim() || undefined,
        grade: r.grade,
        initial_status: r.initial_status,
        imei: r.imei.replace(/\D/g, ''),
        selling_price: parseFloat(r.selling_price) || undefined,
      })),
    })
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader title="Purchase Intake" />

        <div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 32 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#1e293b', marginBottom: 24 }}>New Purchase</div>

            <form onSubmit={handleSubmit}>
              {/* PO-level fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
                <F label="Supplier" required>
                  <select
                    value={supplierId}
                    onChange={e => setSupplierId(e.target.value)}
                    required
                    style={field}
                  >
                    <option value="">Select supplier…</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </F>
                <F label="Shipping Cost (₦)">
                  <input
                    type="number"
                    value={shippingCost}
                    onChange={e => setShippingCost(e.target.value)}
                    style={field}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </F>
                <div style={{ gridColumn: '1 / -1' }}>
                  <F label="Notes">
                    <input
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      style={field}
                      placeholder="Optional notes about this purchase…"
                    />
                  </F>
                </div>
              </div>

              {/* Divider */}
              <div style={{ borderTop: '2px solid #f1f5f9', marginBottom: 24 }} />

              {/* Device rows */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Devices</div>
                <div style={{ fontSize: 13, color: '#64748b' }}>
                  Fill in each device and its IMEI. All will be added to inventory immediately.
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {rows.map((row, idx) => {
                  const imeiErr = row.imei ? validateImei(row.imei) : ''
                  const imeiOk = !imeiErr && row.imei.replace(/\D/g, '').length === 15
                  return (
                    <div key={row.id} style={{
                      border: '1px solid #e2e8f0', borderRadius: 12, padding: '24px 24px 20px',
                      background: '#f8fafc', position: 'relative',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Device {idx + 1}
                        </div>
                        {rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            style={{
                              background: '#fee2e2', border: '1px solid #fca5a5',
                              borderRadius: 6, color: '#dc2626', cursor: 'pointer',
                              padding: '4px 12px', fontWeight: 700, fontSize: 12,
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      {/* Row 1: Brand, Model */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                        <F label="Brand" required>
                          <input
                            value={row.brand}
                            onChange={e => updateRow(row.id, { brand: e.target.value })}
                            style={field}
                            placeholder="Samsung"
                          />
                        </F>
                        <F label="Model Name" required>
                          <input
                            value={row.model_name_str}
                            onChange={e => updateRow(row.id, { model_name_str: e.target.value })}
                            style={field}
                            placeholder="Galaxy S21"
                          />
                        </F>
                      </div>

                      {/* Row 2: RAM, ROM, Colour */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                        <F label="RAM">
                          <select
                            value={row.ram_str}
                            onChange={e => updateRow(row.id, { ram_str: e.target.value })}
                            style={field}
                          >
                            <option value="">— Select —</option>
                            {RAM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          {row.ram_str === 'Other' && (
                            <input
                              value={row.ram_custom}
                              onChange={e => updateRow(row.id, { ram_custom: e.target.value })}
                              style={{ ...field, marginTop: 8 }}
                              placeholder="e.g. 3GB"
                            />
                          )}
                        </F>
                        <F label="ROM / Storage">
                          <select
                            value={row.storage_str}
                            onChange={e => updateRow(row.id, { storage_str: e.target.value })}
                            style={field}
                          >
                            <option value="">— Select —</option>
                            {ROM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          {row.storage_str === 'Other' && (
                            <input
                              value={row.rom_custom}
                              onChange={e => updateRow(row.id, { rom_custom: e.target.value })}
                              style={{ ...field, marginTop: 8 }}
                              placeholder="e.g. 4TB"
                            />
                          )}
                        </F>
                        <F label="Colour">
                          <input
                            value={row.colour_str}
                            onChange={e => updateRow(row.id, { colour_str: e.target.value })}
                            style={field}
                            placeholder="Black"
                          />
                        </F>
                      </div>

                      {/* Row 3: Grade, Condition */}
                      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 16, marginBottom: 16 }}>
                        <F label="Grade">
                          <select
                            value={row.grade}
                            onChange={e => updateRow(row.id, { grade: e.target.value })}
                            style={field}
                          >
                            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </F>
                        <F label="Condition">
                          <select
                            value={row.initial_status}
                            onChange={e => updateRow(row.id, { initial_status: e.target.value })}
                            style={{
                              ...field,
                              color: row.initial_status === 'sellable' ? '#16a34a'
                                : row.initial_status === 'scrapped' ? '#dc2626' : '#d97706',
                              fontWeight: 600,
                            }}
                          >
                            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                        </F>
                      </div>

                      {/* Row 4: IMEI, Selling Price */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <F label="IMEI" required>
                          <input
                            value={row.imei}
                            onChange={e => updateRow(row.id, { imei: e.target.value })}
                            style={{
                              ...field,
                              fontFamily: 'monospace',
                              fontSize: 15,
                              letterSpacing: '0.5px',
                              borderColor: row.imei && imeiErr ? '#ef4444' : imeiOk ? '#16a34a' : '#d1d5db',
                            }}
                            placeholder="353123456789012"
                            inputMode="numeric"
                            maxLength={15}
                          />
                          {row.imei && imeiErr && (
                            <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{imeiErr}</div>
                          )}
                          {imeiOk && (
                            <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>✓ Valid IMEI</div>
                          )}
                        </F>
                        <F label="Selling Price (₦)" required>
                          <input
                            type="number"
                            value={row.selling_price}
                            onChange={e => updateRow(row.id, { selling_price: e.target.value })}
                            style={{
                              ...field,
                              borderColor: !row.selling_price ? '#f59e0b' : '#d1d5db',
                            }}
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                          />
                        </F>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Add device button */}
              <button
                type="button"
                onClick={() => setRows(prev => [...prev, emptyRow()])}
                style={{
                  marginTop: 16, width: '100%', padding: '12px',
                  background: '#f8fafc', border: '2px dashed #cbd5e1',
                  borderRadius: 10, color: '#475569', fontWeight: 600,
                  fontSize: 14, cursor: 'pointer',
                }}
              >
                + Add Another Device
              </button>

              {/* Submit */}
              <div style={{ marginTop: 28 }}>
                <button
                  type="submit"
                  disabled={mut.isPending}
                  style={{
                    width: '100%', padding: '15px',
                    background: mut.isPending ? '#94a3b8' : '#2563eb',
                    color: '#fff', border: 'none', borderRadius: 10,
                    fontWeight: 700, fontSize: 16,
                    cursor: mut.isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {mut.isPending
                    ? 'Adding to Inventory…'
                    : `Add ${rows.length} Device${rows.length !== 1 ? 's' : ''} to Inventory`}
                </button>
                <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 8 }}>
                  Devices are added to inventory immediately.
                </div>
              </div>
            </form>
          </div>
        </div>
    </div>
  )
}
