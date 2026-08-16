import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSale, addSalePayment } from '../services/api'
import { Sale, SalePayment } from '../types'
import { Btn, fmt } from '../components/Layout'
import { getCompanySettings } from '../hooks/useCompanySettings'

function apiErr(e: any, fallback = 'An error occurred'): string {
  const d = e?.response?.data?.detail
  if (!d) return fallback
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x: any) => x.msg ?? String(x)).join('; ')
  return fallback
}

const payColor = (s: string) => s === 'paid' ? '#16a34a' : s === 'partial' ? '#d97706' : '#dc2626'
const payLabel = (s: string) => s.replace('_', ' ').toUpperCase()

function thermalCSS(): string {
  return [
    '@page{size:80mm auto;margin:4mm 3mm}',
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#000;width:74mm;-webkit-print-color-adjust:exact}',
    '.c{text-align:center}.r{text-align:right}',
    '.co{font-size:15pt;font-weight:900;letter-spacing:0.3pt;margin:4px 0 2px}',
    '.sub{font-size:9pt;color:#333;margin-bottom:2px}',
    '.dt{font-size:9pt;font-weight:700;letter-spacing:2pt;margin-bottom:4px}',
    'hr.s{border:none;border-top:2px solid #000;margin:7px 0}',
    'hr.d{border:none;border-top:1px dashed #555;margin:7px 0}',
    '.ir{display:flex;justify-content:space-between;font-size:9.5pt;margin-bottom:4px;line-height:1.4}',
    '.ir span:first-child{color:#444;min-width:72px;font-weight:600}',
    'table{width:100%;border-collapse:collapse;font-size:9pt}',
    'th{font-size:8pt;font-weight:700;text-transform:uppercase;padding:3px 0;border-bottom:2px solid #000;text-align:left}',
    'th.r{text-align:right}',
    'td{padding:4px 0;vertical-align:top;border-bottom:1px solid #ddd}',
    '.in{font-size:10pt;font-weight:700;line-height:1.3}',
    '.is{font-size:8.5pt;color:#333;margin-top:2px}',
    '.im{font-size:8pt;color:#222;margin-top:2px;letter-spacing:0.5pt}',
    '.tl{display:flex;justify-content:space-between;font-size:10pt;padding:3px 0}',
    '.tl.g{font-size:13pt;font-weight:900;padding:6px 0 4px;border-top:2px solid #000;margin-top:4px}',
    '.tl.p{font-size:10pt;font-weight:700}',
    '.tl.b{font-size:11pt;font-weight:700;border-top:1px dashed #555;padding-top:5px;margin-top:3px}',
    '.bk{font-size:8.5pt;border:1px solid #888;padding:6px;margin:7px 0;white-space:pre-wrap;line-height:1.6}',
    '.ft{font-size:9pt;text-align:center;padding-top:7px;line-height:1.8}',
    '@media print{.np{display:none}body{width:74mm}}',
  ].join('')
}

function printInvoice(sale: Sale) {
  const co = getCompanySettings()
  const custName = sale.customer?.name ?? 'Walk-in Customer'
  const custPhone = sale.customer?.contact?.phone ?? ''
  const custAddr = sale.customer?.contact?.address ?? ''

  const rows = sale.line_items.map(item => {
    const d = item.device
    const m = d?.model
    const modelName = m ? (m.brand + ' ' + m.model_name) : '—'
    const storage = m?.storage ?? ''
    const colour = m?.colour ?? ''
    const grade = d?.grade ?? '—'
    const imei = d?.imei ?? '—'
    const price = '₦' + parseFloat(item.unit_price).toLocaleString()
    const lineTotal = '₦' + parseFloat(item.line_total).toLocaleString()
    return '<tr><td><div class="in">' + modelName + '</div>'
      + '<div class="is">' + [storage, colour, 'Grade ' + grade].filter(Boolean).join(' ') + '</div>'
      + '<div class="im">' + imei + '</div></td>'
      + '<td class="r">' + price + '</td>'
      + '<td class="r">' + lineTotal + '</td></tr>'
  }).join('')

  const sub = parseFloat(sale.subtotal)
  const disc = parseFloat(sale.discount || '0')
  const del = parseFloat(sale.delivery_fee || '0')
  const tax = parseFloat(sale.tax)
  const total = parseFloat(sale.total)
  const paid = parseFloat(sale.amount_paid)
  const bal = parseFloat(sale.balance)
  const N = '₦'

  const parts: string[] = []
  parts.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ' + sale.invoice_number + '</title>')
  parts.push('<style>' + thermalCSS() + '</style></head><body>')
  parts.push('<div class="c"><div class="dt">INVOICE</div>')
  parts.push('<div class="co">' + co.name + '</div>')
  if (co.tagline) parts.push('<div class="sub">' + co.tagline + '</div>')
  if (co.phone) parts.push('<div class="sub">' + co.phone + '</div>')
  if (co.email) parts.push('<div class="sub">' + co.email + '</div>')
  if (co.address) parts.push('<div class="sub">' + co.address + '</div>')
  parts.push('</div><hr class="s">')
  parts.push('<div class="ir"><span>Invoice No:</span><span><strong>' + sale.invoice_number + '</strong></span></div>')
  parts.push('<div class="ir"><span>Date:</span><span>' + sale.date + '</span></div>')
  parts.push('<div class="ir"><span>Customer:</span><span>' + custName + '</span></div>')
  if (custPhone) parts.push('<div class="ir"><span>Phone:</span><span>' + custPhone + '</span></div>')
  if (custAddr) parts.push('<div class="ir"><span>Address:</span><span>' + custAddr + '</span></div>')
  if (sale.salesperson_name) parts.push('<div class="ir"><span>Salesperson:</span><span>' + sale.salesperson_name + '</span></div>')
  parts.push('<hr class="d">')
  parts.push('<table><thead><tr><th>Item</th><th class="r">Price</th><th class="r">Total</th></tr></thead>')
  parts.push('<tbody>' + rows + '</tbody></table><hr class="d">')
  if (sub !== total) parts.push('<div class="tl"><span>Subtotal</span><span>' + N + sub.toLocaleString() + '</span></div>')
  if (disc > 0) parts.push('<div class="tl"><span>Discount</span><span>-' + N + disc.toLocaleString() + '</span></div>')
  if (del > 0) parts.push('<div class="tl"><span>Delivery</span><span>' + N + del.toLocaleString() + '</span></div>')
  if (tax > 0) parts.push('<div class="tl"><span>Tax</span><span>' + N + tax.toLocaleString() + '</span></div>')
  parts.push('<div class="tl g"><span>TOTAL</span><span>' + N + total.toLocaleString() + '</span></div>')
  parts.push('<div class="tl p"><span>Amount Paid</span><span>' + N + paid.toLocaleString() + '</span></div>')
  parts.push('<div class="tl b"><span>Balance Due</span><span>' + N + bal.toLocaleString() + '</span></div>')
  if (co.bankDetails) parts.push('<div class="bk">' + co.bankDetails + '</div>')
  parts.push('<hr class="d"><div class="ft">' + (co.receiptNote || 'Thank you for your business!') + '</div>')
  parts.push('<div class="np" style="text-align:center;margin-top:14px">')
  parts.push('<button onclick="window.print()" style="padding:8px 24px;cursor:pointer;font-size:13px;font-family:sans-serif">Print Invoice</button>')
  parts.push('</div></body></html>')

  const w = window.open('', '_blank', 'width=380,height=700')
  if (!w) { toast.error('Pop-ups blocked'); return }
  w.document.write(parts.join(''))
  w.document.close()
}

function printReceipt(sale: Sale, payment?: SalePayment) {
  const co = getCompanySettings()
  const custName = sale.customer?.name ?? 'Walk-in Customer'
  const custPhone = sale.customer?.contact?.phone ?? ''

  const rows = sale.line_items.map(item => {
    const d = item.device
    const m = d?.model
    const modelName = m ? (m.brand + ' ' + m.model_name) : '—'
    const detail = [m?.storage ?? '', m?.colour ?? '', d?.grade ? 'Grade ' + d.grade : ''].filter(Boolean).join(' ')
    const imei = d?.imei ?? '—'
    const price = '₦' + parseFloat(item.unit_price).toLocaleString()
    return '<tr><td><div class="in">' + modelName + '</div>'
      + '<div class="is">' + detail + '</div>'
      + '<div class="im">' + imei + '</div></td>'
      + '<td class="r">' + price + '</td></tr>'
  }).join('')

  const total = parseFloat(sale.total)
  const paid = payment ? parseFloat(String(payment.amount)) : parseFloat(sale.amount_paid)
  const bal = total - parseFloat(sale.amount_paid)
  const payMethod = payment?.payment_method ?? sale.payment_method ?? ''
  const payDate = payment?.payment_date ?? sale.date
  const N = '₦'

  const parts: string[] = []
  parts.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ' + sale.invoice_number + '</title>')
  parts.push('<style>' + thermalCSS() + '</style></head><body>')
  parts.push('<div class="c"><div class="dt">PAYMENT RECEIPT</div>')
  parts.push('<div class="co">' + co.name + '</div>')
  if (co.tagline) parts.push('<div class="sub">' + co.tagline + '</div>')
  if (co.phone) parts.push('<div class="sub">' + co.phone + '</div>')
  if (co.email) parts.push('<div class="sub">' + co.email + '</div>')
  if (co.address) parts.push('<div class="sub">' + co.address + '</div>')
  parts.push('</div><hr class="s">')
  parts.push('<div class="ir"><span>Receipt Ref:</span><span><strong>' + sale.invoice_number + '</strong></span></div>')
  parts.push('<div class="ir"><span>Date:</span><span>' + payDate + '</span></div>')
  parts.push('<div class="ir"><span>Customer:</span><span>' + custName + '</span></div>')
  if (custPhone) parts.push('<div class="ir"><span>Phone:</span><span>' + custPhone + '</span></div>')
  if (sale.salesperson_name) parts.push('<div class="ir"><span>Salesperson:</span><span>' + sale.salesperson_name + '</span></div>')
  if (payMethod) parts.push('<div class="ir"><span>Method:</span><span>' + payMethod.toUpperCase() + '</span></div>')
  parts.push('<hr class="d">')
  parts.push('<table><thead><tr><th>Items Purchased</th><th class="r">Price</th></tr></thead>')
  parts.push('<tbody>' + rows + '</tbody></table>')
  parts.push('<div class="tl g"><span>TOTAL</span><span>' + N + total.toLocaleString() + '</span></div>')
  parts.push('<div class="tl p"><span>Amount Paid</span><span>' + N + paid.toLocaleString() + '</span></div>')
  parts.push('<div class="tl b"><span>Balance Due</span><span>' + N + bal.toLocaleString() + '</span></div>')
  if (co.bankDetails) parts.push('<div class="bk">' + co.bankDetails + '</div>')
  parts.push('<hr class="d"><div class="ft">' + (co.receiptNote || 'Thank you for your business!') + '</div>')
  parts.push('<div class="np" style="text-align:center;margin-top:14px">')
  parts.push('<button onclick="window.print()" style="padding:8px 24px;cursor:pointer;font-size:13px;font-family:sans-serif">Print Receipt</button>')
  parts.push('</div></body></html>')

  const w = window.open('', '_blank', 'width=380,height=700')
  if (!w) { toast.error('Pop-ups blocked'); return }
  w.document.write(parts.join(''))
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
    onError: (e: any) => toast.error(apiErr(e, 'Failed to record payment')),
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
