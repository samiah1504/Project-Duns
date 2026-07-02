import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getReturns, createReturn, resolveReturn, getDevices, getCustomers, getSales } from '../services/api'
import { ReturnRMA, Customer, Device } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select } from '../components/Layout'

export default function Returns() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [resolving, setResolving] = useState<ReturnRMA | null>(null)

  const [deviceId, setDeviceId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [saleId, setSaleId] = useState('')
  const [reason, setReason] = useState('DOA')
  const [condition, setCondition] = useState('')
  const [inWarranty, setInWarranty] = useState(false)

  const [resolution, setResolution] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [restockOutcome, setRestockOutcome] = useState('')

  const { data: returns_ = [] } = useQuery({ queryKey: ['returns'], queryFn: () => getReturns().then(r => r.data) })
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => getCustomers().then(r => r.data) })
  const { data: soldDevices = [] } = useQuery({ queryKey: ['sold-devices'], queryFn: () => getDevices({ status: 'SOLD' }).then(r => r.data) })
  const { data: sales = [] } = useQuery({ queryKey: ['sales'], queryFn: () => getSales().then(r => r.data) })

  const createMut = useMutation({
    mutationFn: (data: unknown) => createReturn(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['returns'] }); setShowNew(false); toast.success('Return created') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const resolveMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => resolveReturn(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['returns'] }); setResolving(null); toast.success('Return resolved') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const customerMap = Object.fromEntries((customers as Customer[]).map(c => [c.id, c.name]))

  return (
    <div style={{ padding: 28 }}>
      <PageHeader title="Returns / RMA" action={<Btn onClick={() => setShowNew(true)}>+ New Return</Btn>} />
      <Card>
        <Table headers={['RMA #', 'Customer', 'Reason', 'Warranty', 'Resolution', 'Date', 'Actions']}>
          {(returns_ as ReturnRMA[]).map(r => (
            <TR key={r.id}>
              <TD><strong>{r.rma_number}</strong></TD>
              <TD>{customerMap[r.customer_id] ?? '—'}</TD>
              <TD style={{ color: '#64748b' }}>{r.reason_code.replace(/_/g, ' ')}</TD>
              <TD>
                <span style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 3, fontWeight: 600,
                  background: r.within_warranty ? '#dcfce7' : '#fee2e2',
                  color: r.within_warranty ? '#166534' : '#991b1b',
                }}>
                  {r.within_warranty ? 'In Warranty' : 'Out of Warranty'}
                </span>
              </TD>
              <TD>{r.resolution ? <span style={{ color: '#22c55e', fontWeight: 600 }}>{r.resolution}</span> : '—'}</TD>
              <TD style={{ color: '#64748b' }}>{r.date}</TD>
              <TD>
                {!r.resolution && (
                  <Btn size="sm" onClick={() => { setResolving(r); setResolution(''); setRefundAmount(''); setRestockOutcome('') }}>
                    Resolve
                  </Btn>
                )}
              </TD>
            </TR>
          ))}
        </Table>
      </Card>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="New Return">
        <form onSubmit={e => {
          e.preventDefault()
          createMut.mutate({ device_id: deviceId, customer_id: customerId, original_sale_id: saleId || undefined, reason_code: reason, condition_on_return: condition, within_warranty: inWarranty })
        }}>
          <Select label="Returned Device (SOLD)" value={deviceId} onChange={e => setDeviceId(e.target.value)} required>
            <option value="">Select device…</option>
            {(soldDevices as Device[]).map(d => <option key={d.id} value={d.id}>{d.imei}</option>)}
          </Select>
          <Select label="Customer" value={customerId} onChange={e => setCustomerId(e.target.value)} required>
            <option value="">Select customer…</option>
            {(customers as Customer[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select label="Reason" value={reason} onChange={e => setReason(e.target.value)}>
            {['DOA', 'fault_developed', 'wrong_item', 'not_as_described', 'buyer_remorse', 'warranty_claim'].map(r => (
              <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
            ))}
          </Select>
          <Input label="Condition on Return" value={condition} onChange={e => setCondition(e.target.value)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 14 }}>
            <input type="checkbox" checked={inWarranty} onChange={e => setInWarranty(e.target.checked)} />
            Within warranty period
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="secondary" onClick={() => setShowNew(false)} type="button">Cancel</Btn>
            <Btn type="submit" disabled={createMut.isPending}>{createMut.isPending ? 'Creating…' : 'Create Return'}</Btn>
          </div>
        </form>
      </Modal>

      <Modal open={!!resolving} onClose={() => setResolving(null)} title={`Resolve ${resolving?.rma_number}`}>
        <Select label="Resolution" value={resolution} onChange={e => setResolution(e.target.value)} required>
          <option value="">Select resolution…</option>
          <option value="refund">Refund</option>
          <option value="replace">Replace</option>
          <option value="repair_and_return">Repair & Return to Customer</option>
          <option value="restock">Restock</option>
        </Select>
        {(resolution === 'refund' || resolution === 'replace') && (
          <Input label="Refund Amount (₦)" type="number" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} />
        )}
        {(resolution === 'restock' || resolution === 'replace' || resolution === 'refund') && (
          <Select label="Device Routing" value={restockOutcome} onChange={e => setRestockOutcome(e.target.value)} required>
            <option value="">Where does device go?</option>
            <option value="sellable">Back to Sellable Stock</option>
            <option value="refurb">Send to Refurb</option>
            <option value="scrapped">Scrap</option>
          </Select>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="secondary" onClick={() => setResolving(null)}>Cancel</Btn>
          <Btn
            disabled={!resolution || resolveMut.isPending}
            onClick={() => resolving && resolveMut.mutate({
              id: resolving.id,
              data: {
                resolution,
                refund_amount: refundAmount ? parseFloat(refundAmount) : undefined,
                restock_outcome: restockOutcome || undefined,
              },
            })}
          >
            {resolveMut.isPending ? 'Resolving…' : 'Resolve'}
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
