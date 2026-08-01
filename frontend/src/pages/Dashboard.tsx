import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  getReconciliation, getWIPValue, getLowStockAlerts, getSalesSummary,
  getCeoDashboard, getDeviceDashboardCounts,
} from '../services/api'
import { Card, fmt } from '../components/Layout'
import { useAuth } from '../hooks/useAuth'

// ── Shared StatCard ───────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color = '#2563eb', onClick,
}: {
  label: string; value: string | number; sub?: string; color?: string; onClick?: () => void
}) {
  return (
    <Card
      style={{ flex: 1, minWidth: 170, cursor: onClick ? 'pointer' : 'default', transition: 'box-shadow .15s' }}
      onClick={onClick}
    >
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>{sub}</div>}
    </Card>
  )
}

// ── Section heading ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: '#94a3b8',
        textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0',
        paddingBottom: 8, marginBottom: 16,
      }}>{title}</div>
      {children}
    </div>
  )
}

// ── Row of cards ─────────────────────────────────────────────────────────────

function CardRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{children}</div>
}

// ── Alert row ────────────────────────────────────────────────────────────────

function AlertRow({ icon, count, label, color, onClick }: {
  icon: string; count: number; label: string; color: string; onClick?: () => void
}) {
  if (!count) return null
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
      background: color + '14', border: `1px solid ${color}40`, borderLeft: `4px solid ${color}`,
      borderRadius: 6, cursor: onClick ? 'pointer' : 'default', marginBottom: 8,
    }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontWeight: 800, fontSize: 16, color }}>{count}</span>
      <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>{label}</span>
      {onClick && <span style={{ color: '#94a3b8', fontSize: 12 }}>View →</span>}
    </div>
  )
}

// ── Period selector ───────────────────────────────────────────────────────────

type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

function periodDates(key: PeriodKey, cf: string, ct: string): { date_from: string; date_to: string } {
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  if (key === 'today') return { date_from: iso(today), date_to: iso(today) }
  if (key === 'week') {
    const mon = new Date(today)
    mon.setDate(today.getDate() - today.getDay() + 1)
    return { date_from: iso(mon), date_to: iso(today) }
  }
  if (key === 'month') return { date_from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), date_to: iso(today) }
  if (key === 'quarter') {
    const q = Math.floor(today.getMonth() / 3)
    return { date_from: iso(new Date(today.getFullYear(), q * 3, 1)), date_to: iso(today) }
  }
  if (key === 'year') return { date_from: iso(new Date(today.getFullYear(), 0, 1)), date_to: iso(today) }
  return { date_from: cf, date_to: ct }
}

// ── SVG Line/Area Chart ───────────────────────────────────────────────────────

function LineChart({
  series, height = 130,
}: {
  series: { label: string; color: string; values: number[] }[]
  labels?: string[]
  height?: number
}) {
  const allVals = series.flatMap(s => s.values)
  const maxVal = Math.max(...allVals, 1)
  const n = Math.max(...series.map(s => s.values.length), 2)
  const W = 560, H = height, pad = 10

  const pts = (vals: number[]) =>
    vals.map((v, i) => {
      const x = pad + (i / (n - 1)) * (W - pad * 2)
      const y = H - pad - (v / maxVal) * (H - pad * 2)
      return `${x},${y}`
    }).join(' ')

  const area = (vals: number[], color: string, idx: number) => {
    const points = vals.map((v, i) => ({
      x: pad + (i / (n - 1)) * (W - pad * 2),
      y: H - pad - (v / maxVal) * (H - pad * 2),
    }))
    const line = points.map(p => `${p.x},${p.y}`).join(' ')
    const fill = `${points[0]?.x},${H} ` + line + ` ${points[points.length - 1]?.x},${H}`
    return (
      <g key={idx}>
        <defs>
          <linearGradient id={`g${idx}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={fill} fill={`url(#g${idx})`} />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />)}
      </g>
    )
  }

  if (allVals.length === 0) return <div style={{ color: '#94a3b8', fontSize: 13, padding: 16 }}>No data for period</div>

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={W} height={H} style={{ display: 'block' }}>
          {series.map((s, i) => area(s.values, s.color, i))}
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        {series.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <div style={{ width: 12, height: 3, background: s.color, borderRadius: 2 }} />
            <span style={{ color: '#64748b' }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Donut Chart ───────────────────────────────────────────────────────────────

function DonutChart({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const total = slices.reduce((s, d) => s + d.value, 0)
  if (!total) return <div style={{ color: '#94a3b8', fontSize: 13 }}>No data</div>
  const R = 48, cx = 56, cy = 56, sw = 18, circ = 2 * Math.PI * R
  let off = 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width={112} height={112}>
        {slices.filter(s => s.value > 0).map((s, i) => {
          const pct = s.value / total
          const da = `${pct * circ} ${circ}`
          const cur = off
          off += pct
          return (
            <circle key={i} cx={cx} cy={cy} r={R} fill="none" stroke={s.color} strokeWidth={sw}
              strokeDasharray={da} strokeDashoffset={-cur * circ}
              style={{ transformOrigin: `${cx}px ${cy}px`, transform: 'rotate(-90deg)' }} />
          )
        })}
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight="800" fill="#1e293b">{total}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {slices.filter(s => s.value > 0).map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: '#374151' }}>{s.label}</span>
            <span style={{ marginLeft: 8, fontWeight: 700, color: '#1e293b' }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Horizontal Bar Chart ──────────────────────────────────────────────────────

function HBar({ rows, valueLabel = '' }: { rows: { label: string; value: number; color?: string }[]; valueLabel?: string }) {
  const max = Math.max(...rows.map(r => r.value), 1)
  const COLORS = ['#3b82f6','#f59e0b','#22c55e','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6']
  if (!rows.length) return <div style={{ color: '#94a3b8', fontSize: 13 }}>No data</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <div style={{ width: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#374151', flexShrink: 0 }}>{r.label}</div>
          <div style={{ flex: 1, height: 14, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: r.color || COLORS[i % COLORS.length], borderRadius: 3, transition: 'width .4s' }} />
          </div>
          <div style={{ width: 60, textAlign: 'right', color: '#64748b', flexShrink: 0, fontWeight: 600 }}>{valueLabel === '₦' ? fmt(r.value) : r.value}</div>
        </div>
      ))}
    </div>
  )
}

// ── Table helper ──────────────────────────────────────────────────────────────

function MiniTable({ cols, rows }: { cols: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return <div style={{ color: '#94a3b8', fontSize: 13 }}>No data for period</div>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>{cols.map((c, i) => (
          <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '6px 8px', color: '#94a3b8', fontSize: 11, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>{c}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
            {row.map((cell, j) => (
              <td key={j} style={{ padding: '7px 8px', textAlign: j === 0 ? 'left' : 'right', color: j === 0 ? '#374151' : '#64748b', fontWeight: j === 0 ? 600 : 400 }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── P&L Panel ────────────────────────────────────────────────────────────────

function PLPanel({ d }: { d: CeoData }) {
  const s = d.summary
  const rows: { label: string; value: string; indent?: boolean; bold?: boolean; positive?: boolean; negative?: boolean }[] = [
    { label: 'Total Revenue', value: fmt(s.sales_period), bold: true, positive: true },
    { label: 'Less: Cost of Goods Sold (COGS)', value: `(${fmt(s.cogs_period)})`, indent: true, negative: true },
    { label: '   Purchase cost of phones sold', value: '', indent: true },
    { label: '   Parts & external refurb costs', value: '', indent: true },
    { label: 'Gross Profit', value: fmt(s.gross_profit_period), bold: true, positive: true },
    { label: 'Less: Operating Expenses', value: `(${fmt(s.expenses_period)})`, indent: true, negative: true },
    { label: 'Less: Refunds Issued', value: `(${fmt(s.refunds_period)})`, indent: true, negative: true },
    { label: 'Net Profit', value: fmt(s.net_profit_period), bold: true, positive: parseFloat(s.net_profit_period) >= 0, negative: parseFloat(s.net_profit_period) < 0 },
  ]
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: r.bold ? '2px solid #e2e8f0' : '1px solid #f8fafc', background: r.bold ? '#f8fafc' : 'transparent' }}>
            <td style={{ padding: '8px 10px', color: r.bold ? '#1e293b' : r.indent ? '#64748b' : '#374151', fontWeight: r.bold ? 800 : 400, paddingLeft: r.indent ? 24 : 10 }}>{r.label}</td>
            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: r.bold ? 800 : 600, color: r.bold ? (r.positive ? '#16a34a' : '#dc2626') : r.positive ? '#16a34a' : r.negative ? '#dc2626' : '#64748b' }}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

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
    avg_days: number | null; success_rate: number | null
    engineers: { name: string; closed: number; success: number }[]
  }
  purchases: {
    pending_pos: number; phones_received_period: number
    parts_purchased_period: number; parts_purchase_value_period: string
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
    reserved_phones: number; recon_mismatch: boolean
  }
  charts: {
    sales_trend: { date: string; revenue: string; count: number }[]
    expense_breakdown: { category: string; amount: string }[]
    refurb_outcomes: { successful: number; scrapped: number; sent_external: number; in_progress: number }
    received_vs_sold: { date: string; received: number; sold: number }[]
    returns_trend: { date: string; count: number }[]
    profit_trend: { date: string; revenue: string; gross_profit: string; net_profit: string }[]
  }
}

// ── CEO Dashboard ─────────────────────────────────────────────────────────────

const PERIOD_OPTS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
  { key: 'custom', label: 'Custom' },
]

function CeoDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [cf, setCf] = useState('')
  const [ct, setCt] = useState('')

  const params = useMemo(() => {
    const { date_from, date_to } = periodDates(period, cf, ct)
    if (!date_from || !date_to) return undefined
    return { date_from, date_to }
  }, [period, cf, ct])

  const periodLabel = PERIOD_OPTS.find(o => o.key === period)?.label ?? ''

  const { data, isLoading, error } = useQuery<CeoData>({
    queryKey: ['ceo-dashboard', params],
    queryFn: () => getCeoDashboard(params).then(r => r.data),
    staleTime: 60_000,
    retry: 1,
  })

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 4 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: '#0f172a' }}>CEO Dashboard</h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: '4px 0 0' }}>Welcome back, {user?.name} · {periodLabel}</p>
        </div>

        {/* Period selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 8, padding: 3, gap: 2 }}>
            {PERIOD_OPTS.map(opt => (
              <button key={opt.key} onClick={() => setPeriod(opt.key)} style={{
                padding: '6px 14px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600,
                background: period === opt.key ? '#fff' : 'transparent',
                color: period === opt.key ? '#0f172a' : '#64748b',
                boxShadow: period === opt.key ? '0 1px 4px #0002' : 'none',
                cursor: 'pointer',
              }}>{opt.label}</button>
            ))}
          </div>
          {period === 'custom' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={cf} onChange={e => setCf(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }} />
              <span style={{ color: '#94a3b8' }}>–</span>
              <input type="date" value={ct} onChange={e => setCt(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }} />
            </div>
          )}
        </div>
      </div>

      {isLoading && (
        <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 15 }}>Loading dashboard…</div>
      )}
      {error && (
        <div style={{ padding: 20, color: '#ef4444', background: '#fef2f2', borderRadius: 8, marginTop: 20 }}>
          Failed to load dashboard data. Make sure you are logged in as Admin.
        </div>
      )}

      {data && (() => {
        const s = data.summary
        const inv = data.inventory
        const sl = data.sales
        const rf = data.refurb
        const pu = data.purchases
        const re = data.returns
        const al = data.alerts
        const ch = data.charts

        const totalAlerts =
          al.low_stock_parts.length + al.long_in_refurb + al.overdue_external +
          al.overdue_customer_balances.length + al.pending_returns_inspection +
          al.pending_pos + (al.recon_mismatch ? 1 : 0)

        return (
          <>
            {/* ── Top Summary ── */}
            <Section title="Summary">
              <CardRow>
                <StatCard
                  label="Sales Today"
                  value={fmt(s.sales_today)}
                  color="#22c55e"
                  onClick={() => navigate('/sales')}
                />
                <StatCard
                  label={`Sales — ${periodLabel}`}
                  value={fmt(s.sales_period)}
                  sub={`${sl.phones_sold_period} phones sold`}
                  color="#16a34a"
                  onClick={() => navigate('/sales')}
                />
                <StatCard
                  label="Payments Received"
                  value={fmt(s.payments_received_period)}
                  color="#3b82f6"
                  onClick={() => navigate('/sales')}
                />
                <StatCard
                  label="Outstanding Balances"
                  value={fmt(s.outstanding_balances)}
                  color="#ef4444"
                  sub="All customers with debt"
                  onClick={() => navigate('/customers')}
                />
                <StatCard
                  label="Gross Profit"
                  value={fmt(s.gross_profit_period)}
                  sub={`COGS: ${fmt(s.cogs_period)}`}
                  color={parseFloat(s.gross_profit_period) >= 0 ? '#22c55e' : '#ef4444'}
                />
                <StatCard
                  label="Net Profit"
                  value={fmt(s.net_profit_period)}
                  sub={`Expenses: ${fmt(s.expenses_period)} · Refunds: ${fmt(s.refunds_period)}`}
                  color={parseFloat(s.net_profit_period) >= 0 ? '#0f172a' : '#ef4444'}
                />
                <StatCard
                  label="Warehouse Expenses"
                  value={fmt(s.expenses_period)}
                  color="#f59e0b"
                  onClick={() => navigate('/expenses')}
                />
                <StatCard
                  label="Inventory Value"
                  value={fmt(s.inventory_value)}
                  sub={`${s.phones_in_stock} phones in stock`}
                  color="#8b5cf6"
                  onClick={() => navigate('/devices')}
                />
              </CardRow>
            </Section>

            {/* ── Profit & Loss ── */}
            <Section title="Profit & Loss Statement">
              <Card>
                <PLPanel d={data} />
              </Card>
            </Section>

            {/* ── Inventory Overview ── */}
            <Section title="Inventory Overview">
              <CardRow>
                <StatCard label="Sellable" value={inv.sellable ?? 0} color="#22c55e"
                  onClick={() => navigate('/sellable')} />
                <StatCard label="Awaiting Refurb" value={inv.awaiting_refurb ?? 0} color="#f59e0b"
                  onClick={() => navigate('/refurb')} />
                <StatCard label="In Refurb (Bench)" value={inv.in_refurb ?? 0} color="#f97316"
                  onClick={() => navigate('/refurb')} />
                <StatCard label="Awaiting QC" value={inv.awaiting_qc ?? 0} color="#7c3aed"
                  onClick={() => navigate('/refurb')} />
                <StatCard label="Sent External" value={inv.sent_external ?? 0} color="#8b5cf6"
                  onClick={() => navigate('/all-devices')} />
                <StatCard label="Reserved" value={inv.reserved ?? 0} color="#06b6d4"
                  onClick={() => navigate('/sellable')} />
                <StatCard label="Stock to Return" value={inv.stock_to_return ?? 0} color="#dc2626"
                  onClick={() => navigate('/stock-to-return')} />
                <StatCard label="Harvested" value={inv.harvested ?? 0} color="#065f46"
                  onClick={() => navigate('/harvested')} />
                <StatCard label="Returned" value={inv.returned ?? 0} color="#ec4899"
                  onClick={() => navigate('/returns')} />
                <StatCard label="Sold (All Time)" value={inv.sold ?? 0} color="#3b82f6"
                  onClick={() => navigate('/sales')} />
              </CardRow>
            </Section>

            {/* ── Sales Overview ── */}
            <Section title="Sales Overview">
              <CardRow>
                <StatCard label="Phones Sold Today" value={sl.phones_sold_today} color="#22c55e"
                  onClick={() => navigate('/sales')} />
                <StatCard label="Phones Sold This Week" value={sl.phones_sold_week} color="#3b82f6"
                  onClick={() => navigate('/sales')} />
                <StatCard label={`Phones Sold — ${periodLabel}`} value={sl.phones_sold_period} color="#0f172a"
                  onClick={() => navigate('/sales')} />
                <StatCard label="Wholesale Value" value={fmt(sl.wholesale_value)} color="#16a34a"
                  onClick={() => navigate('/sales?type=WHOLESALE')} />
                <StatCard label="Retail Value" value={fmt(sl.retail_value)} color="#0ea5e9"
                  onClick={() => navigate('/sales?type=RETAIL')} />
              </CardRow>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 16 }}>
                {/* Payment status */}
                <Card>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Payment Status</div>
                  <MiniTable
                    cols={['Status', 'Sales']}
                    rows={Object.entries(sl.by_payment_status).map(([k, v]) => [k, v])}
                  />
                </Card>

                {/* Top models */}
                <Card>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Top-Selling Models</div>
                  <MiniTable
                    cols={['Model', 'Units', 'Revenue']}
                    rows={sl.top_models.map(m => [m.model, m.count, fmt(m.revenue)])}
                  />
                </Card>

                {/* Top salespersons */}
                <Card>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Top Salespersons</div>
                  <MiniTable
                    cols={['Name', 'Sales', 'Revenue']}
                    rows={sl.top_salespersons.map(sp => [sp.name || '(Unassigned)', sp.count, fmt(sp.revenue)])}
                  />
                </Card>
              </div>

              {/* Sales trend chart */}
              <Card style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Sales Trend — Revenue by Day</div>
                <LineChart
                  series={[{ label: 'Revenue (₦)', color: '#3b82f6', values: ch.sales_trend.map(d => parseFloat(d.revenue)) }]}
                />
              </Card>

              {/* Received vs Sold */}
              {ch.received_vs_sold.length > 0 && (
                <Card style={{ marginTop: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Phones Received vs Sold</div>
                  <LineChart
                    series={[
                      { label: 'Received', color: '#22c55e', values: ch.received_vs_sold.map(d => d.received) },
                      { label: 'Sold', color: '#3b82f6', values: ch.received_vs_sold.map(d => d.sold) },
                    ]}
                    height={100}
                  />
                </Card>
              )}
            </Section>

            {/* ── Profit Trend ── */}
            {ch.profit_trend.length > 0 && (
              <Section title="Profit Trend">
                <Card>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Revenue · Gross Profit · Net Profit</div>
                  <LineChart
                    series={[
                      { label: 'Revenue', color: '#3b82f6', values: ch.profit_trend.map(d => parseFloat(d.revenue)) },
                      { label: 'Gross Profit', color: '#22c55e', values: ch.profit_trend.map(d => parseFloat(d.gross_profit)) },
                      { label: 'Net Profit', color: '#0f172a', values: ch.profit_trend.map(d => parseFloat(d.net_profit)) },
                    ]}
                  />
                </Card>
              </Section>
            )}

            {/* ── Refurbishment Overview ── */}
            <Section title="Refurbishment Overview">
              <CardRow>
                <StatCard label="Awaiting Refurb" value={rf.awaiting} color="#f59e0b"
                  onClick={() => navigate('/devices?status=AWAITING_REFURB')} />
                <StatCard label="On the Bench" value={rf.in_progress} color="#f97316"
                  onClick={() => navigate('/refurb-jobs')} />
                <StatCard label="Closed (Period)" value={rf.closed_period} color="#22c55e"
                  sub={`${rf.success_rate ?? '—'}% success rate`}
                  onClick={() => navigate('/refurb-jobs')} />
                <StatCard label="Successfully Refurbed" value={rf.successful_period} color="#16a34a"
                  onClick={() => navigate('/refurb-jobs')} />
                <StatCard label="Sent External" value={rf.sent_external_period} color="#8b5cf6"
                  onClick={() => navigate('/devices?status=SENT_EXTERNAL')} />
                <StatCard label="Scrapped" value={rf.scrapped_period} color="#ef4444"
                  onClick={() => navigate('/devices?status=SCRAPPED')} />
                <StatCard label="Avg. Days in Refurb" value={rf.avg_days ?? '—'} color="#64748b" />
                <StatCard label="Success Rate" value={rf.success_rate != null ? `${rf.success_rate}%` : '—'} color="#22c55e" />
              </CardRow>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 16 }}>
                <Card>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Refurb Outcomes</div>
                  <DonutChart slices={[
                    { label: 'Successful', value: rf.successful_period, color: '#22c55e' },
                    { label: 'Scrapped', value: rf.scrapped_period, color: '#ef4444' },
                    { label: 'Sent External', value: rf.sent_external_period, color: '#8b5cf6' },
                    { label: 'In Progress', value: rf.in_progress + rf.awaiting, color: '#f59e0b' },
                  ]} />
                </Card>

                <Card>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Engineer Performance</div>
                  {rf.engineers.length === 0
                    ? <div style={{ color: '#94a3b8', fontSize: 13 }}>No completed jobs in period</div>
                    : <MiniTable
                        cols={['Engineer', 'Closed', 'Success']}
                        rows={rf.engineers.map(e => [e.name, e.closed, e.success])}
                      />
                  }
                </Card>
              </div>
            </Section>

            {/* ── Purchases & Stock Intake ── */}
            <Section title="Purchases & Stock Intake">
              <CardRow>
                <StatCard label="POs Awaiting Receipt" value={pu.pending_pos} color="#f59e0b"
                  sub="Pending purchase orders"
                  onClick={() => navigate('/purchase-orders?status=pending')} />
                <StatCard label="Phones Received" value={pu.phones_received_period} color="#3b82f6"
                  onClick={() => navigate('/purchase-orders')} />
                <StatCard label="Parts Purchased" value={pu.parts_purchased_period} color="#06b6d4"
                  sub={fmt(pu.parts_purchase_value_period)}
                  onClick={() => navigate('/parts')} />
                <StatCard label="Stock Purchase Value" value={fmt(pu.stock_purchase_value_period)} color="#8b5cf6" />
              </CardRow>

              {pu.recent_pos.length > 0 && (
                <Card style={{ marginTop: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Recent Purchase Orders</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['PO Number', 'Date', 'Items', 'Status'].map((h, i) => (
                          <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '6px 8px', color: '#94a3b8', fontSize: 11, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pu.recent_pos.map((po, i) => (
                        <tr key={i} onClick={() => navigate('/purchase-orders')}
                          style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                          <td style={{ padding: '8px 8px', fontWeight: 700, color: '#374151' }}>{po.po_number}</td>
                          <td style={{ padding: '8px 8px', textAlign: 'right', color: '#64748b' }}>{po.date}</td>
                          <td style={{ padding: '8px 8px', textAlign: 'right', color: '#64748b' }}>{po.items}</td>
                          <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                            <span style={{
                              padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                              background: po.status === 'received' ? '#dcfce7' : '#fef3c7',
                              color: po.status === 'received' ? '#16a34a' : '#92400e',
                            }}>{po.status.toUpperCase()}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </Section>

            {/* ── Returns Overview ── */}
            <Section title="Returns Overview">
              <CardRow>
                <StatCard label="Total Returns" value={re.total_period} color="#ec4899"
                  onClick={() => navigate('/returns')} />
                <StatCard label="Refunds Issued" value={fmt(re.refunds_period)} color="#ef4444"
                  onClick={() => navigate('/returns')} />
                <StatCard label="Restocked" value={re.restocked} color="#22c55e"
                  onClick={() => navigate('/returns')} />
                <StatCard label="Returned to Refurb" value={re.returned_to_refurb} color="#f59e0b"
                  onClick={() => navigate('/refurb-jobs')} />
                <StatCard label="Scrapped After Return" value={re.scrapped_after_return} color="#ef4444"
                  onClick={() => navigate('/returns')} />
              </CardRow>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 16 }}>
                {re.by_reason.length > 0 && (
                  <Card>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Most Common Return Reasons</div>
                    <HBar rows={re.by_reason.map(r => ({ label: r.reason, value: r.count }))} />
                  </Card>
                )}
                {ch.returns_trend.length > 0 && (
                  <Card>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Returns Trend</div>
                    <LineChart
                      series={[{ label: 'Returns', color: '#ec4899', values: ch.returns_trend.map(d => d.count) }]}
                      height={90}
                    />
                  </Card>
                )}
              </div>
            </Section>

            {/* ── Expenses Breakdown ── */}
            {ch.expense_breakdown.length > 0 && (
              <Section title="Expense Breakdown">
                <Card>
                  <HBar
                    rows={ch.expense_breakdown.map(e => ({ label: e.category, value: parseFloat(e.amount) }))}
                    valueLabel="₦"
                  />
                </Card>
              </Section>
            )}

            {/* ── Alerts ── */}
            <Section title={`Alerts & Actions Required${totalAlerts > 0 ? ` (${totalAlerts})` : ''}`}>
              {totalAlerts === 0 && (
                <div style={{ color: '#22c55e', fontWeight: 700, fontSize: 14, padding: '12px 0' }}>
                  ✅ No alerts — everything looks good!
                </div>
              )}

              <AlertRow icon="⚠️" count={al.low_stock_parts.length}
                label="parts below minimum stock level"
                color="#f59e0b" onClick={() => navigate('/parts')} />
              <AlertRow icon="🔧" count={al.long_in_refurb}
                label="devices spending more than 7 days in refurbishment"
                color="#f97316" onClick={() => navigate('/refurb-jobs')} />
              <AlertRow icon="🛠️" count={al.overdue_external}
                label="external repairs overdue (>14 days)"
                color="#ef4444" onClick={() => navigate('/devices?status=SENT_EXTERNAL')} />
              <AlertRow icon="💰" count={al.overdue_customer_balances.length}
                label="customers with outstanding balances"
                color="#ef4444" onClick={() => navigate('/customers')} />
              <AlertRow icon="📦" count={al.pending_returns_inspection}
                label="returns pending inspection/resolution"
                color="#8b5cf6" onClick={() => navigate('/returns')} />
              <AlertRow icon="🛒" count={al.pending_pos}
                label="purchase orders awaiting receipt"
                color="#06b6d4" onClick={() => navigate('/purchase-orders')} />
              <AlertRow icon="📱" count={al.reserved_phones}
                label="reserved phones not yet completed/collected"
                color="#f59e0b" onClick={() => navigate('/devices?status=RESERVED')} />
              {al.recon_mismatch && (
                <AlertRow icon="❗" count={1}
                  label="inventory reconciliation mismatch detected"
                  color="#ef4444" onClick={() => navigate('/reports')} />
              )}

              {/* Overdue balances detail */}
              {al.overdue_customer_balances.length > 0 && (
                <Card style={{ marginTop: 16, borderLeft: '4px solid #ef4444' }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                    Overdue Customer Balances
                  </div>
                  <MiniTable
                    cols={['Customer', 'Balance Owed']}
                    rows={al.overdue_customer_balances.map(c => [c.name, fmt(c.balance)])}
                  />
                </Card>
              )}

              {/* Low stock parts detail */}
              {al.low_stock_parts.length > 0 && (
                <Card style={{ marginTop: 16, borderLeft: '4px solid #f59e0b' }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#92400e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                    Low Stock Parts
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {al.low_stock_parts.map(p => (
                      <span key={p.id} onClick={() => navigate('/parts')}
                        style={{
                          background: '#fef3c7', color: '#92400e', padding: '4px 12px',
                          borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}>
                        {p.name}: {p.on_hand}/{p.minimum}
                      </span>
                    ))}
                  </div>
                </Card>
              )}
            </Section>
          </>
        )
      })()}
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
        <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 12, textTransform: 'uppercase' }}>Inventory Status</div>
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
          <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 12, textTransform: 'uppercase' }}>Financials</div>
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

// ── Router ────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth()
  if (user?.role === 'ADMIN') return <CeoDashboard />
  return <SimpleDashboard />
}
