import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSales, createSale, addPayment, getCustomers, getSellableDevices } from '../services/api'
import { Sale, Customer, Device } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select, fmt } from '../components/Layout'

const paymentColor = (s: string) => {
  if (s === 'paid') return '#22c55e'
  if (s === 'partial') return '#f59e0b'
  return '#ef4444'
}

export default function Sales() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [paymentSale, setPaymentSale] = useState<Sale | null>(null)
  const [payAmount, setPayAmount] = useState('')

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => getSales().then(r => r.data),
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => getCustomers().then(r => r.data),
  })

  const { data: sellable = [] } = useQuery({
    queryKey: ['sellable-devices'],
    queryFn: () => getSellableDevices().then(r => r.data),
  })

  const payMut = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: string }) => addPayment(id, { amount: parseFloat(amount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales'] }); setPaymentSale(null); toast.success('Payment recorded') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const customerMap = Object.fromEntries((customers as Customer[]).map(c => [c.id, c]))

  return (
    <div style={{ padding: 28 }}>
      <PageHeader
        title="Sales & Invoices"
        action={<Btn onClick={() => setShowNew(true)}>+ New Sale</Btn>}
      />

      <Card>
        <Table headers={['Invoice', 'Customer', 'Type', 'Total', 'Paid', 'Balance', 'Status', 'Date', 'Actions']}>
          {(sales as Sale[]).map(sale => {
            const cust = customerMap[sale.customer_id]
            return (
              <TR key={sale.id}>
                <TD><strong>{sale.invoice_number}</strong></TD>
                <TD>{cust?.name ?? '—'}</TD>
                <TD style={{ textTransform: 'capitalize' }}>{sale.type}</TD>
                <TD>{fmt(sale.total)}</TD>
                <TD style={{ color: '#22c55e' }}>{fmt(sale.amount_paid)}</TD>
                <TD style={{ color: parseFloat(sale.balance) > 0 ? '#ef4444' : '#22c55e' }}>{fmt(sale.balance)}</TD>
                <TD>
                  <span style={{
                    background: paymentColor(sale.payment_status) + '22',
                    color: paymentColor(sale.payment_status),
                    border: `1px solid ${paymentColor(sale.payment_status)}55`,
                    padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                  }}>
                    {sale.payment_status}
                  </span>
                </TD>
                <TD style={{ color: '#64748b' }}>{sale.date}</TD>
                <TD>
                  {sale.payment_status !== 'paid' && (
                    <Btn size="sm" onClick={() => { setPaymentSale(sale); setPayAmount('') }}>+ Payment</Btn>
                  )}
                </TD>
              </TR>
            )
          })}
        </Table>
      </Card>

      <NewSaleModal
        open={showNew}
        onClose={() => setShowNew(false)}
        customers={customers as Customer[]}
        sellable={sellable as Device[]}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['sellable-devices'] }); setShowNew(false) }}
      />

      <Modal open={!!paymentSale} onClose={() => setPaymentSale(null)} title={`Add Payment — ${paymentSale?.invoice_number}`}>
        <div style={{ marginBottom: 16, color: '#64748b', fontSize: 14 }}>
          Balance outstanding: {paymentSale ? fmt(paymentSale.balance) : '—'}
        </div>
        <Input label="Amount (₦)" type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setPaymentSale(null)}>Cancel</Btn>
          <Btn
            disabled={!payAmount || payMut.isPending}
            onClick={() => paymentSale && payMut.mutate({ id: paymentSale.id, amount: payAmount })}
          >
            Record Payment
          </Btn>
        </div>
      </Modal>
    </div>
  )
}

function NewSaleModal({ open, onClose, customers, sellable, onSuccess }: {
  open: boolean; onClose: () => void
  customers: Customer[]; sellable: Device[]
  onSuccess: () => void
}) {
  const [customerId, setCustomerId] = useState('')
  const [saleType, setSaleType] = useState('wholesale')
  const [tax, setTax] = useState('0')
  const [selectedDevices, setSelectedDevices] = useState<{ device: Device; price: string }[]>([])
  const [amountPaid, setAmountPaid] = useState('')

  const mut = useMutation({
    mutationFn: (data: unknown) => createSale(data),
    onSuccess: () => { toast.success('Sale created'); onSuccess() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const addDevice = (deviceId: string) => {
    const d = sellable.find(d => d.id === deviceId)
    if (d && !selectedDevices.find(s => s.device.id === deviceId)) {
      setSelectedDevices([...selectedDevices, { device: d, price: '' }])
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    mut.mutate({
      customer_id: customerId,
      type: saleType,
      tax: parseFloat(tax) || 0,
      line_items: selectedDevices.map(s => ({
        device_id: s.device.id,
        quantity: 1,
        unit_price: parseFloat(s.price) || 0,
      })),
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="New Sale">
      <form onSubmit={submit}>
        <Select label="Customer" value={customerId} onChange={e => setCustomerId(e.target.value)} required>
          <option value="">Select customer…</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
        </Select>
        <Select label="Sale Type" value={saleType} onChange={e => setSaleType(e.target.value)}>
          <option value="wholesale">Wholesale</option>
          <option value="retail">Retail</option>
        </Select>
        <Input label="Tax (₦)" type="number" value={tax} onChange={e => setTax(e.target.value)} />

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Devices (SELLABLE only)</div>
          <select
            value=""
            onChange={e => { if (e.target.value) addDevice(e.target.value) }}
            style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, marginBottom: 8 }}
          >
            <option value="">+ Scan / select IMEI…</option>
            {sellable
              .filter(d => !selectedDevices.find(s => s.device.id === d.id))
              .map(d => <option key={d.id} value={d.id}>{d.imei} — Grade {d.grade}</option>)
            }
          </select>
          {selectedDevices.map((s, i) => (
            <div key={s.device.id} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <code style={{ flex: 2, fontSize: 12, color: '#475569' }}>{s.device.imei}</code>
              <input
                placeholder="Price ₦"
                type="number"
                value={s.price}
                onChange={e => { const l = [...selectedDevices]; l[i].price = e.target.value; setSelectedDevices(l) }}
                style={{ flex: 1, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
                required
              />
              <button type="button" onClick={() => setSelectedDevices(selectedDevices.filter((_, j) => j !== i))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>✕</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" disabled={mut.isPending || selectedDevices.length === 0}>
            {mut.isPending ? 'Creating…' : 'Create Sale'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
