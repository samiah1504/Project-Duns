import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getParts, createPart, adjustPartStock } from '../services/api'
import { Part } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select, fmt } from '../components/Layout'

export default function Parts() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [adjustPart, setAdjustPart] = useState<Part | null>(null)
  const [delta, setDelta] = useState('')

  const [name, setName] = useState('')
  const [type, setType] = useState('screen')
  const [sku, setSku] = useState('')
  const [qty, setQty] = useState('0')
  const [cost, setCost] = useState('0')
  const [minStock, setMinStock] = useState('0')
  const [source, setSource] = useState('imported')

  const { data: parts = [] } = useQuery({
    queryKey: ['parts'],
    queryFn: () => getParts().then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (data: unknown) => createPart(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['parts'] }); setShowNew(false); toast.success('Part created') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const adjustMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: string }) => adjustPartStock(id, { delta: parseInt(d) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['parts'] }); setAdjustPart(null); toast.success('Stock adjusted') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <div style={{ padding: 28 }}>
      <PageHeader title="Parts Inventory" action={<Btn onClick={() => setShowNew(true)}>+ Add Part</Btn>} />
      <Card>
        <Table headers={['Name', 'Type', 'SKU', 'In Stock', 'Min Level', 'Unit Cost', 'Source', 'Actions']}>
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
                <TD>{fmt(p.unit_cost)}</TD>
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
                  <Btn size="sm" variant="secondary" onClick={() => { setAdjustPart(p); setDelta('') }}>
                    Adjust Stock
                  </Btn>
                </TD>
              </TR>
            )
          })}
        </Table>
      </Card>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Add Part">
        <form onSubmit={e => {
          e.preventDefault()
          createMut.mutate({ name, type, sku: sku || undefined, quantity_on_hand: parseInt(qty), unit_cost: parseFloat(cost), min_stock_level: parseInt(minStock), source })
        }}>
          <Input label="Name" value={name} onChange={e => setName(e.target.value)} required />
          <Select label="Type" value={type} onChange={e => setType(e.target.value)}>
            {['screen', 'battery', 'charging_port', 'flex', 'back_glass', 'other'].map(t => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </Select>
          <Input label="SKU" value={sku} onChange={e => setSku(e.target.value)} />
          <Input label="Quantity in Stock" type="number" value={qty} onChange={e => setQty(e.target.value)} />
          <Input label="Unit Cost (₦)" type="number" value={cost} onChange={e => setCost(e.target.value)} />
          <Input label="Min Stock Level" type="number" value={minStock} onChange={e => setMinStock(e.target.value)} />
          <Select label="Source" value={source} onChange={e => setSource(e.target.value)}>
            <option value="imported">Imported (has cost)</option>
            <option value="harvested">Harvested (near-zero cost)</option>
          </Select>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="secondary" onClick={() => setShowNew(false)} type="button">Cancel</Btn>
            <Btn type="submit" disabled={createMut.isPending}>{createMut.isPending ? 'Saving…' : 'Create Part'}</Btn>
          </div>
        </form>
      </Modal>

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
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setAdjustPart(null)}>Cancel</Btn>
          <Btn
            disabled={!delta || adjustMut.isPending}
            onClick={() => adjustPart && adjustMut.mutate({ id: adjustPart.id, d: delta })}
          >
            Adjust
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
