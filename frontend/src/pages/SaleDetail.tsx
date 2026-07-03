import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSale, addSalePayment } from '../services/api'
import { Sale, SalePayment } from '../types'
import { Btn, fmt } from '../components/Layout'
import { getCompanySettings } from '../hooks/useCompanySettings'

const payColor = (s: string) => s === 'paid' ? '#16a34a' : s === 'partial' ? '#d97706' : '#dc2626'
const payLabel = (s: string) => s.replace('_', ' ').toUpperCase()

function printInvoice(sale: Sale) {
  const co = getCompanySettings()
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

  const html = `<!DOCTYPE html><html><head><title>Invoice ${sale.invoice_number}</title><style>
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
    <div style="font-size:10px;text-align:right;color:#999;margin-bottom:4px">INVOICE</div>
    <h1>${co.name}</h1>
    ${co.tagline ? `<div style="font-size:11px;margin-top:3px">${co.tagline}</div>` : ''}
    ${co.phone ? `<div style="font-size:11px;margin-top:2px">📞 ${co.phone}</div>` : ''}
    ${co.email ? `<div style="font-size:11px">${co.email}</div>` : ''}
    ${co.address ? `<div style="font-size:11px;color:#555;margin-top:2px">${co.address}</div>` : ''}
    <div style="font-size:12px;margin-top:6px">
      Invoice No: <strong>${sale.invoice_number}</strong> &nbsp;|&nbsp; Date: <strong>${sale.date}</strong>
    </div>
  </div>
  <div class="info">
    <div><strong>Customer:</strong> ${custName}</div>
    <div><strong>Salesperson:</strong> ${sale.salesperson_name ?? '—'}</div>
    ${custPhone ? `<div><strong>Phone:</strong> ${custPhone}</div>` : '<div></div>'}
    <div><strong>Channel:</strong> ${(sale.sales_channel ?? '—').replace('_', ' ')}</div>
    ${custAddr ? `<div style="grid-column:span 2"><strong>Address:</strong> ${custAddr}</div>` : ''}
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
      <td>Balance Due</td><td style="text-align:right">₦${bal.toLocaleString()}</td>
    </tr>
  </table>
  ${co.bankDetails ? `<div style="margin:10px 0;padding:8px 12px;background:#f8f8f8;border:1px solid #e5e7eb;border-radius:6px;font-size:10px;white-space:pre-wrap">${co.bankDetails}</div>` : ''}
  <div class="footer">${co.receiptNote}</div>
  <div class="noPrint" style="text-align:center;margin-top:14px">
    <button onclick="window.print()" style="padding:8px 24px;cursor:pointer;font-size:13px">🖨 Print</button>
  </div>
</body></html>`

  const w = window.open('', '_blank', 'width=720,height=820')
  if (!w) { toast.error('Pop-ups blocked'); return }
  w.document.write(html)
  w.document.close()
}

function printReceipt(sale: Sale, payment?: SalePayment) {
  const co = getCompanySettings()
  const custName = sale.customer?.name ?? 'Walk-in Customer'
  const custPhone = sale.customer?.contact?.phone ?? ''

  const rows = sale.line_items.map(item => {
    const d = item.device
    const m = d?.model
    return `<tr>
      <td>${m ? `${m.brand} ${m.model_name}` : '—'}</td>
      <td>${m?.storage ?? '—'}</td>
      <td>${d?.grade ?? '—'}</td>
      <td style="font-family:monospace;font-size:10px">${d?.imei ?? '—'}</td>
      <td style="text-align:right">₦${parseFloat(item.unit_price).toLocaleString()}</td>
    </tr>`
  }).join('')

  const total = parseFloat(sale.total)
  const paid = payment ? parseFloat(String(payment.amount)) : parseFloat(sale.amount_paid)
  const bal = total - parseFloat(sale.amount_paid)
  const payMethod = payment?.payment_method ?? sale.payment_method ?? ''
  const payDate = payment?.payment_date ?? sale.date

  const html = `<!DOCTYPE html><html><head><title>Receipt ${sale.invoice_number}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;margin:0;padding:20px;color:#111;max-width:380px;margin:0 auto}
    h1{font-size:20px;margin:0}.hdr{text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px}
    table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}
    th{padding:4px 5px;text-align:left;font-size:10px;border-bottom:1px solid #000}
    td{padding:4px 5px;border-bottom:1px solid #e5e7eb}
    .total-line{display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px}
    .grand{font-weight:700;font-size:14px;border-top:2px solid #000;padding-top:6px;margin-top:4px}
    .footer{margin-top:14px;text-align:center;font-size:10px;color:#888;border-top:1px solid #ddd;padding-top:6px}
    @media print{.noPrint{display:none}}
  </style></head><body>
  <div class="hdr">
    <div style="font-size:10px;text-align:right;color:#999">PAYMENT RECEIPT</div>
    <h1>${co.name}</h1>
    ${co.tagline ? `<div style="font-size:10px">${co.tagline}</div>` : ''}
    ${co.phone ? `<div style="font-size:10px">📞 ${co.phone}</div>` : ''}
    <div style="font-size:11px;margin-top:5px">
      Ref: <strong>${sale.invoice_number}</strong> &nbsp;|&nbsp; Date: <strong>${payDate}</strong>
    </div>
  </div>
  <div style="font-size:11px;margin-bottom:8px">
    <div><strong>Customer:</strong> ${custName}${custPhone ? ` — ${custPhone}` : ''}</div>
    <div><strong>Salesperson:</strong> ${sale.salesperson_name ?? '—'}</div>
    ${payMethod ? `<div><strong>Payment Method:</strong> ${payMethod.toUpperCase()}</div>` : ''}
  </div>
  <table>
    <thead><tr><th>Item</th><th>Storage</th><th>Grd</th><th>IMEI</th><th style="text-align:right">Price</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total-line grand"><span>TOTAL</span><span>₦${total.toLocaleString()}</span></div>
  <div class="total-line" style="color:#16a34a"><span>Payment Received</span><span>₦${paid.toLocaleString()}</span></div>
  <div class="total-line" style="font-weight:600;color:${bal > 0 ? '#dc2626' : '#16a34a'}"><span>Balance</span><span>₦${bal.toLocaleString()}</span></div>
  ${co.bankDetails ? `<div style="margin:8px 0;padding:6px 10px;background:#f8f8f8;border:1px solid #e5e7eb;border-radius:4px;font-size:9px;white-space:pre-wrap">${co.bankDetails}</div>` : ''}
  <div class="footer">${co.receiptNote}</div>
  <div class="noPrint" style="text-align:center;margin-top:12px">
    <button onclick="window.print()" style="padding:6px 20px;cursor:pointer">🖨 Print</button>
  </div>
</body></html>`

  const w = window.open('', '_blank', 'width=480,height=700')
  if (!w) { toast.error('Pop-ups blocked'); return }
  w.document.write(html)
  w.document.close()
}

export default function SaleDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showPayForm, setShowPayForm] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payNotes, setPayNotes] = useState('')

  const { data: sale, isLoading, isError } = useQuery<Sale>({
    queryKey: ['sale', id],
    queryFn: () => getSale(id!).then(r => r.data),
    enabled: !!id,
  })

  const payMut = useMutation({
    mutationFn: (data: unknown) => addSalePayment(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale', id] })
      qc.invalidateQueries({ queryKey: ['sales'] })
      toast.success('Payment recorded')
      setShowPayForm(false)
      setPayAmount('')
      setPayNotes('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Failed to record payment'),
  })

  const submitPayment = () => {
    const amt = parseFloat(payAmount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    payMut.mutate({ amount: amt, payment_method: payMethod, payment_date: payDate, notes: payNotes.trim() || undefined })
  }

  if (isLoading) return (
    <div style={{ padding: 60, textAlign: 'center', color: '#64748b', fontSize: 16 }}>Loading sale…</div>
  )
  if (isError) return (
    <div style={{ padding: 40 }}>
      <div style={{ color: '#dc2626', marginBottom: 12 }}>Failed to load sale. The sale may not exist or the server returned an error.</div>
      <Btn variant="secondary" onClick={() => navigate('/sales')}>← Back to Sales</Btn>
    </div>
  )
  if (!sale) return (
    <div style={{ padding: 40 }}>
      <div style={{ color: '#94a3b8', marginBottom: 12 }}>Sale not found.</div>
      <Btn variant="secondary" onClick={() => navigate('/sales')}>← Back to Sales</Btn>
    </div>
  )

  const custName = sale.customer?.name ?? 'Walk-in Customer'
  const custPhone = sale.customer?.contact?.phone
  const custAddr = sale.customer?.contact?.address
  const hasPayments = (sale.payments?.length ?? 0) > 0

  const S: Record<string, React.CSSProperties> = {
    card: { background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '18px 20px', marginBottom: 18 },
    label: { fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
    value: { fontSize: 14, color: '#1e293b', marginTop: 2, fontWeight: 500 },
    field: { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' as const, marginBottom: 10 },
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate('/sales')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#64748b', padding: '4px 8px' }}>←</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 22, color: '#1e293b' }}>{sale.invoice_number}</h1>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Created {sale.date} · {sale.type}</div>
        </div>
        <span style={{
          color: payColor(sale.payment_status),
          background: payColor(sale.payment_status) + '18',
          padding: '4px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700,
        }}>
          {payLabel(sale.payment_status)}
        </span>
        <Btn variant="secondary" onClick={() => printInvoice(sale)}>Print Invoice</Btn>
        {hasPayments && <Btn variant="secondary" onClick={() => printReceipt(sale)}>Print Receipt</Btn>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {/* Customer */}
        <div style={S.card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: '#374151' }}>Customer</div>
          <InfoRow label="Name" value={custName} />
          {custPhone && <InfoRow label="Phone" value={custPhone} />}
          {custAddr && <InfoRow label="Address" value={custAddr} />}
        </div>

        {/* Sale Info */}
        <div style={S.card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: '#374151' }}>Sale Info</div>
          <InfoRow label="Salesperson" value={sale.salesperson_name ?? '—'} />
          <InfoRow label="Channel" value={(sale.sales_channel ?? '—').replace('_', ' ')} />
          <InfoRow label="Type" value={sale.type} />
          {sale.notes && <InfoRow label="Notes" value={sale.notes} />}
        </div>
      </div>

      {/* Items */}
      <div style={S.card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: '#374151' }}>Items Sold ({sale.line_items.length})</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {['Model', 'Storage', 'Colour', 'Grade', 'IMEI', 'Qty', 'Unit Price', 'Total'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontSize: 11, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sale.line_items.map(item => {
                const d = item.device
                const m = d?.model
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '9px 10px', fontWeight: 500 }}>{m ? `${m.brand} ${m.model_name}` : '—'}</td>
                    <td style={{ padding: '9px 10px' }}>{m?.storage ?? '—'}</td>
                    <td style={{ padding: '9px 10px' }}>{m?.colour ?? '—'}</td>
                    <td style={{ padding: '9px 10px' }}>
                      <span style={{
                        background: d?.grade === 'A' ? '#dcfce7' : d?.grade === 'B' ? '#fef9c3' : '#fee2e2',
                        color: d?.grade === 'A' ? '#16a34a' : d?.grade === 'B' ? '#854d0e' : '#dc2626',
                        padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      }}>{d?.grade ?? '—'}</span>
                    </td>
                    <td style={{ padding: '9px 10px', fontFamily: 'monospace', fontSize: 11 }}>{d?.imei ?? '—'}</td>
                    <td style={{ padding: '9px 10px' }}>{item.quantity}</td>
                    <td style={{ padding: '9px 10px' }}>{fmt(item.unit_price)}</td>
                    <td style={{ padding: '9px 10px', fontWeight: 600 }}>{fmt(item.line_total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totals */}
      <div style={{ ...S.card, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ minWidth: 280 }}>
          {[
            { lbl: 'Subtotal', val: `₦${fmt(sale.subtotal)}`, col: '' },
            { lbl: 'Discount', val: `-₦${fmt(sale.discount || '0')}`, col: parseFloat(sale.discount || '0') > 0 ? '#16a34a' : '' },
            { lbl: 'Delivery Fee', val: `₦${fmt(sale.delivery_fee || '0')}`, col: '' },
            { lbl: 'Tax', val: `₦${fmt(sale.tax)}`, col: '' },
          ].map(r => (
            <div key={r.lbl} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5, color: r.col || '#64748b' }}>
              <span>{r.lbl}</span><span>{r.val}</span>
            </div>
          ))}
          <div style={{ borderTop: '2px solid #e2e8f0', marginTop: 8, paddingTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 17 }}>
              <span>Grand Total</span><span>{fmt(sale.total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 5, color: '#16a34a' }}>
              <span>Amount Paid</span><span>{fmt(sale.amount_paid)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginTop: 4, fontWeight: 700, color: parseFloat(sale.balance) > 0 ? '#dc2626' : '#16a34a' }}>
              <span>Balance Due</span><span>{fmt(sale.balance)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Payments */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Payments ({sale.payments?.length ?? 0})</div>
          {sale.payment_status !== 'paid' && (
            <Btn onClick={() => setShowPayForm(v => !v)}>
              {showPayForm ? 'Cancel' : '+ Add Payment'}
            </Btn>
          )}
        </div>

        {showPayForm && (
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: '16px', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
              <div>
                <label style={{ ...S.label, display: 'block', marginBottom: 4 }}>Amount (₦) *</label>
                <input style={S.field} type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label style={{ ...S.label, display: 'block', marginBottom: 4 }}>Payment Method</label>
                <select style={S.field} value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="transfer">Transfer</option>
                  <option value="pos">POS</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
              <div>
                <label style={{ ...S.label, display: 'block', marginBottom: 4 }}>Date</label>
                <input style={S.field} type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
              </div>
              <div>
                <label style={{ ...S.label, display: 'block', marginBottom: 4 }}>Notes / Reference</label>
                <input style={S.field} value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="e.g. Transfer ref #1234" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="secondary" onClick={() => setShowPayForm(false)}>Cancel</Btn>
              <Btn disabled={payMut.isPending} onClick={submitPayment}>
                {payMut.isPending ? 'Saving…' : 'Record Payment'}
              </Btn>
            </div>
          </div>
        )}

        {(sale.payments?.length ?? 0) > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {['Date', 'Amount', 'Method', 'Notes', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontSize: 11, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sale.payments!.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 10px' }}>{p.payment_date}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 600, color: '#16a34a' }}>{fmt(p.amount)}</td>
                  <td style={{ padding: '8px 10px', textTransform: 'capitalize' }}>{p.payment_method ?? '—'}</td>
                  <td style={{ padding: '8px 10px', color: '#64748b' }}>{p.notes ?? '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#2563eb' }}
                      onClick={() => printReceipt(sale, p)}
                    >
                      🖨 Receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>No payments recorded yet.</p>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#1e293b', marginTop: 2 }}>{value}</div>
    </div>
  )
}
