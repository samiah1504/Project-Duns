import { useQuery } from '@tanstack/react-query'
import {
  getReconciliation, getInventoryValuation, getWIPValue,
  getEngineerPerformance, getSalesSummary, getReturnsAnalysis,
  getLowStockAlerts, getYieldConversion
} from '../services/api'
import { Card, fmt } from '../components/Layout'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#475569', marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  )
}

function KV({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ fontWeight: 700, color: color ?? '#1e293b' }}>{value}</span>
    </div>
  )
}

export default function Reports() {
  const recon = useQuery({ queryKey: ['reconciliation'], queryFn: () => getReconciliation().then(r => r.data) })
  const wip = useQuery({ queryKey: ['wip'], queryFn: () => getWIPValue().then(r => r.data) })
  const sales = useQuery({ queryKey: ['sales-summary'], queryFn: () => getSalesSummary().then(r => r.data) })
  const engs = useQuery({ queryKey: ['eng-perf'], queryFn: () => getEngineerPerformance().then(r => r.data) })
  const returns_ = useQuery({ queryKey: ['returns-analysis'], queryFn: () => getReturnsAnalysis().then(r => r.data) })
  const lowStock = useQuery({ queryKey: ['low-stock'], queryFn: () => getLowStockAlerts().then(r => r.data) })
  const yield_ = useQuery({ queryKey: ['yield'], queryFn: () => getYieldConversion().then(r => r.data) })

  return (
    <div style={{ padding: 28, maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 28 }}>Reports & Analytics</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <Section title="RECONCILIATION">
            <Card style={{ borderLeft: `4px solid ${recon.data?.reconciled ? '#22c55e' : '#ef4444'}` }}>
              <KV label="Total Received" value={recon.data?.total_received ?? '—'} />
              <KV label="Sellable" value={recon.data?.sellable ?? '—'} color="#22c55e" />
              <KV label="In Refurb / Awaiting" value={recon.data?.in_refurb ?? '—'} color="#f59e0b" />
              <KV label="Sent External" value={recon.data?.sent_external ?? '—'} color="#8b5cf6" />
              <KV label="Reserved" value={recon.data?.reserved ?? '—'} color="#06b6d4" />
              <KV label="Sold" value={recon.data?.sold ?? '—'} color="#3b82f6" />
              <KV label="Returned" value={recon.data?.returned ?? '—'} color="#ec4899" />
              <KV label="Scrapped" value={recon.data?.scrapped ?? '—'} color="#ef4444" />
              <div style={{ marginTop: 10, fontWeight: 800, color: recon.data?.reconciled ? '#22c55e' : '#ef4444' }}>
                {recon.data?.reconciled ? '✅ Books balanced' : `⚠️ Discrepancy: ${recon.data?.discrepancy}`}
              </div>
            </Card>
          </Section>

          <Section title="SALES SUMMARY">
            <Card>
              <KV label="Total Invoices" value={sales.data?.total_invoices ?? '—'} />
              <KV label="Total Revenue" value={sales.data ? fmt(sales.data.total_revenue) : '—'} color="#22c55e" />
              <KV label="Total Paid" value={sales.data ? fmt(sales.data.total_paid) : '—'} color="#22c55e" />
              <KV label="Outstanding" value={sales.data ? fmt(sales.data.outstanding_balance) : '—'} color="#ef4444" />
              <KV label="Wholesale" value={sales.data ? fmt(sales.data.wholesale_revenue) : '—'} />
              <KV label="Retail" value={sales.data ? fmt(sales.data.retail_revenue) : '—'} />
            </Card>
          </Section>

          <Section title="RETURNS ANALYSIS">
            <Card>
              <KV label="Total Returns" value={returns_.data?.total_returns ?? '—'} />
              <KV label="Total Refunded" value={returns_.data ? fmt(returns_.data.total_refunded) : '—'} color="#ef4444" />
              {returns_.data?.items?.map((item: { reason_code: string; count: number; refund_total: string }) => (
                <KV key={item.reason_code} label={item.reason_code.replace(/_/g, ' ')} value={`${item.count} (${fmt(item.refund_total)})`} />
              ))}
            </Card>
          </Section>
        </div>

        <div>
          <Section title="WIP VALUE (BENCH)">
            <Card>
              <KV label="Total WIP Value" value={wip.data ? fmt(wip.data.total_wip_value) : '—'} color="#f59e0b" />
              <KV label="Devices on Bench" value={wip.data?.device_count ?? '—'} />
              <KV label="Avg Cost/Device" value={wip.data ? fmt(wip.data.avg_cost_per_device) : '—'} />
            </Card>
          </Section>

          <Section title="YIELD / CONVERSION">
            <Card>
              <KV label="Total Received" value={yield_.data?.total_received ?? '—'} />
              <KV label="Directly Sellable" value={yield_.data?.directly_sellable ?? '—'} color="#22c55e" />
              <KV label="Required Refurb" value={yield_.data?.required_refurb ?? '—'} color="#f59e0b" />
              <KV label="Scrapped" value={yield_.data?.scrapped ?? '—'} color="#ef4444" />
              <div style={{ marginTop: 12, display: 'flex', gap: 20 }}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#22c55e' }}>{yield_.data?.yield_rate_percent ?? '—'}%</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Yield Rate</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#ef4444' }}>{yield_.data?.scrap_rate_percent ?? '—'}%</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Scrap Rate</div>
                </div>
              </div>
            </Card>
          </Section>

          <Section title="ENGINEER PERFORMANCE">
            <Card>
              {engs.data?.engineers?.length === 0 && <div style={{ color: '#94a3b8', fontSize: 14 }}>No engineers yet.</div>}
              {engs.data?.engineers?.map((eng: {
                engineer_id: string; engineer_name: string; jobs_completed: number
                devices_regraded: number; devices_scrapped: number; devices_sent_external: number
                avg_turnaround_days?: number
              }) => (
                <div key={eng.engineer_id} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{eng.engineer_name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 13 }}>
                    <div style={{ color: '#64748b' }}>Jobs: <strong>{eng.jobs_completed}</strong></div>
                    <div style={{ color: '#64748b' }}>Regraded: <strong style={{ color: '#22c55e' }}>{eng.devices_regraded}</strong></div>
                    <div style={{ color: '#64748b' }}>Scrapped: <strong style={{ color: '#ef4444' }}>{eng.devices_scrapped}</strong></div>
                    <div style={{ color: '#64748b' }}>External: <strong style={{ color: '#8b5cf6' }}>{eng.devices_sent_external}</strong></div>
                    {eng.avg_turnaround_days != null && (
                      <div style={{ color: '#64748b', gridColumn: 'span 2' }}>Avg turnaround: <strong>{eng.avg_turnaround_days.toFixed(1)} days</strong></div>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          </Section>

          <Section title="LOW STOCK ALERTS">
            <Card>
              {lowStock.data?.total_alerts === 0
                ? <div style={{ color: '#22c55e', fontSize: 14, fontWeight: 600 }}>✅ All parts adequately stocked</div>
                : lowStock.data?.alerts?.map((a: { part_id: string; name: string; quantity_on_hand: number; min_stock_level: number; shortfall: number }) => (
                    <div key={a.part_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                      <span>{a.name}</span>
                      <span style={{ color: '#f59e0b', fontWeight: 700 }}>{a.quantity_on_hand}/{a.min_stock_level} (−{a.shortfall})</span>
                    </div>
                  ))
              }
            </Card>
          </Section>
        </div>
      </div>
    </div>
  )
}
