import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDevices } from '../services/api'
import { DeviceWithModel } from '../types'
import { PageHeader, Card, Table, TR, TD, Input } from '../components/Layout'

export default function HarvestedStock() {
  const [search, setSearch] = useState('')

  const { data: devices = [], isLoading } = useQuery<DeviceWithModel[]>({
    queryKey: ['harvested-stock'],
    queryFn: async () => {
      const res = await getDevices({ status: 'HARVESTED' })
      return res.data
    },
  })

  const filtered = devices.filter(d => {
    const spec = [d.model?.brand, d.model?.model_name, d.imei, d.inventory_number]
      .filter(Boolean).join(' ').toLowerCase()
    return !search || spec.includes(search.toLowerCase())
  })

  return (
    <div>
      <PageHeader title="Harvested Stock" />

      <Card style={{ marginBottom: 8, padding: '8px 16px', background: '#f0fdf4', borderColor: '#86efac' }}>
        <span style={{ fontSize: 13, color: '#166534' }}>
          Devices dismantled for parts. These cannot be sold as complete units. Parts recovered from these devices are available in the Parts inventory.
        </span>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Input
          placeholder="Search IMEI or model…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 360 }}
        />
      </Card>

      <Card>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No harvested devices on record.</div>
        ) : (
          <Table headers={['Inventory #', 'IMEI', 'Model', 'Grade', 'Last Updated']}>
            {filtered.map(d => (
              <TR key={d.id}>
                <TD style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.inventory_number ?? '—'}</TD>
                <TD style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.imei}</TD>
                <TD>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {d.model?.brand} {d.model?.model_name}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {[d.model?.ram, d.model?.storage, d.model?.colour].filter(Boolean).join(' · ')}
                  </div>
                </TD>
                <TD>
                  <span style={{
                    background: d.grade === 'A' ? '#16a34a' : d.grade === 'B' ? '#d97706' : '#dc2626',
                    color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 800,
                  }}>{d.grade}</span>
                </TD>
                <TD style={{ fontSize: 12, color: '#64748b' }}>
                  {d.updated_at ? new Date(d.updated_at).toLocaleDateString() : '—'}
                </TD>
              </TR>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
