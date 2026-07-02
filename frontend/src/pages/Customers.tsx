import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getCustomers, createCustomer } from '../services/api'
import { Customer } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select, fmt } from '../components/Layout'

export default function Customers() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('wholesale')
  const [phone, setPhone] = useState('')
  const [credit, setCredit] = useState('0')

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => getCustomers().then(r => r.data),
  })

  const mut = useMutation({
    mutationFn: (data: unknown) => createCustomer(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); setShowNew(false); toast.success('Customer added') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <div style={{ padding: 28 }}>
      <PageHeader
        title="Customers"
        action={<Btn onClick={() => setShowNew(true)}>+ Add Customer</Btn>}
      />
      <Card>
        <Table headers={['Name', 'Type', 'Phone', 'Credit Limit', 'Balance', 'Available Credit']}>
          {(customers as Customer[]).map(c => {
            const avail = parseFloat(c.credit_limit) - parseFloat(c.current_balance)
            return (
              <TR key={c.id}>
                <TD><strong>{c.name}</strong></TD>
                <TD style={{ textTransform: 'capitalize' }}>{c.type}</TD>
                <TD style={{ color: '#64748b' }}>{c.contact?.phone ?? '—'}</TD>
                <TD>{fmt(c.credit_limit)}</TD>
                <TD style={{ color: parseFloat(c.current_balance) > 0 ? '#ef4444' : '#22c55e' }}>{fmt(c.current_balance)}</TD>
                <TD style={{ color: avail < 0 ? '#ef4444' : '#22c55e' }}>{fmt(avail)}</TD>
              </TR>
            )
          })}
        </Table>
      </Card>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Add Customer">
        <form onSubmit={e => { e.preventDefault(); mut.mutate({ name, type, contact: { phone }, credit_limit: parseFloat(credit) || 0 }) }}>
          <Input label="Name" value={name} onChange={e => setName(e.target.value)} required />
          <Select label="Type" value={type} onChange={e => setType(e.target.value)}>
            <option value="wholesale">Wholesale</option>
            <option value="retail">Retail</option>
          </Select>
          <Input label="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
          <Input label="Credit Limit (₦)" type="number" value={credit} onChange={e => setCredit(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="secondary" onClick={() => setShowNew(false)} type="button">Cancel</Btn>
            <Btn type="submit" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Add Customer'}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  )
}
