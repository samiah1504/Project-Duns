import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  getReconciliation, getWIPValue, getLowStockAlerts, getSalesSummary,
  getCeoDashboard,
} from '../services/api'
import { Card, fmt } from '../components/Layout'
import { useAuth } from '../hooks/useAuth'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CeoData {
  period: { from: string; to: string }
  summary: {
    sales_today: string; sales_period: string; payments_received_period: string
    outstanding_balances: string; gross_profit_period: string; net_profit_period: string
    expenses_period: string; cogs_period: string; refunds_period: string
    inventory_value: string; phones_in_stock: number
  }
  inventory: Record<string, number>
  sales: {
    phones_sold_today: number; phones_sold_week: number; phones_sold_period: number
    wholesale_value: string; retail_value: string
    by_payment_status: Record<string, number>
    top_models: { model: string; count: number; revenue: string }[]
    top_salespersons: { name: string; count: number; revenue: string }[]
  }
  refurb: {
    awaiting: number; in_progress: number; closed_period: number
    successful_period: number; sent_external_period: number; scrapped_period: number
    avg_days: number; success_rate: number
    engineers: { name: string; closed: number; success: number }[]
  }
  purchases: {
    pending_pos: number; phones_received_period: number
    stock_purchase_value_period: string
    recent_pos: { po_number: string; date: string; status: string; items: number }[]
  }
  returns: {
    total_period: number; refunds_period: string; restocked: number
    returned_to_refurb: number; scrapped_after_return: number
    by_reason: { reason: string; count: number }[]
  }
  alerts: {
    low_stock_parts: { id: string; name: string; on_hand: number; minimum: number }[]
    long_in_refurb: number; overdue_external: number
    overdue_customer_balances: { id: string; name: string; balance: string }[]
    pending_returns_inspection: number; pending_pos: number
  }
  charts: {
    sales_trend: { date: string; revenue: string; count: number }[]
    expense_breakdown: { category: string; amount: string }[]
    refurb_outcomes: { successful: number; scrapped: number; sent_external: number; in_progress: number }
  }
}

// ── Period selector ───────────────────────────────────────────────────────────

type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

function periodDates(key: PeriodKey, customFrom: string, customTo: string): { date_from: string; date_to: string } {
  const today = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  if (key === 'today') return { date_from: fmt(today), date_to: fmt(today) }
  if (key === 'week') {
    const mon = new Date(today); mon.setDate(today.getDate() - today.getDay() + 1)
    return { date_from: fmt(mon), date_to: fmt(today) }
  }
  if (key === 'month') {
    return { date_from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), date_to: fmt(today) }
  }
  if (key === 'quarter') {
    const q = Math.floor(today.getMonth() / 3)
    return { date_from: fmt(new Date(today.getFullYear(), q * 3, 1)), date_to: fmt(today) }
  }
  if (key === 'year') {
    return { date_from: fmt(new Date(today.getFullYear(), 0, 1)), date_to: fmt(today) }
  }
  return { date_from: customFrom, date_to: customTo }
}

// ── Small components ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = '#2563eb', onClick }: {
  label: string; value: string | number; sub?: string; color?: string; onClick?: () => void
}) {
  return (
    <Card style={{ flex: 1, minWidth: 160, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{sub}</div>}
    </Card>
  )
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 28 }}>
      <h2 style={{ fontSize: 13, fontWeight: 800, color: '#475569', letterSpacing: 1, textTransform: 'uppercase', margin: 0 }}>{title}</h2>
      {action}
    </div>
  )
}

function AlertBadge({ count, label, color, onClick }: { count: number; label: string; color: string; onClick?: () => void }) {
  if (!count) return null
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
      background: color + '18', borderLeft: `4px solid ${color}`, borderRadius: 6,
      cursor: onClick ? 'pointer' : 'default', marginBottom: 8,
    }}>
      <span style={{ fontWeight: 700, fontSize: 18, color }}>{count}</span>
      <span style={{ fontSize: 13, color: '#374151' }}>{label}</span>
    </div>
  )
}

// ── SVG Charts ────────────────────────────────────────────────────────────────

function SalesTrendChart({ data }: { data: { date: string; revenue: string; count: number }[] }) {
  if (!data || data.length === 0) return <div style={{ color: '#94a3b8', fontSize: 13, padding: 20 }}>No data</div>
  const values = data.map(d => parseFloat(d.revenue))
  const maxVal = Math.max(...values, 1)
  const W = 560, H = 120, pad = 8
  const pts = data.map((d, i) => {
    const x = pad + (i / Math.max(data.length - 1, 1)) * (W - pad * 2)
    const y = H - pad - ((parseFloat(d.revenue) / maxVal) * (H - pad * 2))
    return { x, y, d }
  })
  const polyline = pts.map(p => `${p.x},${p.y}`).join(' ')
  const area = `${pts[0]?.x},${H} ` + polyline + ` ${pts[pts.length - 1]?.x},${H}`

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H + 24} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#trendGrad)" />
        <polyline points={polyline} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill="#3b82f6" />
            {data.length <= 12 && (
              <text x={p.x} y={H + 18} textAnchor="middle" fontSize={9} fill="#94a3b8">
                {p.d.date.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (!total) return <div style={{ color: '#94a3b8', fontSize: 13, padding: 20 }}>No data</div>
  const R = 50, cx = 60, cy = 60, strokeW = 20
  let offset = 0
  const circ = 2 * Math.PI * R

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width={120} height={120}>
        {data.map((d, i) => {
          const pct = d.value / total
          const dashArray = `${pct * circ} ${circ}`
          const dashOffset = -offset * circ
          offset += pct
          return (
            <circle key={i} cx={cx} cy={cy} r={R}
              fill="none" stroke={d.color} strokeWidth={strokeW}
              strokeDasharray={dashArray} strokeDashoffset={dashOffset}
              style={{ transformOrigin: `${cx}px ${cy}px`, transform: 'rotate(-90deg)' }}
            />
          )
        })}
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1e293b">{total}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <span style={{ color: '#374151' }}>{d.label}</span>
            <span style={{ color: '#64748b', marginLeft: 'auto' }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BarChart({ data }: { data: { label: string; amount: string }[] }) {
  if (!data || data.length === 0) return <div style={{ color: '#94a3b8', fontSize: 13 }}>No data</div>
  const values = data.map(d => parseFloat(d.amount))
  const maxVal = Math.max(...values, 1)
  const COLORS = ['#3b82f6','#f59e0b','#22c55e','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <div style={{ width: 100, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#374151', flexShrink: 0 }}>{d.label}</div>
          <div style={{ flex: 1, height: 14, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(parseFloat(d.amount) / maxVal) * 100}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 3 }} />
          </div>
          <div style={{ width: 80, textAlign: 'right', color: '#64748b', flexShrink: 0 }}>{fmt(d.amount)}</div>
        </div>
      ))}
    </div>
  )
}

// ── Simple dashboard for non-admin roles ──────────────────────────────────────

function SimpleDashboard() {
  const { user } = useAuth()
  const showFinancials = user?.role === 'ADMIN' || user?.role === 'RECORDS'
  const recon = useQuery({ queryKey: ['reconciliation'], queryFn: () => getReconciliation().then(r => r.data) })
  const wip = useQuery({ queryKey: ['wip'], queryFn: () => getWIPValue().then(r => r.data), enabled: showFinancials })
  const alerts = useQuery({ queryKey: ['low-stock'], queryFn: () => getLowStockAlerts().then(r => r.data) })
  const sales = useQuery({ queryKey: ['sales-summary'], queryFn: () => getSalesSummary().then(r => r.data), enabled: showFinancials })

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Dashboard</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 4 }}>Welcome back, {user?.name}</p>
      </div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#475569', marginBottom: 12 }}>INVENTORY STATUS</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatCard label="Sellable" value={recon.data?.sellable ?? '—'} color="#22c55e" />
          <StatCard label="In Refurb" value={recon.data?.in_refurb ?? '—'} color="#f59e0b" />
          <StatCard label="Reserved" value={recon.data?.reserved ?? '—'} color="#06b6d4" />
          <StatCard label="Sold" value={recon.data?.sold ?? '—'} color="#3b82f6" />
          <StatCard label="Scrapped" value={recon.data?.scrapped ?? '—'} color="#ef4444" />
          <StatCard label="Sent External" value={recon.data?.sent_external ?? '—'} color="#8b5cf6" />
        </div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <Card style={{ borderLeft: `4px solid ${recon.data?.reconciled ? '#22c55e' : '#ef4444'}`, padding: '14px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20 }}>{recon.data?.reconciled ? '✅' : '⚠️'}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {recon.data?.reconciled ? 'Books reconciled' : 'Reconciliation discrepancy!'}
              </div>
              <div style={{ color: '#64748b', fontSize: 13 }}>
                Total received: {recon.data?.total_received ?? '—'} devices
                {recon.data && !recon.data.reconciled && ` · Discrepancy: ${recon.data.discrepancy}`}
              </div>
            </div>
          </div>
        </Card>
      </div>
      {showFinancials && (
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#475569', marginBottom: 12 }}>FINANCIALS</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <StatCard label="WIP Value (bench)" value={wip.data ? fmt(wip.data.total_wip_value) : '—'} color="#f59e0b" />
            <StatCard label="Total Revenue" value={sales.data ? fmt(sales.data.total_revenue) : '—'} color="#22c55e" />
            <StatCard label="Outstanding" value={sales.data ? fmt(sales.data.outstanding_balance) : '—'} color="#ef4444" />
            <StatCard label="Wholesale Rev" value={sales.data ? fmt(sales.data.wholesale_revenue) : '—'} color="#3b82f6" />
          </div>
        </div>
      )}
      {alerts.data?.total_alerts > 0 && (
        <Card style={{ borderLeft: '4px solid #f59e0b' }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#92400e' }}>
            ⚠️ {alerts.data.total_alerts} parts below minimum stock
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {alerts.data.alerts.map((a: { part_id: string; name: string; quantity_on_hand: number; min_stock_level: number }) => (
              <span key={a.part_id} style={{
                background: '#fef3c7', color: '#92400e', padding: '4px 10px',
                borderRadius: 4, fontSize: 12, fontWeight: 600,
              }}>
                {a.name}: {a.quantity_on_hand}/{a.min_stock_level}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ── CEO Dashboard ─────────────────────────────────────────────────────────────

function CeoDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const params = useMemo(() => {
    const { date_from, date_to } = periodDates(period, customFrom, customTo)
    if (!date_from || !date_to) return undefined
    return { date_from, date_to }
  }, [period, customFrom, customTo])

  const { data, isLoading, error } = useQuery<CeoData>({
    queryKey: ['ceo-dashboard', params],
    queryFn: () => getCeoDashboard(params).then(r => r.data),
    staleTime: 60_000,
    retry: 1,
  })

  const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'quarter', label: 'Quarter' },
    { key: 'year', label: 'Year' },
    { key: 'custom', label: 'Custom' },
  ]

  return (
    <div style={{ padding: 28, maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>CEO Dashboard</h1>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 4 }}>Welcome back, {user?.name}</p>
        </div>

        {/* Period selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 8, padding: 3, gap: 2 }}>
            {PERIOD_OPTIONS.map(opt => (
              <button key={opt.key} onClick={() => setPeriod(opt.key)} style={{
                padding: '6px 14px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600,
                background: period === opt.key ? '#fff' : 'transparent',
                color: period === opt.key ? '#1e293b' : '#64748b',
                boxShadow: period === opt.key ? '0 1px 4px #0002' : 'none',
                cursor: 'pointer',
              }}>{opt.label}</button>
            ))}
          </div>
          {period === 'custom' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }} />
              <span style={{ color: '#94a3b8' }}>–</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }} />
            </div>
          )}
        </div>
      </div>

      {isLoading && <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>Loading dashboard…</div>}
      {error && <div style={{ color: '#ef4444', padding: 20 }}>Failed to load dashboard data.</div>}

      {data && (
        <>
          {/* ── Summary Cards ── */}
          <SectionHeader title="Summary" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <StatCard label="Sales (Period)" value={fmt(data.summary.sales_period)} color="#22c55e"
              sub={`Today: ${fmt(data.summary.sales_today)}`}
              onClick={() => navigate('/sales')} />
            <StatCard label="Payments Received" value={fmt(data.summary.payments_received_period)} color="#3b82f6"
              onClick={() => navigate('/sales')} />
            <StatCard label="Outstanding Balances" value={fmt(data.summary.outstanding_balances)} color="#ef4444"
              onClick={() => navigate('/customers')} />
            <StatCard label="Gross Profit" value={fmt(data.summary.gross_profit_period)} color="#22c55e"
              sub={`COGS: ${fmt(data.summary.cogs_period)}`} />
            <StatCard label="Net Profit" value={fmt(data.summary.net_profit_period)} color="#0f172a"
              sub={`Expenses: ${fmt(data.summary.expenses_period)} · Refunds: ${fmt(data.summary.refunds_period)}`} />
            <StatCard label="Inventory Value" value={fmt(data.summary.inventory_value)} color="#8b5cf6"
              sub={`${data.summary.phones_in_stock} phones in stock`}
              onClick={() => navigate('/devices')} />
          </div>

          {/* ── Inventory Overview ── */}
          <SectionHeader title="Inventory" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <StatCard label="Sellable" value={data.inventory.sellable ?? 0} color="#22c55e"
              onClick={() => navigate('/devices?status=SELLABLE')} />
            <StatCard label="Awaiting Refurb" value={data.inventory.awaiting_refurb ?? 0} color="#f59e0b"
              onClick={() => navigate('/devices?status=AWAITING_REFURB')} />
            <StatCard label="In Refurb" value={data.inventory.in_refurb ?? 0} color="#f97316"
              onClick={() => navigate('/refurb-jobs')} />
            <StatCard label="Sent External" value={data.inventory.sent_external ?? 0} color="#8b5cf6"
              onClick={() => navigate('/devices?status=SENT_EXTERNAL')} />
            <StatCard label="Reserved" value={data.inventory.reserved ?? 0} color="#06b6d4"
              onClick={() => navigate('/devices?status=RESERVED')} />
            <StatCard label="Returned" value={data.inventory.returned ?? 0} color="#ec4899"
              onClick={() => navigate('/returns')} />
            <StatCard label="Scrapped" value={data.inventory.scrapped ?? 0} color="#ef4444"
              onClick={() => navigate('/devices?status=SCRAPPED')} />
            <StatCard label="Sold (All Time)" value={data.inventory.sold ?? 0} color="#3b82f6"
              onClick={() => navigate('/sales')} />
          </div>

          {/* ── Sales Overview ── */}
          <SectionHeader title="Sales" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard label="Phones Sold (Period)" value={data.sales.phones_sold_period} color="#3b82f6"
              sub={`Today: ${data.sales.phones_sold_today} · Week: ${data.sales.phones_sold_week}`}
              onClick={() => navigate('/sales')} />
            <StatCard label="Wholesale Revenue" value={fmt(data.sales.wholesale_value)} color="#22c55e"
              onClick={() => navigate('/sales?type=WHOLESALE')} />
            <StatCard label="Retail Revenue" value={fmt(data.sales.retail_value)} color="#0ea5e9"
              onClick={() => navigate('/sales?type=RETAIL')} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            {/* Payment status */}
            <Card>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#475569' }}>PAYMENT STATUS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(data.sales.by_payment_status).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: '#374151' }}>{k}</span>
                    <span style={{ fontWeight: 700 }}>{v}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Top models */}
            <Card>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#475569' }}>TOP MODELS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.sales.top_models.slice(0, 6).map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{m.model}</span>
                    <span style={{ color: '#64748b', marginLeft: 8 }}>{m.count} · {fmt(m.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Top salespersons */}
            <Card>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#475569' }}>TOP SALESPERSONS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.sales.top_salespersons.slice(0, 6).map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: '#374151' }}>{s.name || '(unassigned)'}</span>
                    <span style={{ color: '#64748b' }}>{s.count} · {fmt(s.revenue)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Sales trend chart */}
          <Card style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#475569' }}>SALES TREND</div>
            <SalesTrendChart data={data.charts.sales_trend} />
          </Card>

          {/* ── Refurb Overview ── */}
          <SectionHeader title="Refurbishment" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard label="Awaiting Refurb" value={data.refurb.awaiting} color="#f59e0b"
              onClick={() => navigate('/devices?status=AWAITING_REFURB')} />
            <StatCard label="In Progress" value={data.refurb.in_progress} color="#f97316"
              onClick={() => navigate('/refurb-jobs')} />
            <StatCard label="Closed (Period)" value={data.refurb.closed_period} color="#22c55e"
              sub={`${data.refurb.success_rate}% success rate`}
              onClick={() => navigate('/refurb-jobs')} />
            <StatCard label="Avg. Days in Refurb" value={data.refurb.avg_days} color="#64748b" />
            <StatCard label="Scrapped (Period)" value={data.refurb.scrapped_period} color="#ef4444"
              onClick={() => navigate('/devices?status=SCRAPPED')} />
            <StatCard label="Sent External (Period)" value={data.refurb.sent_external_period} color="#8b5cf6"
              onClick={() => navigate('/devices?status=SENT_EXTERNAL')} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <Card>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#475569' }}>REFURB OUTCOMES</div>
              <DonutChart data={[
                { label: 'Successful', value: data.refurb.successful_period, color: '#22c55e' },
                { label: 'Scrapped', value: data.refurb.scrapped_period, color: '#ef4444' },
                { label: 'Sent External', value: data.refurb.sent_external_period, color: '#8b5cf6' },
                { label: 'In Progress', value: data.refurb.in_progress + data.refurb.awaiting, color: '#f59e0b' },
              ].filter(d => d.value > 0)} />
            </Card>

            <Card>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#475569' }}>ENGINEER PERFORMANCE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.refurb.engineers.slice(0, 8).map((e, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: '#374151' }}>{e.name}</span>
                    <span style={{ color: '#64748b' }}>{e.closed} closed · {e.success} success</span>
                  </div>
                ))}
                {data.refurb.engineers.length === 0 && <span style={{ color: '#94a3b8', fontSize: 13 }}>No completed jobs in period</span>}
              </div>
            </Card>
          </div>

          {/* ── Purchases Overview ── */}
          <SectionHeader title="Purchases" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard label="Pending POs" value={data.purchases.pending_pos} color="#f59e0b"
              onClick={() => navigate('/purchase-orders?status=pending')} />
            <StatCard label="Phones Received (Period)" value={data.purchases.phones_received_period} color="#3b82f6"
              onClick={() => navigate('/purchase-orders')} />
            <StatCard label="Stock Purchase Value" value={fmt(data.purchases.stock_purchase_value_period)} color="#8b5cf6" />
          </div>

          {data.purchases.recent_pos.length > 0 && (
            <Card>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#475569' }}>RECENT PURCHASE ORDERS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.purchases.recent_pos.map((po, i) => (
                  <div key={i} onClick={() => navigate('/purchase-orders')}
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ fontWeight: 600, color: '#374151' }}>{po.po_number}</span>
                    <span style={{ color: '#64748b' }}>{po.date} · {po.items} items</span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                      background: po.status === 'received' ? '#dcfce7' : '#fef3c7',
                      color: po.status === 'received' ? '#16a34a' : '#92400e',
                    }}>{po.status.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Returns Overview ── */}
          <SectionHeader title="Returns" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard label="Total Returns (Period)" value={data.returns.total_period} color="#ec4899"
              onClick={() => navigate('/returns')} />
            <StatCard label="Refunds Issued" value={fmt(data.returns.refunds_period)} color="#ef4444"
              onClick={() => navigate('/returns')} />
            <StatCard label="Restocked" value={data.returns.restocked} color="#22c55e"
              onClick={() => navigate('/returns')} />
            <StatCard label="Returned to Refurb" value={data.returns.returned_to_refurb} color="#f59e0b"
              onClick={() => navigate('/refurb-jobs')} />
            <StatCard label="Scrapped After Return" value={data.returns.scrapped_after_return} color="#ef4444"
              onClick={() => navigate('/returns')} />
          </div>

          {data.returns.by_reason.length > 0 && (
            <Card>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#475569' }}>RETURNS BY REASON</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {data.returns.by_reason.map((r, i) => (
                  <span key={i} style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                    background: '#fce7f3', color: '#9d174d',
                  }}>{r.reason}: {r.count}</span>
                ))}
              </div>
            </Card>
          )}

          {/* ── Expenses ── */}
          {data.charts.expense_breakdown.length > 0 && (
            <>
              <SectionHeader title="Expense Breakdown" />
              <Card>
                <BarChart data={data.charts.expense_breakdown.map(e => ({ label: e.category, amount: e.amount }))} />
              </Card>
            </>
          )}

          {/* ── Alerts ── */}
          <SectionHeader title="Alerts & Actions Required" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            <div>
              <AlertBadge count={data.alerts.low_stock_parts.length} label="parts below minimum stock" color="#f59e0b"
                onClick={() => navigate('/parts')} />
              <AlertBadge count={data.alerts.long_in_refurb} label="devices >7 days in refurb" color="#f97316"
                onClick={() => navigate('/refurb-jobs')} />
              <AlertBadge count={data.alerts.overdue_external} label="external repairs >14 days" color="#ef4444"
                onClick={() => navigate('/devices?status=SENT_EXTERNAL')} />
              <AlertBadge count={data.alerts.pending_returns_inspection} label="returns awaiting inspection" color="#8b5cf6"
                onClick={() => navigate('/returns')} />
              <AlertBadge count={data.alerts.pending_pos} label="purchase orders pending" color="#06b6d4"
                onClick={() => navigate('/purchase-orders')} />
            </div>

            {data.alerts.overdue_customer_balances.length > 0 && (
              <Card style={{ borderLeft: '4px solid #ef4444' }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: '#b91c1c' }}>
                  OVERDUE BALANCES ({data.alerts.overdue_customer_balances.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.alerts.overdue_customer_balances.slice(0, 6).map(c => (
                    <div key={c.id} onClick={() => navigate(`/customers/${c.id}`)}
                      style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, cursor: 'pointer' }}>
                      <span style={{ color: '#374151' }}>{c.name}</span>
                      <span style={{ fontWeight: 700, color: '#ef4444' }}>{fmt(c.balance)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {data.alerts.low_stock_parts.length > 0 && (
              <Card style={{ borderLeft: '4px solid #f59e0b' }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: '#92400e' }}>
                  LOW STOCK PARTS ({data.alerts.low_stock_parts.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {data.alerts.low_stock_parts.slice(0, 10).map(p => (
                    <span key={p.id} onClick={() => navigate('/parts')}
                      style={{
                        background: '#fef3c7', color: '#92400e', padding: '3px 10px',
                        borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}>
                      {p.name}: {p.on_hand}/{p.minimum}
                    </span>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth()
  if (user?.role === 'ADMIN') return <CeoDashboard />
  return <SimpleDashboard />
}
