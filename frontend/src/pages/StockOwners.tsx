import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { createStockOwner, updateStockOwner } from '../services/api'
import { StockOwner } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input } from '../components/Layout'
import { useStockOwners } from '../hooks/useStockOwners'

type ErrResp = { response?: { data?: { detail?: string } } }

function OwnerModal({ owner, onClose }: { owner: StockOwner | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(owner?.name ?? '')
  const [notes, setNotes] = useState(owner?.notes ?? '')
  const mut = useMutation({
    mutationFn: () => owner
      ? updateStockOwner(owner.id, { name, notes })
      : createStockOwner({ name, notes: notes || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-owners'] })
      toast.success(owner ? 'Owner updated' : 'Owner added')
      onClose()
    },
    onError: (e: ErrResp) => toast.error(e.response?.data?.detail ?? 'Error'),
  })
  return (
    <Modal open={true} title={owner ? `Edit ${owner.name}` : 'Add Investor'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Investor A" />
        <Input label="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => mut.mutate()} disabled={!name.trim() || mut.isPending}>
            {mut.isPending ? 'Saving…' : 'Save'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

export default function StockOwners() {
  const qc = useQueryClient()
  const { owners } = useStockOwners(true)
  const [modal, setModal] = useState<StockOwner | null | 'new'>(null)

  const toggle = useMutation({
    mutationFn: (o: StockOwner) => updateStockOwner(o.id, { active: !o.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-owners'] }),
    onError: (e: ErrResp) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <div>
      <PageHeader title="Stock Owners" action={<Btn onClick={() => setModal('new')}>+ Add Investor</Btn>} />
      <Card style={{ marginBottom: 12, padding: '10px 16px', background: '#eff6ff', borderColor: '#93c5fd' }}>
        <div style={{ fontSize: 13, color: '#1e40af', lineHeight: 1.5 }}>
          Every purchase order, phone and part belongs to one owner: <strong>House</strong> (the business) or an investor.
          Choose the owner when creating a purchase order; everything received on it belongs to that owner for good.
          Each owner's stock and accounts are in <strong>Reports → Stock Owners</strong>, alongside the overall total.
          House pays all expenses.
        </div>
      </Card>
      <Card>
        <Table headers={['Owner', 'Type', 'Status', 'Notes', 'Actions']}>
          {owners.map(o => (
            <TR key={o.id}>
              <TD style={{ fontWeight: 700 }}>{o.name}</TD>
              <TD>{o.is_house ? 'Business stock' : 'Investor'}</TD>
              <TD style={{ color: o.active ? '#166534' : '#94a3b8' }}>{o.active ? 'Active' : 'Inactive'}</TD>
              <TD style={{ color: '#64748b', fontSize: 12 }}>{o.notes ?? ''}</TD>
              <TD>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" variant="secondary" onClick={() => setModal(o)}>Edit</Btn>
                  {!o.is_house && (
                    <Btn size="sm" variant="ghost" onClick={() => toggle.mutate(o)} disabled={toggle.isPending}>
                      {o.active ? 'Deactivate' : 'Reactivate'}
                    </Btn>
                  )}
                </div>
              </TD>
            </TR>
          ))}
        </Table>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>
          Deactivating an investor hides them when creating new stock; their existing stock and history are kept.
        </div>
      </Card>
      {modal && <OwnerModal owner={modal === 'new' ? null : modal} onClose={() => setModal(null)} />}
    </div>
  )
}
