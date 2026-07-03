import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { Card, fmt } from '../components/Layout'
import {
  getInventoryReport, getPurchaseReport, getSalesDetailReport,
  getRefurbReport, getReturnsDetailReport, getOperationsSummary,
  getMySales, getMyRefurb,
  getReconciliation, getLowStockAlerts,
  getExpenses, getExpensesSummary,
} from '../services/api'

// ── Utilities ────────────────────────────────────────────────────────────────

function downloadCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function printSection(title: string, html: string) {
  const w = window.open('', '_blank', 'width=900,height=700')!
  w.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>
    body{font-family:sans-serif;padding:24px;font-size:13px}
    h1{font-size:18px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}
    th{background:#f1f5f9;text-align:left;padding:6px 10px;font-size:12px;border-bottom:2px solid #e2e8f0}
    td{padding:6px 10px;border-bottom:1px solid #f1f5f9}
    .stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
    .stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px}
    .stat-label{font-size:11px;color:#64748b;margin-bottom:4px}
    .stat-value{font-size:18px;font-weight:700}
    @media print{body{padding:8px}}
  </style></head><body><h1>${title}</h1>${html}</body></html>`)
  w.document.close()
  setTimeout(() => { w.print(); w.close() }, 400)
}

// ── Shared UI ────────────────────────────────────────────────────────────────

function DateFilter({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: '#64748b' }}>From</span>
      <input type="date" value={from} onChange={e => onChange(e.target.value, to)}
        style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
      <span style={{ fontSize: 13, color: '#64748b' }}>To</span>
      <input type="date" value={to} onChange={e => onChange(from, e.target.value)}
        style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
      {(from || to) && (
        <button onClick={() => onChange('', '')}
          style={{ padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#f1f5f9', fontSize: 12, cursor: 'pointer' }}>
          Clear
        </button>
      )}
    </div>
  )
}

function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? '#1e293b' }}>{value}</div>
    </div>
  )
}

function SH({ title }: { title: string }) {
  return <h3 style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 16 }}>{title}</h3>
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: (string | number | null | undefined)[][] }) {
  if (!rows.length) return <div style={{ color: '#94a3b8', fontSize: 13, padding: '12px 0' }}>No data.</div>
  return (
    <div style={{ overflowX: 'auto', marginTop: 6 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
            {headers.map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 600, fontSize: 12 }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
              {row.map((cell, j) => <td key={j} style={{ padding: '6px 10px' }}>{cell ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExportBar({ onPrint, onCSV }: { onPrint: () => void; onCSV: () => void }) {
  const s: React.CSSProperties = { padding: '5px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#f8fafc', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button style={s} onClick={onCSV}>⬇ Export CSV</button>
      <button style={s} onClick={onPrint}>🖨 Print / PDF</button>
    </div>
  )
}

function p(params: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>
}

// ── Report tabs ───────────────────────────────────────────────────────────────

function OperationsSummaryTab() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['ops-summary', from, to],
    queryFn: () => getOperationsSummary(p({ date_from: from, date_to: to })).then(r => r.data),
  })
  const handleCSV = () => { if (!data) return; downloadCSV('operations-summary.csv', ['Category', 'Item', 'Value'], [
    ['Money In','Total Sales', data.money_in.total_sales], ['Money In','Payments Received', data.money_in.total_payments_received],
    ['Money Out','Stock Purchased', data.money_out.stock_purchased], ['Money Out','Parts Cost', data.money_out.parts_cost],
    ['Money Out','External Repair', data.money_out.external_repair_cost], ['Money Out','Warehouse Expenses', data.money_out.warehouse_expenses],
    ['Money Out','Refunds Issued', data.money_out.refunds_issued], ['Money Out','Total Out', data.money_out.total],
    ['Inventory','Stock Value', data.inventory.stock_value], ['Inventory','Phones In Stock', data.inventory.phones_in_stock],
    ['Inventory','Phones In Refurb', data.inventory.phones_in_refurb], ['Inventory','Phones Sold', data.inventory.phones_sold],
    ['Financial','Est. Gross Profit', data.financial.estimated_gross_profit],
    ['Financial','Est. Net Profit', data.financial.estimated_net_profit],
    ['Financial','Outstanding Balances', data.financial.outstanding_customer_balances],
  ])}
  const handlePrint = () => { if (!data) return; printSection('Operations Summary', `
    <div class="stat-grid">
      <div class="stat"><div class="stat-label">Total Sales</div><div class="stat-value" style="color:#22c55e">₦${Number(data.money_in.total_sales).toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Payments Received</div><div class="stat-value" style="color:#22c55e">₦${Number(data.money_in.total_payments_received).toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Outstanding</div><div class="stat-value" style="color:#ef4444">₦${Number(data.financial.outstanding_customer_balances).toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Stock Purchased</div><div class="stat-value" style="color:#ef4444">₦${Number(data.money_out.stock_purchased).toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Warehouse Expenses</div><div class="stat-value" style="color:#ef4444">₦${Number(data.money_out.warehouse_expenses).toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Refunds</div><div class="stat-value" style="color:#ef4444">₦${Number(data.money_out.refunds_issued).toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Est. Gross Profit</div><div class="stat-value" style="color:#2563eb">₦${Number(data.financial.estimated_gross_profit).toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Est. Net Profit</div><div class="stat-value" style="color:#2563eb">₦${Number(data.financial.estimated_net_profit).toLocaleString()}</div></div>
      <div class="stat"><div class="stat-label">Current Stock Value</div><div class="stat-value">₦${Number(data.inventory.stock_value).toLocaleString()}</div></div>
    </div>`)}
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <DateFilter from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t)}} />
        <ExportBar onPrint={handlePrint} onCSV={handleCSV} />
      </div>
      {isLoading ? <div style={{color:'#94a3b8'}}>Loading…</div> : data && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:16 }}>
          <Card><SH title="💰 Money In" />
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <StatBox label="Total Sales" value={fmt(data.money_in.total_sales)} color="#22c55e" />
              <StatBox label="Payments Received" value={fmt(data.money_in.total_payments_received)} color="#22c55e" />
            </div>
          </Card>
          <Card><SH title="💸 Money Out" />
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <StatBox label="Stock Purchased" value={fmt(data.money_out.stock_purchased)} color="#ef4444" />
              <StatBox label="Parts Cost" value={fmt(data.money_out.parts_cost)} color="#ef4444" />
              <StatBox label="External Repair" value={fmt(data.money_out.external_repair_cost)} color="#ef4444" />
              <StatBox label="Warehouse Expenses" value={fmt(data.money_out.warehouse_expenses)} color="#ef4444" />
              <StatBox label="Refunds Issued" value={fmt(data.money_out.refunds_issued)} color="#ef4444" />
              <StatBox label="Total Out" value={fmt(data.money_out.total)} color="#dc2626" />
            </div>
          </Card>
          <Card><SH title="📦 Inventory" />
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <StatBox label="Stock Value" value={fmt(data.inventory.stock_value)} />
              <StatBox label="In Stock" value={data.inventory.phones_in_stock} />
              <StatBox label="In Refurb" value={data.inventory.phones_in_refurb} color="#f59e0b" />
              <StatBox label="Sold" value={data.inventory.phones_sold} color="#3b82f6" />
            </div>
          </Card>
          <Card><SH title="📊 Financial Summary" />
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <StatBox label="Est. Gross Profit" value={fmt(data.financial.estimated_gross_profit)} color="#2563eb" />
              <StatBox label="Est. Net Profit" value={fmt(data.financial.estimated_net_profit)} color="#2563eb" />
              <StatBox label="Outstanding Balances" value={fmt(data.financial.outstanding_customer_balances)} color="#ef4444" />
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function InventoryTab() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [status, setStatus] = useState(''); const [grade, setGrade] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['inv-report', from, to, status, grade],
    queryFn: () => getInventoryReport(p({ date_from: from, date_to: to, status: status || undefined, grade: grade || undefined })).then(r => r.data),
  })
  const sel: React.CSSProperties = { padding:'5px 8px', border:'1px solid #d1d5db', borderRadius:6, fontSize:13, background:'#fff' }
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <DateFilter from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t)}} />
          <select value={status} onChange={e=>setStatus(e.target.value)} style={sel}>
            <option value="">All Statuses</option>
            {['SELLABLE','AWAITING_REFURB','IN_REFURB','SENT_EXTERNAL','SCRAPPED','RESERVED','SOLD','RETURNED'].map(s=>(
              <option key={s} value={s}>{s.replace(/_/g,' ')}</option>
            ))}
          </select>
          <select value={grade} onChange={e=>setGrade(e.target.value)} style={sel}>
            <option value="">All Grades</option>
            <option value="A">Grade A</option><option value="B">Grade B</option><option value="C">Grade C</option>
          </select>
        </div>
        <ExportBar
          onCSV={()=>{ if(!data) return; downloadCSV('inventory.csv',['Category','Count'],[
            ['Total',data.total],['Sellable',data.sellable],['Awaiting Refurb',data.awaiting_refurb],
            ['In Refurb',data.in_refurb],['Sent External',data.sent_external],['Scrapped',data.scrapped],
            ['Reserved',data.reserved],['Sold',data.sold],['Returned',data.returned],
          ])}}
          onPrint={()=>{ if(!data) return; printSection('Inventory Report',`
            <div class="stat-grid">
              <div class="stat"><div class="stat-label">Total</div><div class="stat-value">${data.total}</div></div>
              <div class="stat"><div class="stat-label">Sellable</div><div class="stat-value" style="color:#22c55e">${data.sellable}</div></div>
              <div class="stat"><div class="stat-label">Awaiting Refurb</div><div class="stat-value" style="color:#f97316">${data.awaiting_refurb}</div></div>
              <div class="stat"><div class="stat-label">In Refurb</div><div class="stat-value" style="color:#f59e0b">${data.in_refurb}</div></div>
              <div class="stat"><div class="stat-label">Sent External</div><div class="stat-value" style="color:#8b5cf6">${data.sent_external}</div></div>
              <div class="stat"><div class="stat-label">Scrapped</div><div class="stat-value" style="color:#ef4444">${data.scrapped}</div></div>
              <div class="stat"><div class="stat-label">Reserved</div><div class="stat-value" style="color:#06b6d4">${data.reserved}</div></div>
              <div class="stat"><div class="stat-label">Sold</div><div class="stat-value" style="color:#3b82f6">${data.sold}</div></div>
              <div class="stat"><div class="stat-label">Returned</div><div class="stat-value" style="color:#ec4899">${data.returned}</div></div>
            </div>`)}}
        />
      </div>
      {isLoading ? <div style={{color:'#94a3b8'}}>Loading…</div> : data && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <StatBox label="Total Phones" value={data.total} />
            <StatBox label="Sellable" value={data.sellable} color="#22c55e" />
            <StatBox label="Awaiting Refurb" value={data.awaiting_refurb} color="#f97316" />
            <StatBox label="In Refurb" value={data.in_refurb} color="#f59e0b" />
            <StatBox label="Sent External" value={data.sent_external} color="#8b5cf6" />
            <StatBox label="Scrapped" value={data.scrapped} color="#ef4444" />
            <StatBox label="Reserved" value={data.reserved} color="#06b6d4" />
            <StatBox label="Sold" value={data.sold} color="#3b82f6" />
            <StatBox label="Returned" value={data.returned} color="#ec4899" />
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <Card><SH title="By Status" />
              <SimpleTable headers={['Status','Count']} rows={data.by_status.map((r:any)=>[r.status.replace(/_/g,' '),r.count])} />
            </Card>
            <Card><SH title="By Grade" />
              <SimpleTable headers={['Grade','Count']} rows={data.by_grade.map((r:any)=>[`Grade ${r.grade}`,r.count])} />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function PurchasesTab() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['purchase-report', from, to],
    queryFn: () => getPurchaseReport(p({ date_from: from, date_to: to })).then(r => r.data),
  })
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <DateFilter from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t)}} />
        <ExportBar
          onCSV={()=>{ if(!data) return; downloadCSV('purchases.csv',['PO #','Supplier','Date','Status','Phones','Value'],
            data.history.map((r:any)=>[r.po_number,r.supplier,r.date,r.status,r.phones,r.value]))}}
          onPrint={()=>{ if(!data) return; const rows=data.history.map((r:any)=>`<tr><td>${r.po_number}</td><td>${r.supplier}</td><td>${r.date}</td><td>${r.status}</td><td>${r.phones}</td><td>₦${Number(r.value).toLocaleString()}</td></tr>`).join('');
            printSection('Purchase Report',`<div class="stat-grid">
              <div class="stat"><div class="stat-label">Total POs</div><div class="stat-value">${data.total_pos}</div></div>
              <div class="stat"><div class="stat-label">Phones Purchased</div><div class="stat-value">${data.total_phones_purchased}</div></div>
              <div class="stat"><div class="stat-label">Total Value</div><div class="stat-value" style="color:#ef4444">₦${Number(data.total_purchase_value).toLocaleString()}</div></div>
            </div><table><thead><tr><th>PO #</th><th>Supplier</th><th>Date</th><th>Status</th><th>Phones</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`)}}
        />
      </div>
      {isLoading ? <div style={{color:'#94a3b8'}}>Loading…</div> : data && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:16}}>
            <StatBox label="Total POs" value={data.total_pos} />
            <StatBox label="Phones Purchased" value={data.total_phones_purchased} />
            <StatBox label="Total Purchase Value" value={fmt(data.total_purchase_value)} color="#ef4444" />
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <Card><SH title="Supplier Breakdown" />
              <SimpleTable headers={['Supplier','POs','Phones','Total Value']} rows={data.by_supplier.map((r:any)=>[r.supplier,r.po_count,r.phone_count,fmt(r.total_value)])} />
            </Card>
            <Card><SH title="Purchase History" />
              <SimpleTable headers={['PO #','Supplier','Date','Status','Phones','Value']} rows={data.history.map((r:any)=>[r.po_number,r.supplier,r.date,r.status,r.phones,fmt(r.value)])} />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function SalesTab() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['sales-detail', from, to],
    queryFn: () => getSalesDetailReport(p({ date_from: from, date_to: to })).then(r => r.data),
  })
  const SC: Record<string,string> = { paid:'#22c55e', partial:'#f59e0b', on_account:'#8b5cf6', unpaid:'#ef4444' }
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <DateFilter from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t)}} />
        <ExportBar
          onCSV={()=>{ if(!data) return; downloadCSV('sales-report.csv',['Invoice','Date','Customer','Salesperson','Type','Total','Paid','Balance','Status'],
            data.history.map((r:any)=>[r.invoice_number,r.date,r.customer,r.salesperson,r.type,r.total,r.amount_paid,r.balance,r.payment_status]))}}
          onPrint={()=>{ if(!data) return; const rows=data.history.slice(0,100).map((r:any)=>`<tr><td>${r.invoice_number}</td><td>${r.date}</td><td>${r.customer}</td><td>${r.salesperson}</td><td>₦${Number(r.total).toLocaleString()}</td><td>${r.payment_status}</td></tr>`).join('');
            printSection('Sales Report',`<div class="stat-grid">
              <div class="stat"><div class="stat-label">Total Invoices</div><div class="stat-value">${data.total_invoices}</div></div>
              <div class="stat"><div class="stat-label">Total Revenue</div><div class="stat-value" style="color:#22c55e">₦${Number(data.total_revenue).toLocaleString()}</div></div>
              <div class="stat"><div class="stat-label">Outstanding</div><div class="stat-value" style="color:#ef4444">₦${Number(data.outstanding_balance).toLocaleString()}</div></div>
            </div><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Salesperson</th><th>Total</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`)}}
        />
      </div>
      {isLoading ? <div style={{color:'#94a3b8'}}>Loading…</div> : data && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:16}}>
            <StatBox label="Total Invoices" value={data.total_invoices} />
            <StatBox label="Total Revenue" value={fmt(data.total_revenue)} color="#22c55e" />
            <StatBox label="Total Paid" value={fmt(data.total_paid)} color="#22c55e" />
            <StatBox label="Outstanding" value={fmt(data.outstanding_balance)} color="#ef4444" />
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
            <Card><SH title="By Payment Status" />
              {data.by_payment_status.map((r:any)=>(
                <div key={r.status} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #f1f5f9',fontSize:13}}>
                  <span style={{color:SC[r.status]??'#64748b',fontWeight:600}}>{r.status.replace(/_/g,' ').toUpperCase()}</span>
                  <span>{r.count} invoices</span>
                </div>
              ))}
            </Card>
            <Card><SH title="By Salesperson" />
              <SimpleTable headers={['Salesperson','Invoices','Total']} rows={data.by_salesperson.map((r:any)=>[r.salesperson||'Unassigned',r.count,fmt(r.total)])} />
            </Card>
          </div>
          <Card style={{marginBottom:16}}><SH title="By Customer" />
            <SimpleTable headers={['Customer','Invoices','Total','Outstanding']} rows={data.by_customer.map((r:any)=>[r.customer,r.count,fmt(r.total),fmt(r.balance)])} />
          </Card>
          <Card><SH title="Sales History" />
            <SimpleTable headers={['Invoice','Date','Customer','Salesperson','Total','Paid','Balance','Status']}
              rows={data.history.map((r:any)=>[r.invoice_number,r.date,r.customer,r.salesperson,fmt(r.total),fmt(r.amount_paid),fmt(r.balance),r.payment_status])} />
          </Card>
        </div>
      )}
    </div>
  )
}

function RefurbTab() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['refurb-report', from, to],
    queryFn: () => getRefurbReport(p({ date_from: from, date_to: to })).then(r => r.data),
  })
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <DateFilter from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t)}} />
        <ExportBar
          onCSV={()=>{ if(!data) return; downloadCSV('refurb-report.csv',['Job #','Date Opened','Date Closed','Status','Outcome','Engineer','External Cost'],
            data.history.map((r:any)=>[r.job_number,r.date_opened,r.date_closed,r.status,r.outcome,r.engineer,r.external_cost]))}}
          onPrint={()=>{ if(!data) return; const rows=data.history.slice(0,100).map((r:any)=>`<tr><td>${r.job_number}</td><td>${r.date_opened}</td><td>${r.date_closed??'—'}</td><td>${r.status}</td><td>${r.outcome??'—'}</td><td>${r.engineer}</td></tr>`).join('');
            printSection('Refurbishment Report',`<div class="stat-grid">
              <div class="stat"><div class="stat-label">Total Jobs</div><div class="stat-value">${data.total_jobs}</div></div>
              <div class="stat"><div class="stat-label">Open</div><div class="stat-value" style="color:#f59e0b">${data.open}</div></div>
              <div class="stat"><div class="stat-label">Closed</div><div class="stat-value" style="color:#22c55e">${data.closed}</div></div>
              <div class="stat"><div class="stat-label">Parts Cost</div><div class="stat-value">₦${Number(data.total_parts_cost).toLocaleString()}</div></div>
              <div class="stat"><div class="stat-label">External Cost</div><div class="stat-value">₦${Number(data.total_external_cost).toLocaleString()}</div></div>
              ${data.avg_turnaround_days!=null?`<div class="stat"><div class="stat-label">Avg Turnaround</div><div class="stat-value">${data.avg_turnaround_days} days</div></div>`:''}
            </div><table><thead><tr><th>Job #</th><th>Opened</th><th>Closed</th><th>Status</th><th>Outcome</th><th>Engineer</th></tr></thead><tbody>${rows}</tbody></table>`)}}
        />
      </div>
      {isLoading ? <div style={{color:'#94a3b8'}}>Loading…</div> : data && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <StatBox label="Total Jobs" value={data.total_jobs} />
            <StatBox label="Open" value={data.open} color="#f59e0b" />
            <StatBox label="In Progress" value={data.in_progress} color="#f97316" />
            <StatBox label="Closed" value={data.closed} color="#22c55e" />
            <StatBox label="Regraded" value={data.regraded} color="#22c55e" />
            <StatBox label="Sent External" value={data.sent_external} color="#8b5cf6" />
            <StatBox label="Scrapped" value={data.scrapped} color="#ef4444" />
            <StatBox label="Parts Cost" value={fmt(data.total_parts_cost)} color="#f59e0b" />
            <StatBox label="External Cost" value={fmt(data.total_external_cost)} color="#8b5cf6" />
            {data.avg_turnaround_days!=null && <StatBox label="Avg Turnaround" value={`${data.avg_turnaround_days} days`} />}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <Card><SH title="Parts Consumed" />
              <SimpleTable headers={['Part','Qty','Cost']} rows={data.parts_consumed.map((r:any)=>[r.name,r.qty,fmt(r.cost)])} />
            </Card>
            <Card><SH title="Job History" />
              <SimpleTable headers={['Job #','Opened','Closed','Status','Outcome','Engineer']}
                rows={data.history.map((r:any)=>[r.job_number,r.date_opened,r.date_closed,r.status,r.outcome,r.engineer])} />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function ExpensesTab() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const pp = p({ date_from: from, date_to: to })
  const { data, isLoading } = useQuery({
    queryKey: ['exp-tab', from, to],
    queryFn: async () => {
      const [list, summary] = await Promise.all([
        getExpenses(pp).then(r => r.data),
        getExpensesSummary(pp).then(r => r.data),
      ])
      return { list, summary }
    },
  })
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <DateFilter from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t)}} />
        <ExportBar
          onCSV={()=>{ if(!data) return; downloadCSV('expenses.csv',['Date','Title','Description','Amount','Branch','Entered By'],
            data.list.map((r:any)=>[r.date,r.title,r.description,r.amount,r.branch,r.entered_by?.name]))}}
          onPrint={()=>{ if(!data) return; const rows=data.list.map((r:any)=>`<tr><td>${r.date}</td><td>${r.title}</td><td>${r.description??''}</td><td>₦${Number(r.amount).toLocaleString()}</td><td>${r.branch??''}</td><td>${r.entered_by?.name??''}</td></tr>`).join('');
            printSection('Warehouse Expenses',`<div class="stat-grid">
              <div class="stat"><div class="stat-label">Total Expenses</div><div class="stat-value" style="color:#ef4444">₦${Number(data.summary?.total_expenses??0).toLocaleString()}</div></div>
              <div class="stat"><div class="stat-label">Entries</div><div class="stat-value">${data.summary?.expense_count??0}</div></div>
            </div><table><thead><tr><th>Date</th><th>Title</th><th>Description</th><th>Amount</th><th>Branch</th><th>Entered By</th></tr></thead><tbody>${rows}</tbody></table>`)}}
        />
      </div>
      {isLoading ? <div style={{color:'#94a3b8'}}>Loading…</div> : data && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:16}}>
            <StatBox label="Total Expenses" value={fmt(data.summary?.total_expenses)} color="#ef4444" />
            <StatBox label="Total Entries" value={data.summary?.expense_count??0} />
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <Card><SH title="Expense Breakdown" />
              <SimpleTable headers={['Title','Count','Total']} rows={(data.summary?.items??[]).map((r:any)=>[r.title,r.count,fmt(r.total)])} />
            </Card>
            <Card><SH title="Expense History" />
              <SimpleTable headers={['Date','Title','Amount','Branch','Entered By']}
                rows={data.list.map((r:any)=>[r.date,r.title,fmt(r.amount),r.branch,r.entered_by?.name])} />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function ReturnsTab() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['returns-detail', from, to],
    queryFn: () => getReturnsDetailReport(p({ date_from: from, date_to: to })).then(r => r.data),
  })
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <DateFilter from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t)}} />
        <ExportBar
          onCSV={()=>{ if(!data) return; downloadCSV('returns.csv',['RMA #','Date','Customer','Device IMEI','Reason','Resolution','Refund','Restock Outcome'],
            data.history.map((r:any)=>[r.rma_number,r.date,r.customer,r.device_imei,r.reason,r.resolution,r.refund_amount,r.restock_outcome]))}}
          onPrint={()=>{ if(!data) return; const rows=data.history.map((r:any)=>`<tr><td>${r.rma_number}</td><td>${r.date}</td><td>${r.customer}</td><td>${r.reason.replace(/_/g,' ')}</td><td>₦${Number(r.refund_amount).toLocaleString()}</td><td>${r.resolution}</td></tr>`).join('');
            printSection('Returns Report',`<div class="stat-grid">
              <div class="stat"><div class="stat-label">Total Returns</div><div class="stat-value">${data.total_returns}</div></div>
              <div class="stat"><div class="stat-label">Total Refunded</div><div class="stat-value" style="color:#ef4444">₦${Number(data.total_refunded).toLocaleString()}</div></div>
              <div class="stat"><div class="stat-label">Restocked</div><div class="stat-value" style="color:#22c55e">${data.restocked}</div></div>
              <div class="stat"><div class="stat-label">Scrapped</div><div class="stat-value" style="color:#ef4444">${data.scrapped_after_return}</div></div>
            </div><table><thead><tr><th>RMA #</th><th>Date</th><th>Customer</th><th>Reason</th><th>Refund</th><th>Resolution</th></tr></thead><tbody>${rows}</tbody></table>`)}}
        />
      </div>
      {isLoading ? <div style={{color:'#94a3b8'}}>Loading…</div> : data && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10,marginBottom:16}}>
            <StatBox label="Total Returns" value={data.total_returns} />
            <StatBox label="Total Refunded" value={fmt(data.total_refunded)} color="#ef4444" />
            <StatBox label="Repaired & Returned" value={data.repaired_and_returned} color="#f59e0b" />
            <StatBox label="Restocked" value={data.restocked} color="#22c55e" />
            <StatBox label="Scrapped After" value={data.scrapped_after_return} color="#ef4444" />
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <Card><SH title="By Reason" />
              <SimpleTable headers={['Reason','Count']} rows={data.by_reason.map((r:any)=>[r.reason.replace(/_/g,' '),r.count])} />
            </Card>
            <Card><SH title="By Customer" />
              <SimpleTable headers={['Customer','Returns','Total Refunded']} rows={data.by_customer.map((r:any)=>[r.customer,r.count,fmt(r.refunded)])} />
            </Card>
          </div>
          <Card style={{marginTop:16}}><SH title="Returns History" />
            <SimpleTable headers={['RMA #','Date','Customer','Device IMEI','Reason','Resolution','Refund']}
              rows={data.history.map((r:any)=>[r.rma_number,r.date,r.customer,r.device_imei,r.reason.replace(/_/g,' '),r.resolution,fmt(r.refund_amount)])} />
          </Card>
        </div>
      )}
    </div>
  )
}

function ReconciliationTab() {
  const { data, isLoading } = useQuery({ queryKey:['reconciliation'], queryFn:()=>getReconciliation().then(r=>r.data) })
  const { data:lowStock } = useQuery({ queryKey:['low-stock'], queryFn:()=>getLowStockAlerts().then(r=>r.data) })
  return (
    <div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
        <ExportBar
          onCSV={()=>{ if(!data) return; downloadCSV('reconciliation.csv',['Item','Count'],[
            ['Total Received',data.total_received],['Sellable',data.sellable],['In Refurb',data.in_refurb],
            ['Sent External',data.sent_external],['Scrapped',data.scrapped],['Sold',data.sold],
            ['Reserved',data.reserved],['Returned',data.returned],['Discrepancy',data.discrepancy],
          ])}}
          onPrint={()=>{ if(!data) return; printSection('Inventory Reconciliation',`
            <div class="stat-grid">
              <div class="stat"><div class="stat-label">Total Received</div><div class="stat-value">${data.total_received}</div></div>
              <div class="stat"><div class="stat-label">Sellable</div><div class="stat-value" style="color:#22c55e">${data.sellable}</div></div>
              <div class="stat"><div class="stat-label">In Refurb</div><div class="stat-value" style="color:#f59e0b">${data.in_refurb}</div></div>
              <div class="stat"><div class="stat-label">Sent External</div><div class="stat-value" style="color:#8b5cf6">${data.sent_external}</div></div>
              <div class="stat"><div class="stat-label">Sold</div><div class="stat-value" style="color:#3b82f6">${data.sold}</div></div>
              <div class="stat"><div class="stat-label">Scrapped</div><div class="stat-value" style="color:#ef4444">${data.scrapped}</div></div>
            </div>
            <p style="font-weight:700;color:${data.reconciled?'#22c55e':'#ef4444'}">${data.reconciled?'✅ Books balanced':`⚠️ Discrepancy: ${data.discrepancy}`}</p>`)}}
        />
      </div>
      {isLoading ? <div style={{color:'#94a3b8'}}>Loading…</div> : data && (
        <div>
          <Card style={{borderLeft:`4px solid ${data.reconciled?'#22c55e':'#ef4444'}`,marginBottom:16}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:10}}>
              <StatBox label="Total Received" value={data.total_received} />
              <StatBox label="Sellable" value={data.sellable} color="#22c55e" />
              <StatBox label="In Refurb" value={data.in_refurb} color="#f59e0b" />
              <StatBox label="Sent External" value={data.sent_external} color="#8b5cf6" />
              <StatBox label="Reserved" value={data.reserved} color="#06b6d4" />
              <StatBox label="Sold" value={data.sold} color="#3b82f6" />
              <StatBox label="Returned" value={data.returned} color="#ec4899" />
              <StatBox label="Scrapped" value={data.scrapped} color="#ef4444" />
            </div>
            <div style={{marginTop:16,fontWeight:800,fontSize:15,color:data.reconciled?'#22c55e':'#ef4444'}}>
              {data.reconciled ? '✅ Books balanced' : `⚠️ Discrepancy: ${data.discrepancy} device(s) unaccounted`}
            </div>
          </Card>
          {lowStock && (
            <Card><SH title="Low Stock Alerts" />
              {lowStock.total_alerts===0
                ? <div style={{color:'#22c55e',fontWeight:600,fontSize:14}}>✅ All parts adequately stocked</div>
                : <SimpleTable headers={['Part','On Hand','Min Level','Shortfall']}
                    rows={lowStock.alerts.map((a:any)=>[a.name,a.quantity_on_hand,a.min_stock_level,`-${a.shortfall}`])} />}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function MySalesTab() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['my-sales', from, to],
    queryFn: () => getMySales(p({ date_from: from, date_to: to })).then(r => r.data),
  })
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <DateFilter from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t)}} />
        <ExportBar
          onCSV={()=>{ if(!data) return; downloadCSV('my-sales.csv',['Invoice','Date','Customer','Total','Paid','Balance','Status'],
            data.history.map((r:any)=>[r.invoice_number,r.date,r.customer,r.total,r.amount_paid,r.balance,r.payment_status]))}}
          onPrint={()=>{}}
        />
      </div>
      {isLoading ? <div style={{color:'#94a3b8'}}>Loading…</div> : data && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
            {(['today','this_week','this_month'] as const).map(k => (
              <Card key={k} style={{textAlign:'center'}}>
                <div style={{fontSize:12,color:'#64748b',marginBottom:4}}>{k==='today'?'Today':k==='this_week'?'This Week':'This Month'}</div>
                <div style={{fontSize:24,fontWeight:800}}>{data[k].count}</div>
                <div style={{fontSize:14,color:'#22c55e',fontWeight:600}}>{fmt(data[k].value)}</div>
              </Card>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:16}}>
            <StatBox label="Total Invoices" value={data.total_invoices} />
            <StatBox label="Total Value" value={fmt(data.total_value)} color="#22c55e" />
            <StatBox label="Total Paid" value={fmt(data.total_paid)} color="#22c55e" />
            <StatBox label="Outstanding" value={fmt(data.outstanding_balance)} color="#ef4444" />
            <StatBox label="Pending Invoices" value={data.pending_invoices} color="#f59e0b" />
          </div>
          <Card><SH title="My Sales History" />
            <SimpleTable headers={['Invoice','Date','Customer','Total','Paid','Balance','Status']}
              rows={data.history.map((r:any)=>[r.invoice_number,r.date,r.customer,fmt(r.total),fmt(r.amount_paid),fmt(r.balance),r.payment_status])} />
          </Card>
        </div>
      )}
    </div>
  )
}

function MyRefurbTab() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['my-refurb', from, to],
    queryFn: () => getMyRefurb(p({ date_from: from, date_to: to })).then(r => r.data),
  })
  return (
    <div>
      <div style={{marginBottom:16}}>
        <DateFilter from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t)}} />
      </div>
      {isLoading ? <div style={{color:'#94a3b8'}}>Loading…</div> : data && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:16}}>
            <StatBox label="Total Jobs" value={data.total_jobs} />
            <StatBox label="Open" value={data.open} color="#f59e0b" />
            <StatBox label="In Progress" value={data.in_progress} color="#f97316" />
            <StatBox label="Closed" value={data.closed} color="#22c55e" />
            <StatBox label="Regraded" value={data.regraded} color="#22c55e" />
            <StatBox label="Sent External" value={data.sent_external} color="#8b5cf6" />
            <StatBox label="Scrapped" value={data.scrapped} color="#ef4444" />
            {data.avg_turnaround_days!=null && <StatBox label="Avg Turnaround" value={`${data.avg_turnaround_days} days`} />}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <Card><SH title="Parts Consumed" />
              <SimpleTable headers={['Part','Qty']} rows={data.parts_consumed.map((r:any)=>[r.name,r.qty])} />
            </Card>
            <Card><SH title="My Job History" />
              <SimpleTable headers={['Job #','Opened','Closed','Status','Outcome']}
                rows={data.history.map((r:any)=>[r.job_number,r.date_opened,r.date_closed,r.status,r.outcome])} />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { key:'operations', label:'Operations Summary', roles:['ADMIN','RECORDS'] },
  { key:'inventory',  label:'Inventory',          roles:['ADMIN','INVENTORY'] },
  { key:'purchases',  label:'Purchases',           roles:['ADMIN','INVENTORY'] },
  { key:'sales',      label:'Sales',               roles:['ADMIN','RECORDS'] },
  { key:'refurb',     label:'Refurbishment',       roles:['ADMIN','INVENTORY'] },
  { key:'expenses',   label:'Expenses',            roles:['ADMIN','RECORDS'] },
  { key:'returns',    label:'Returns',             roles:['ADMIN','RECORDS'] },
  { key:'reconciliation', label:'Reconciliation', roles:['ADMIN','INVENTORY'] },
  { key:'my_sales',   label:'My Sales',            roles:['SALES'] },
  { key:'my_refurb',  label:'My Refurb Jobs',      roles:['ENGINEER'] },
]

export default function Reports() {
  const { user } = useAuth()
  const role = user?.role ?? ''
  const visible = TABS.filter(t => t.roles.includes(role))
  const [active, setActive] = useState<string>(() => visible[0]?.key ?? '')
  const current = visible.find(t => t.key === active) ? active : visible[0]?.key ?? ''

  if (!visible.length) return (
    <div style={{ padding: 28, color: '#64748b' }}>No reports available for your role.</div>
  )

  return (
    <div style={{ padding: 28 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Reports & Analytics</h1>
      <div style={{ display:'flex', gap:2, borderBottom:'2px solid #e2e8f0', marginBottom:24, flexWrap:'wrap' }}>
        {visible.map(t => (
          <button key={t.key} onClick={() => setActive(t.key)} style={{
            padding: '8px 14px', border:'none',
            borderBottom: current===t.key ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: -2, background:'none', cursor:'pointer', fontSize:13,
            fontWeight: current===t.key ? 700 : 400,
            color: current===t.key ? '#2563eb' : '#64748b',
          }}>{t.label}</button>
        ))}
      </div>
      <div>
        {current==='operations'     && <OperationsSummaryTab />}
        {current==='inventory'      && <InventoryTab />}
        {current==='purchases'      && <PurchasesTab />}
        {current==='sales'          && <SalesTab />}
        {current==='refurb'         && <RefurbTab />}
        {current==='expenses'       && <ExpensesTab />}
        {current==='returns'        && <ReturnsTab />}
        {current==='reconciliation' && <ReconciliationTab />}
        {current==='my_sales'       && <MySalesTab />}
        {current==='my_refurb'      && <MyRefurbTab />}
      </div>
    </div>
  )
}
