import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getParts, createPart, updatePart, adjustPartStock } from '../services/api'
import { Part } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select, fmt } from '../components/Layout'
import { useAuth } from '../hooks/useAuth'

const PART_TYPES = ['screen', 'battery', 'charging_port', 'flex', 'back_glass', 'other']

function apiErr(e: any, fallback = 'Error'): string {
  const d = e?.response?.data?.detail
  if (typeof d === 'string') return d
  return fallback
}

export default function Parts() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const canSeeCost = ['ADMIN', 'OPERATIONS'].includes(user?.role ?? '')
  const canManage = ['ADMIN', 'OPERATIONS', 'INVENTORY'].includes(user?.role ?? '')

  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<Part | null>(null)
  const [adjustPart, setAdjustPart] = useState<Part | null>(null)
  const [delta, setDelta] = useState('')
  const [adjustReason, setAdjustReason] = useState('')

  const [name, setName] = useState('')
  const [type, setType] = useState('screen')
  const [sku, setSku] = useState('')
  const [qty, setQty] = useState('0')
  const [cost, setCost] = useState('0')
  const [sellPrice, setSellPrice] = useState('')
  const [minStock, setMinStock] = useState('0')
  const [source, setSource] = useState('imported')

  const { data: parts = [] } = useQuery({
    queryKey: ['parts'],
    queryFn: () => getParts().then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (data: unknown) => createPart(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['parts'] }); setShowNew(false); toast.success('Part created') },
    onError: (e: any) => toast.error(apiErr(e)),
  })

  const editMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => updatePart(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['parts'] }); setEditing(null); toast.success('Part updated') },
    onError: (e: any) => toast.error(apiErr(e)),
  })

  const adjustMut = useMutation({
    mutationFn: ({ id, d, notes }: { id: string; d: string; notes?: string }) =>
      adjustPartStock(id, { delta: parseInt(d), notes: notes || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['parts'] }); setAdjustPart(null); toast.success('Stock adjusted') },
    onError: (e: any) => toast.error(apiErr(e)),
  })

  // Stock valuation: quantity × COST price — only meaningful for cost-visible roles
  const totalStockValue = canSeeCost
    ? (parts as Part[]).reduce((s, p) => s + p.quantity_on_hand * parseFloat(p.unit_cost ?? '0'), 0)
    : 0
  const totalUnits = (parts as Part[]).reduce((s, p) => s + p.quantity_on_hand, 0)
  const lowCount = (parts as Part[]).filter(p => p.quantity_on_hand <= p.min_stock_level).length

  return (
    <div style={{ padding: 28 }}>
      <PageHeader
        title="Parts & Accessories"
        action={canManage ? <Btn onClick={() => setShowNew(true)}>+ Add Part / Accessory</Btn> : undefined}
      />

      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <SummaryBox label="Items" value={String((parts as Part[]).length)} />
        <SummaryBox label="Units in Stock" value={String(totalUnits)} />
        {canSeeCost && (
          <SummaryBox label="Stock Value (cost)" value={fmt(String(totalStockValue))} color="#1d4ed8" />
        )}
        <SummaryBox label="Low Stock" value={String(lowCount)} color={lowCount > 0 ? '#dc2626' : '#16a34a'} />
      </div>

      <Card>
        <Table headers={[
          'Name', 'Type', 'SKU', 'In Stock', 'Min Level', 'Selling Price',
          ...(canSeeCost ? ['Unit Cost', 'Stock Value'] : []),
          'Source', 'Actions',
        ]}>
          {(parts as Part[]).map(p => {
            const low = p.quantity_on_hand <= p.min_stock_level
            return (
              <TR key={p.id}>
                <TD>
                  <strong>{p.name}</strong>
                  {low && <span style={{ marginLeft: 8, fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>LOW</span>}
                </TD>
                <TD style={{ textTransform: 'capitalize', color: '#64748b' }}>{p.type.replace(/_/g, ' ')}</TD>
                <TD style={{ color: '#94a3b8', fontSize: 12 }}>{p.sku ?? '—'}</TD>
                <TD style={{ fontWeight: 700, color: low ? '#ef4444' : '#22c55e' }}>{p.quantity_on_hand}</TD>
                <TD style={{ color: '#94a3b8' }}>{p.min_stock_level}</TD>
                <TD style={{ color: '#1d4ed8', fontWeight: 600 }}>
                  {p.selling_price ? fmt(p.selling_price) : <span style={{ color: '#d97706', fontSize: 11, fontWeight: 600 }}>Not set</span>}
                </TD>
                {canSeeCost && (
                  <>
                    <TD>{p.unit_cost != null ? fmt(p.unit_cost) : '—'}</TD>
                    <TD style={{ color: '#64748b' }}>
                      {p.unit_cost != null ? fmt(String(p.quantity_on_hand * parseFloat(p.unit_cost))) : '—'}
                    </TD>
                  </>
                )}
                <TD>
                  <span style={{
                    fontSize: 11, padding: '2px 6px', borderRadius: 3,
                    background: p.source === 'imported' ? '#dbeafe' : '#f0fdf4',
                    color: p.source === 'imported' ? '#1d4ed8' : '#166534',
                    fontWeight: 600,
                  }}>
                    {p.source}
                  </span>
                </TD>
                <TD>
                  {canManage ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Btn>
                      <Btn size="sm" variant="secondary" onClick={() => { setAdjustPart(p); setDelta(''); setAdjustReason('') }}>
                        Adjust Stock
                      </Btn>
                    </div>
                  ) : '—'}
                </TD>
              </TR>
            )
          })}
        </Table>
      </Card>

      {/* Add modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="Add Part / Accessory">
        <form onSubmit={e => {
          e.preventDefault()
          createMut.mutate({
            name, type,
            sku: sku || undefined,
            quantity_on_hand: parseInt(qty) || 0,
            unit_cost: parseFloat(cost) || 0,
            selling_price: sellPrice ? parseFloat(sellPrice) : undefined,
            min_stock_level: parseInt(minStock) || 0,
            source,
          })
        }}>
          <Input label="Name" value={name} onChange={e => setName(e.target.value)} required />
          <Select label="Type" value={type} onChange={e => setType(e.target.value)}>
            {PART_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </Select>
          <Input label="SKU" value={sku} onChange={e => setSku(e.target.value)} />
          <Input label="Quantity in Stock" type="number" value={qty} onChange={e => setQty(e.target.value)} />
          <Input label="Unit Cost (₦)" type="number" value={cost} onChange={e => setCost(e.target.value)} />
          <Input label="Selling Price (₦) — for customer sales" type="number" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="Leave empty if not sold to customers" />
          <Input label="Min Stock Level" type="number" value={minStock} onChange={e => setMinStock(e.target.value)} />
          <Select label="Source" value={source} onChange={e => setSource(e.target.value)}>
            <option value="imported">Imported (has cost)</option>
            <option value="harvested">Harvested (near-zero cost)</option>
          </Select>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="secondary" onClick={() => setShowNew(false)} type="button">Cancel</Btn>
            <Btn type="submit" disabled={createMut.isPending}>{createMut.isPending ? 'Saving…' : 'Create'}</Btn>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      {editing && (
        <EditPartModal
          part={editing}
          canSeeCost={canSeeCost}
          onClose={() => setEditing(null)}
          onSave={(data) => editMut.mutate({ id: editing.id, data })}
          saving={editMut.isPending}
        />
      )}

      {/* Adjust stock modal */}
      <Modal open={!!adjustPart} onClose={() => setAdjustPart(null)} title={`Adjust Stock: ${adjustPart?.name}`}>
        <div style={{ color: '#64748b', marginBottom: 16, fontSize: 14 }}>
          Current stock: <strong>{adjustPart?.quantity_on_hand}</strong>
        </div>
        <Input
          label="Adjustment (use negative to reduce)"
          type="number"
          value={delta}
          onChange={e => setDelta(e.target.value)}
          placeholder="e.g. +10 or -5"
        />
        <Input
          label="Reason"
          value={adjustReason}
          onChange={e => setAdjustReason(e.target.value)}
          placeholder="e.g. stock count correction, damaged unit"
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setAdjustPart(null)}>Cancel</Btn>
          <Btn
            disabled={!delta || adjustMut.isPending}
            onClick={() => adjustPart && adjustMut.mutate({ id: adjustPart.id, d: delta, notes: adjustReason })}
          >
            Adjust
          </Btn>
        </div>
      </Modal>
    </div>
  )
}

function SummaryBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 18px', minWidth: 120 }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color ?? '#0f172a' }}>{value}</div>
    </div>
  )
}

function EditPartModal({ part, canSeeCost, onClose, onSave, saving }: {
  part: Part
  canSeeCost: boolean
  onClose: () => void
  onSave: (data: Record<string, unknown>) => void
  saving: boolean
}) {
  const [name, setName] = useState(part.name)
  const [type, setType] = useState(part.type)
  const [sku, setSku] = useState(part.sku ?? '')
  const [cost, setCost] = useState(part.unit_cost != null ? String(parseFloat(part.unit_cost)) : '')
  const [sellPrice, setSellPrice] = useState(part.selling_price ? String(parseFloat(part.selling_price)) : '')
  const [minStock, setMinStock] = useState(String(part.min_stock_level))
  const [source, setSource] = useState(part.source)
  const [notes, setNotes] = useState(part.notes ?? '')

  return (
    <Modal open onClose={onClose} title={`Edit — ${part.name}`}>
      <form onSubmit={e => {
        e.preventDefault()
        onSave({
          name,
          type,
          sku: sku || undefined,
          unit_cost: canSeeCost && cost !== '' ? parseFloat(cost) : undefined,
          selling_price: sellPrice !== '' ? parseFloat(sellPrice) : undefined,
          min_stock_level: parseInt(minStock) || 0,
          source,
          notes: notes || undefined,
        })
      }}>
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} required />
        <Select label="Type" value={type} onChange={e => setType(e.target.value)}>
          {PART_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </Select>
        <Input label="SKU" value={sku} onChange={e => setSku(e.target.value)} />
        {canSeeCost && (
          <Input label="Unit Cost (₦)" type="number" value={cost} onChange={e => setCost(e.target.value)} />
        )}
        <Input label="Selling Price (₦)" type="number" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="Customer price" />
        <Input label="Min Stock Level" type="number" value={minStock} onChange={e => setMinStock(e.target.value)} />
        <Select label="Source" value={source} onChange={e => setSource(e.target.value as 'imported' | 'harvested')}>
          <option value="imported">Imported</option>
          <option value="harvested">Harvested</option>
        </Select>
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Btn>
        </div>
      </form>
    </Modal>
  )
}
