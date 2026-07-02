import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDevice, getDeviceHistory } from '../services/api'
import { Card, statusBadge, fmt } from '../components/Layout'
import { AuditLog } from '../types'

export default function DeviceDetail() {
  const { imei } = useParams<{ imei: string }>()

  const { data: device } = useQuery({
    queryKey: ['device', imei],
    queryFn: () => getDevice(imei!).then(r => r.data),
    enabled: !!imei,
  })

  const { data: history = [] } = useQuery({
    queryKey: ['device-history', imei],
    queryFn: () => getDeviceHistory(imei!).then(r => r.data),
    enabled: !!imei,
  })

  if (!device) return <div style={{ padding: 28, color: '#64748b' }}>Loading…</div>

  return (
    <div style={{ padding: 28, maxWidth: 900 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{device.imei}</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
          {statusBadge(device.status)}
          <span style={{ color: '#64748b', fontSize: 14 }}>{device.location.replace(/_/g, ' ')}</span>
          <span style={{ fontWeight: 700, color: device.grade === 'A' ? '#22c55e' : device.grade === 'B' ? '#f59e0b' : '#ef4444' }}>
            Grade {device.grade}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#475569' }}>COSTS</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>Purchase cost</span>
              <span>{fmt(device.purchase_cost)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>Parts cost</span>
              <span>{fmt(device.parts_cost)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#64748b' }}>External cost</span>
              <span>{fmt(device.external_cost)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: 8, fontWeight: 700 }}>
              <span>Total cost</span>
              <span style={{ color: '#0f172a' }}>{fmt(device.total_cost)}</span>
            </div>
            {device.sale_price && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#22c55e', fontWeight: 700 }}>
                <span>Sale price</span>
                <span>{fmt(device.sale_price)}</span>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#475569' }}>DETAILS</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <div><span style={{ color: '#64748b' }}>Received:</span> {device.date_received ?? '—'}</div>
            <div><span style={{ color: '#64748b' }}>Warranty expires:</span> {device.warranty_expiry ?? '—'}</div>
            {device.notes && <div><span style={{ color: '#64748b' }}>Notes:</span> {device.notes}</div>}
          </div>
        </Card>
      </div>

      <Card>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: '#475569' }}>HISTORY</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {(history as AuditLog[]).map((log) => (
            <div key={log.id} style={{
              padding: '10px 0', borderBottom: '1px solid #f1f5f9',
              display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 12, fontSize: 13,
            }}>
              <div style={{ color: '#64748b' }}>{new Date(log.timestamp).toLocaleString('en-GB')}</div>
              <div>
                {log.from_status && <span style={{ color: '#94a3b8' }}>{log.from_status.replace(/_/g, ' ')} →</span>}
                {' '}
                {log.to_status && <strong>{log.to_status.replace(/_/g, ' ')}</strong>}
                {log.notes && <span style={{ color: '#94a3b8' }}> · {log.notes}</span>}
              </div>
              <div style={{ color: '#cbd5e1', fontSize: 11 }}>{log.reference_id}</div>
            </div>
          ))}
          {history.length === 0 && <div style={{ color: '#94a3b8' }}>No history yet.</div>}
        </div>
      </Card>
    </div>
  )
}
