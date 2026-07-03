import { useState, useRef, KeyboardEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSales, createSale, addPayment, getCustomers, getSellableDevices, getPhoneModels } from '../services/api'
import { Sale, Customer, Device, PhoneModel } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Input, fmt } from '../components/Layout'

const payColor = (s: string) => s === 'paid' ? '#16a34a' : s === 'partial' ? '#d97706' : '#dc2626'
const payLabel = (s: string) => s.replace('_', ' ').toUpperCase()

function printReceipt(sale: Sale) {
  const custName = sale.customer?.name ?? 'Walk-in Customer'
  const custPhone = sale.customer?.contact?.phone ?? ''
  const custAddr = sale.customer?.contact?.address ?? ''

  const rows = sale.line_items.map(item => {
    const d = item.device
    const m = d?.model
    return `<tr>
      <td>${m ? `${m.brand} ${m.model_name}` : '—'}</td>
      <td>${m?.storage ?? '—'}</td>
      <td>${m?.colour ?? '—'}</td>
      <td>${d?.grade ?? '—'}</td>
      <td style="font-family:monospace">${d?.imei ?? '—'}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="text-align:right">₦${parseFloat(item.unit_price).toLocaleString()}</td>
      <td style="text-align:right">₦${parseFloat(item.line_total).toLocaleString()}</td>
    </tr>`
  }).join('')

  const sub = parseFloat(sale.subtotal)
  const disc = parseFloat(sale.discount || '0')
  const del = parseFloat(sale.delivery_fee || '0')
  const tax = parseFloat(sale.tax)
  const total = parseFloat(sale.total)
  const paid = parseFloat(sale.amount_paid)
  const bal = parseFloat(sale.balance)

  const html = `<!DOCTYPE html><html><head><title>${sale.invoice_number}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;margin:0;padding:20px;color:#111}
    h1{font-size:22px;margin:0}.hdr{text-align:center;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:12px}
    .info{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin-bottom:12px;font-size:11px}
    table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px}
    th{background:#eee;padding:5px 6px;text-align:left;font-size:10px;font-weight:700}
    td{padding:5px 6px;border-bottom:1px solid #e5e7eb}
    .totals{margin-left:auto;width:260px}.totals td{padding:4px 6px;border:none}
    .grand{font-weight:700;font-size:13px;border-top:2px solid #000}
    .footer{margin-top:20px;text-align:center;font-size:10px;color:#888;border-top:1px solid #ddd;padding-top:8px}
    @media print{.noPrint{display:none}}
  </style></head><body>
  <div class="hdr">
    <h1>TARDMART VENTURES</h1>
    <div style="font-size:11px;margin-top:3px">Quality Refurbished Phones</div>
    <div style="font-size:12px;margin-top:6px">
      Receipt No: <strong>${sale.invoice_number}</strong> &nbsp;|&nbsp; Date: <strong>${sale.date}</strong>
    </div>
  </div>
  <div class="info">
    <div><strong>Customer:</strong> ${custName}</div>
    <div><strong>Salesperson:</strong> ${sale.salesperson_name ?? '—'}</div>
    ${custPhone ? `<div><strong>Phone:</strong> ${custPhone}</div>` : '<div></div>'}
    <div><strong>Payment:</strong> ${(sale.payment_method ?? '—').toUpperCase()}</div>
    ${custAddr ? `<div style="grid-column:span 2"><strong>Address:</strong> ${custAddr}</div>` : ''}
    <div><strong>Channel:</strong> ${(sale.sales_channel ?? '—').replace('_', ' ')}</div>
    <div><strong>Type:</strong> ${sale.type}</div>
  </div>
  <table>
    <thead><tr><th>Model</th><th>Storage</th><th>Colour</th><th>Grade</th><th>IMEI</th><th>Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td style="text-align:right">₦${sub.toLocaleString()}</td></tr>
    ${disc > 0 ? `<tr><td>Discount</td><td style="text-align:right;color:#16a34a">-₦${disc.toLocaleString()}</td></tr>` : ''}
    ${del > 0 ? `<tr><td>Delivery Fee</td><td style="text-align:right">₦${del.toLocaleString()}</td></tr>` : ''}
    ${tax > 0 ? `<tr><td>Tax</td><td style="text-align:right">₦${tax.toLocaleString()}</td></tr>` : ''}
    <tr class="grand"><td>GRAND TOTAL</td><td style="text-align:right">₦${total.toLocaleString()}</td></tr>
    <tr><td>Amount Paid</td><td style="text-align:right;color:#16a34a">₦${paid.toLocaleString()}</td></tr>
    <tr style="font-weight:700;color:${bal > 0 ? '#dc2626' : '#16a34a'}">
      <td>Outstanding Balance</td><td style="text-align:right">₦${bal.toLocaleString()}</td>
    </tr>
  </table>
  <div class="footer">Thank you for your business! All sales are final.</div>
  <div class="noPrint" style="text-align:center;margin-top:14px">
    <button onclick="window.print()" style="padding:8px 24px;cursor:pointer;font-size:13px">🖨 Print</button>
  </div>
</body></html>`

  const w = window.open('', '_blank', 'width=720,height=820')
  if (!w) { toast.error('Pop-ups blocked — please allow pop-ups to print'); return }
  w.document.write(html)
  w.document.close()
}

interface LineItem { device: Device; model: PhoneModel | undefined; unit_price: string }

export default function Sales() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [paymentSale, setPaymentSale] = useState<Sale | null>(null)
  const [payAmount, setPayAmount] = useState('')

  const { data: sales = [] } = useQuery({ queryKey: ['sales'], queryFn: () => getSales().then(r => r.data) })
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: () => getCustomers().then(r => r.data) })
  const { data: sellable = [] } = useQuery({ queryKey: ['sellable-devices'], queryFn: () => getSellableDevices().then(r => r.data) })
  const { data: phoneModels = [] } = useQuery({ queryKey: ['phone-models'], queryFn: () => getPhoneModels().then(r => r.data) })

  const payMut = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: string }) =>
      addPayment(id, { amount: parseFloat(amount) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      setPaymentSale(null)
      toast.success('Payment recorded')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Error'),
  })

  return (
    <div>
      <PageHeader title="Sales" action={<Btn onClick={() => setShowNew(true)}>+ New Sale</Btn>} />
      <Card>
        <Table headers={['Invoice', 'Customer', 'Type', 'Salesperson', 'Channel', 'Total', 'Paid', 'Balance', 'Status', 'Date', '']}>
          {(sales as Sale[]).map(sale => (
            <TR key={sale.id}>
              <TD>{sale.invoice_number}</TD>
              <TD>{sale.customer?.name ?? '—'}</TD>
              <TD style={{ textTransform: 'capitalize' }}>{sale.type}</TD>
              <TD>{sale.salesperson_name ?? '—'}</TD>
              <TD style={{ textTransform: 'capitalize' }}>{(sale.sales_channel ?? '—').replace('_', ' ')}</TD>
              <TD>₦{fmt(sale.total)}</TD>
              <TD>₦{fmt(sale.amount_paid)}</TD>
              <TD style={{ fontWeight: 600, color: parseFloat(sale.balance) > 0 ? '#dc2626' : '#16a34a' }}>
                ₦{fmt(sale.balance)}
              </TD>
              <TD>
                <span style={{
                  color: payColor(sale.payment_status),
                  background: payColor(sale.payment_status) + '18',
                  padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                }}>
                  {payLabel(sale.payment_status)}
                </span>
              </TD>
              <TD>{sale.date}</TD>
              <TD>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" variant="secondary" onClick={() => { setPaymentSale(sale); setPayAmount('') }}>
                    + Pay
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => printReceipt(sale)}>
                    🖨
                  </Btn>
                </div>
              </TD>
            </TR>
          ))}
        </Table>
        {(sales as Sale[]).length === 0 && (
          <p style={{ textAlign: 'center', color: '#94a3b8', padding: 24, margin: 0 }}>No sales recorded yet.</p>
        )}
      </Card>

      {showNew && (
        <NewSaleModal
          onClose={() => setShowNew(false)}
          customers={customers as Customer[]}
          sellable={sellable as Device[]}
          phoneModels={phoneModels as PhoneModel[]}
          onSuccess={sale => {
            qc.invalidateQueries({ queryKey: ['sales'] })
            qc.invalidateQueries({ queryKey: ['sellable-devices'] })
            setShowNew(false)
            printReceipt(sale)
          }}
        />
      )}

      {paymentSale && (
        <Overlay onClose={() => setPaymentSale(null)}>
          <h3 style={{ margin: '0 0 12px' }}>Add Payment — {paymentSale.invoice_number}</h3>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 14px' }}>
            Balance due: <strong style={{ color: '#dc2626' }}>₦{fmt(paymentSale.balance)}</strong>
          </p>
          <Input label="Amount (₦)" type="number" value={payAmount}
            onChange={e => setPayAmount(e.target.value)} placeholder="0" />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <Btn variant="secondary" onClick={() => setPaymentSale(null)}>Cancel</Btn>
            <Btn
              disabled={!payAmount || parseFloat(payAmount) <= 0 || payMut.isPending}
              onClick={() => payMut.mutate({ id: paymentSale.id, amount: payAmount })}
            >
              Record Payment
            </Btn>
          </div>
        </Overlay>
      )}
    </div>
  )
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, minWidth: 360, maxWidth: 480 }}
           onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function NewSaleModal({ onClose, customers, sellable, phoneModels, onSuccess }: {
  onClose: () => void
  customers: Customer[]
  sellable: Device[]
  phoneModels: PhoneModel[]
  onSuccess: (sale: Sale) => void
}) {
  const [custMode, setCustMode] = useState<'new' | 'existing'>('new')
  const [existingCustId, setExistingCustId] = useState('')
  const [custName, setCustName] = useState('')
  const [custPhone, setCustPhone] = useState('')
  const [custAddress, setCustAddress] = useState('')

  const [saleType, setSaleType] = useState('retail')
  const [salesperson, setSalesperson] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [salesChannel, setSalesChannel] = useState('walk_in')
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  const [tax, setTax] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [deliveryFee, setDeliveryFee] = useState('0')
  const [amountPaid, setAmountPaid] = useState('0')

  const [imeiInput, setImeiInput] = useState('')
  const [imeiError, setImeiError] = useState('')
  const imeiRef = useRef<HTMLInputElement>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])

  const mut = useMutation({
    mutationFn: (data: unknown) => createSale(data),
    onSuccess: (res) => { toast.success('Sale created'); onSuccess(res.data as Sale) },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to create sale'),
  })

  // Computed totals
  const totalQty = lineItems.length
  const subtotal = lineItems.reduce((s, i) => s + (parseFloat(i.unit_price) || 0), 0)
  const disc = parseFloat(discount) || 0
  const delFee = parseFloat(deliveryFee) || 0
  const taxAmt = parseFloat(tax) || 0
  const grandTotal = subtotal - disc + delFee + taxAmt
  const amtPaidNum = parseFloat(amountPaid) || 0
  const balanceDue = grandTotal - amtPaidNum

  const scanImei = () => {
    const imei = imeiInput.trim()
    if (!imei) return
    setImeiError('')
    if (lineItems.some(i => i.device.imei === imei)) {
      setImeiError(`IMEI ${imei} already added`); return
    }
    const device = sellable.find(d => d.imei === imei)
    if (!device) {
      setImeiError(`IMEI ${imei} not found in sales stock`); return
    }
    const model = phoneModels.find(m => m.id === device.model_id)
    setLineItems(prev => [...prev, { device, model, unit_price: '' }])
    setImeiInput('')
    setTimeout(() => imeiRef.current?.focus(), 50)
  }

  const onImeiKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); scanImei() }
  }

  const selectExisting = (id: string) => {
    setExistingCustId(id)
    const c = customers.find(c => c.id === id)
    if (c) {
      setCustName(c.name)
      setCustPhone((c.contact as any)?.phone ?? '')
      setCustAddress((c.contact as any)?.address ?? '')
    }
  }

  const submit = () => {
    if (!custName.trim()) return toast.error('Customer name is required')
    if (lineItems.length === 0) return toast.error('Add at least one item')
    if (lineItems.some(i => !i.unit_price || parseFloat(i.unit_price) <= 0))
      return toast.error('Enter a selling price for every item')

    mut.mutate({
      customer_id: custMode === 'existing' && existingCustId ? existingCustId : undefined,
      customer_name: custMode === 'new' ? custName.trim() : undefined,
      customer_phone: custMode === 'new' && custPhone.trim() ? custPhone.trim() : undefined,
      customer_address: custMode === 'new' && custAddress.trim() ? custAddress.trim() : undefined,
      type: saleType,
      salesperson_name: salesperson.trim() || undefined,
      payment_method: payMethod,
      sales_channel: salesChannel,
      tax: taxAmt,
      discount: disc,
      delivery_fee: delFee,
      amount_paid: amtPaidNum,
      date: saleDate,
      notes: notes.trim() || undefined,
      line_items: lineItems.map(i => ({
        device_id: i.device.id,
        quantity: 1,
        unit_price: parseFloat(i.unit_price),
      })),
    })
  }

  const S: Record<string, React.CSSProperties> = {
    section: { background: '#f8fafc', borderRadius: 8, padding: '14px 16px', marginBottom: 14 },
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' },
    label: { fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 },
    field: { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' as const, marginBottom: 12 },
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      zIndex: 999, overflowY: 'auto', padding: '16px 12px',
    }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 800, margin: '0 auto' }}
           onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>New Sale</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#64748b', lineHeight: 1 }}>×</button>
        </div>

        {/* ── Customer ── */}
        <div style={S.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>Customer Details</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['new', 'existing'] as const).map(m => (
                <button key={m} onClick={() => setCustMode(m)} style={{
                  padding: '3px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: custMode === m ? '#2563eb' : '#f1f5f9',
                  color: custMode === m ? '#fff' : '#374151',
                  border: custMode === m ? 'none' : '1px solid #d1d5db',
                }}>
                  {m === 'new' ? 'New Customer' : 'Existing'}
                </button>
              ))}
            </div>
          </div>

          {custMode === 'existing' && (
            <div>
              <label style={S.label}>Select Customer</label>
              <select style={S.field} value={existingCustId} onChange={e => selectExisting(e.target.value)}>
                <option value="">— choose —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div style={S.grid2}>
            <div>
              <label style={S.label}>Customer Name *</label>
              <input style={S.field} value={custName} onChange={e => setCustName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <label style={S.label}>Phone Number</label>
              <input style={S.field} value={custPhone} onChange={e => setCustPhone(e.target.value)} placeholder="08012345678" />
            </div>
          </div>
          <div>
            <label style={S.label}>Address</label>
            <input style={{ ...S.field, marginBottom: 0 }} value={custAddress} onChange={e => setCustAddress(e.target.value)} placeholder="Delivery / home address" />
          </div>
        </div>

        {/* ── Sale Details ── */}
        <div style={S.section}>
          <strong style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>Sale Details</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' }}>
            <div>
              <label style={S.label}>Salesperson</label>
              <input style={S.field} value={salesperson} onChange={e => setSalesperson(e.target.value)} placeholder="Staff name" />
            </div>
            <div>
              <label style={S.label}>Payment Method</label>
              <select style={S.field} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="transfer">Transfer</option>
                <option value="pos">POS</option>
                <option value="credit">Credit</option>
              </select>
            </div>
            <div>
              <label style={S.label}>Sales Channel</label>
              <select style={S.field} value={salesChannel} onChange={e => setSalesChannel(e.target.value)}>
                <option value="walk_in">Walk-in</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="instagram">Instagram</option>
              </select>
            </div>
            <div>
              <label style={S.label}>Sale Type</label>
              <select style={S.field} value={saleType} onChange={e => setSaleType(e.target.value)}>
                <option value="retail">Retail</option>
                <option value="wholesale">Wholesale</option>
              </select>
            </div>
            <div>
              <label style={S.label}>Date</label>
              <input style={S.field} type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Notes</label>
              <input style={S.field} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>

        {/* ── Items ── */}
        <div style={S.section}>
          <strong style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>Items — Scan IMEI</strong>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input
              ref={imeiRef}
              style={{ ...S.field, flex: 1, marginBottom: 0 }}
              value={imeiInput}
              onChange={e => { setImeiInput(e.target.value); setImeiError('') }}
              onKeyDown={onImeiKey}
              placeholder="Scan barcode or type IMEI, then press Enter or click Add"
              autoFocus
            />
            <Btn onClick={scanImei}>Add</Btn>
          </div>
          {imeiError && <p style={{ color: '#dc2626', fontSize: 12, margin: '4px 0 6px' }}>{imeiError}</p>}

          {lineItems.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    {['Model', 'Storage', 'Colour', 'Grade', 'IMEI', 'Selling Price (₦)', ''].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '5px 8px', color: '#64748b', fontSize: 11, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, idx) => {
                    const m = item.model
                    return (
                      <tr key={item.device.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '7px 8px' }}>{m ? `${m.brand} ${m.model_name}` : '—'}</td>
                        <td style={{ padding: '7px 8px' }}>{m?.storage ?? '—'}</td>
                        <td style={{ padding: '7px 8px' }}>{m?.colour ?? '—'}</td>
                        <td style={{ padding: '7px 8px' }}>
                          <span style={{
                            background: item.device.grade === 'A' ? '#dcfce7' : item.device.grade === 'B' ? '#fef9c3' : '#fee2e2',
                            color: item.device.grade === 'A' ? '#16a34a' : item.device.grade === 'B' ? '#854d0e' : '#dc2626',
                            padding: '2px 7px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                          }}>{item.device.grade}</span>
                        </td>
                        <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontSize: 11 }}>{item.device.imei}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <input
                            type="number"
                            style={{ width: 130, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
                            value={item.unit_price}
                            onChange={e => setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, unit_price: e.target.value } : li))}
                            placeholder="0"
                          />
                        </td>
                        <td style={{ padding: '7px 8px' }}>
                          <button onClick={() => setLineItems(prev => prev.filter((_, i) => i !== idx))}
                            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {lineItems.length === 0 && (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '10px 0 2px', margin: 0 }}>
              No items — scan an IMEI above to add devices
            </p>
          )}
        </div>

        {/* ── Totals ── */}
        <div style={{ ...S.section, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 28px' }}>
          <div>
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>Adjustments</strong>
            <div style={S.grid2}>
              <div>
                <label style={S.label}>Discount (₦)</label>
                <input style={S.field} type="number" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label style={S.label}>Delivery Fee (₦)</label>
                <input style={S.field} type="number" value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label style={S.label}>Tax (₦)</label>
                <input style={{ ...S.field, marginBottom: 0 }} type="number" value={tax} onChange={e => setTax(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label style={S.label}>Amount Paid (₦)</label>
                <input style={{ ...S.field, marginBottom: 0 }} type="number" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} placeholder="0" />
              </div>
            </div>
          </div>

          <div>
            <strong style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>Summary</strong>
            {[
              { lbl: 'Total Items', val: `${totalQty}`, col: '' },
              { lbl: 'Subtotal', val: `₦${subtotal.toLocaleString()}`, col: '' },
              { lbl: 'Discount', val: `-₦${disc.toLocaleString()}`, col: disc > 0 ? '#16a34a' : '' },
              { lbl: 'Delivery Fee', val: `₦${delFee.toLocaleString()}`, col: '' },
              { lbl: 'Tax', val: `₦${taxAmt.toLocaleString()}`, col: '' },
            ].map(r => (
              <div key={r.lbl} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5, color: r.col || '#64748b' }}>
                <span>{r.lbl}</span><span>{r.val}</span>
              </div>
            ))}
            <div style={{ borderTop: '2px solid #e2e8f0', marginTop: 8, paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16 }}>
                <span>Grand Total</span><span>₦{grandTotal.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 5, color: '#16a34a' }}>
                <span>Amount Paid</span><span>₦{amtPaidNum.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4, fontWeight: 600, color: balanceDue > 0 ? '#dc2626' : '#16a34a' }}>
                <span>Balance Due</span><span>₦{balanceDue.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn disabled={mut.isPending} onClick={submit}>
            {mut.isPending ? 'Saving…' : '✓ Create Sale & Print Receipt'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
