import { useQuery } from '@tanstack/react-query'
import { getReconciliation, getWIPValue, getLowStockAlerts, getSalesSummary } from '../services/api'
import { Card, fmt } from '../components/Layout'
import { useAuth } from '../hooks/useAuth'

function StatCard({ label, value, sub, color = '#2563eb' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{sub}</div>}
    </Card>
  )
}

export default function Dashboard() {
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

      {/* Inventory Status */}
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

      {/* Reconciliation status */}
      <div style={{ marginBottom: 20 }}>
        <Card style={{
          borderLeft: `4px solid ${recon.data?.reconciled ? '#22c55e' : '#ef4444'}`,
          padding: '14px 20px',
        }}>
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

      {/* Low stock alerts */}
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
