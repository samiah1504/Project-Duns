import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getPurchaseOrders, getSuppliers, createPurchaseOrder, receivePurchaseOrder, getPhoneModels } from '../services/api'
import { PurchaseOrder, Supplier, PhoneModel } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select, statusBadge } from '../components/Layout'
import { fmt } from '../components/Layout'

export default function Intake() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')

  const { data: pos = [] } = useQuery({
    queryKey: ['purchase-orders', filterStatus],
    queryFn: () => {
      const p: Record<string, string> = {}
      if (filterStatus) p.status = filterStatus
      return getPurchaseOrders(p).then(r => r.data)
    },
  })

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => getSuppliers({ supplier_type: 'supplier' }).then(r => r.data),
  })

  const { data: models = [] } = useQuery({
    queryKey: ['phone-models'],
    queryFn: () => getPhoneModels().then(r => r.data),
  })

  const receiveMut = useMutation({
    mutationFn: (id: string) => receivePurchaseOrder(id, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); toast.success('PO received — devices created') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <div style={{ padding: 28 }}>
      <PageHeader
        title="Purchase Orders (Intake)"
        action={<Btn onClick={() => setShowNew(true)}>+ New PO</Btn>}
      />

      <Card style={{ marginBottom: 16 }}>
        <Select label="Filter Status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </Card>

      <Card>
        <Table headers={['PO Number', 'Supplier', 'Date', 'Items', 'Shipping', 'Status', 'Actions']}>
          {(pos as PurchaseOrder[]).map(po => (
            <TR key={po.id}>
              <TD><strong>{po.po_number}</strong></TD>
              <TD>{(suppliers as Supplier[]).find(s => s.id === po.supplier_id)?.name ?? '—'}</TD>
              <TD>{po.date}</TD>
              <TD>{po.line_items.length}</TD>
              <TD>{fmt(po.shipping_cost)}</TD>
              <TD>
                <span style={{
                  padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                  background: po.status === 'received' ? '#dcfce7' : po.status === 'open' ? '#dbeafe' : '#fee2e2',
                  color: po.status === 'received' ? '#166534' : po.status === 'open' ? '#1d4ed8' : '#991b1b',
                }}>
                  {po.status}
                </span>
              </TD>
              <TD>
                {po.status === 'open' && (
                  <Btn size="sm" onClick={() => {
                    if (confirm('Mark this PO as received? This will create all device records.'))
                      receiveMut.mutate(po.id)
                  }}>
                    Receive
                  </Btn>
                )}
              </TD>
            </TR>
          ))}
        </Table>
      </Card>

      <NewPOModal
        open={showNew}
        onClose={() => setShowNew(false)}
        suppliers={suppliers as Supplier[]}
        models={models as PhoneModel[]}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); setShowNew(false) }}
      />
    </div>
  )
}

function NewPOModal({ open, onClose, suppliers, models, onSuccess }: {
  open: boolean; onClose: () => void
  suppliers: Supplier[]; models: PhoneModel[]
  onSuccess: () => void
}) {
  const [supplierId, setSupplierId] = useState('')
  const [shippingCost, setShippingCost] = useState('0')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([{ imei: '', model_id: '', grade: 'C', unit_cost: '' }])

  const mut = useMutation({
    mutationFn: (data: unknown) => createPurchaseOrder(data),
    onSuccess: () => { toast.success('PO created'); onSuccess() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    mut.mutate({
      supplier_id: supplierId,
      shipping_cost: parseFloat(shippingCost) || 0,
      notes,
      line_items: lines.map(l => ({
        line_type: 'device',
        imei: l.imei,
        model_id: l.model_id,
        grade: l.grade,
        unit_cost: parseFloat(l.unit_cost) || 0,
      })),
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="New Purchase Order">
      <form onSubmit={submit}>
        <Select label="Supplier" value={supplierId} onChange={e => setSupplierId(e.target.value)} required>
          <option value="">Select supplier…</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Input label="Shipping Cost (₦)" type="number" value={shippingCost} onChange={e => setShippingCost(e.target.value)} />
        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Devices</div>
          {lines.map((line, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr auto', gap: 8, marginBottom: 8 }}>
              <input
                placeholder="IMEI"
                value={line.imei}
                onChange={e => { const l = [...lines]; l[i].imei = e.target.value; setLines(l) }}
                style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
                required
              />
              <select
                value={line.model_id}
                onChange={e => { const l = [...lines]; l[i].model_id = e.target.value; setLines(l) }}
                style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
                required
              >
                <option value="">Model…</option>
                {models.map(m => <option key={m.id} value={m.id}>{m.brand} {m.model_name} {m.storage}</option>)}
              </select>
              <select
                value={line.grade}
                onChange={e => { const l = [...lines]; l[i].grade = e.target.value; setLines(l) }}
                style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
              <input
                placeholder="Cost ₦"
                type="number"
                value={line.unit_cost}
                onChange={e => { const l = [...lines]; l[i].unit_cost = e.target.value; setLines(l) }}
                style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
                required
              />
              <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontWeight: 700 }}>
                ✕
              </button>
            </div>
          ))}
          <Btn size="sm" variant="ghost" type="button"
            onClick={() => setLines([...lines, { imei: '', model_id: '', grade: 'C', unit_cost: '' }])}>
            + Add Device
          </Btn>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Btn variant="secondary" onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" disabled={mut.isPending}>
            {mut.isPending ? 'Creating…' : 'Create PO'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
