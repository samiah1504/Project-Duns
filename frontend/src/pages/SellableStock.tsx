import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSellableDevices, getPhoneModels } from '../services/api'
import { DeviceWithModel, PhoneModel } from '../types'
import { PageHeader, Card, Table, TR, TD, Input, Select, fmt } from '../components/Layout'
import { useAuth } from '../hooks/useAuth'

function daysSince(dateStr?: string): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'SELLABLE' ? '#16a34a' : '#d97706'
  const bg = status === 'SELLABLE' ? '#f0fdf4' : '#fffbeb'
  return (
    <span style={{ background: bg, color, border: `1px solid ${color}`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
      {status === 'SELLABLE' ? 'Sellable' : 'Reserved'}
    </span>
  )
}

function GradeBadge({ grade }: { grade: string }) {
  const map: Record<string, string> = { A: '#16a34a', B: '#d97706', C: '#dc2626' }
  const color = map[grade] ?? '#64748b'
  return (
    <span style={{ background: color, color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>
      {grade}
    </span>
  )
}

export default function SellableStock() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [filterModel, setFilterModel] = useState('')
  const [filterGrade, setFilterGrade] = useState('')

  const { data: devices = [], isLoading } = useQuery<DeviceWithModel[]>({
    queryKey: ['sellable-devices'],
    queryFn: async () => {
      const res = await getSellableDevices()
      return res.data
    },
  })

  const { data: models = [] } = useQuery<PhoneModel[]>({
    queryKey: ['phone-models'],
    queryFn: async () => {
      const { getPhoneModels: gpm } = await import('../services/api')
      const res = await gpm()
      return res.data
    },
  })

  const filtered = devices.filter(d => {
    const spec = [d.model?.brand, d.model?.model_name, d.model?.ram, d.model?.storage, d.model?.colour, d.imei, d.inventory_number]
      .filter(Boolean).join(' ').toLowerCase()
    if (search && !spec.includes(search.toLowerCase())) return false
    if (filterModel && d.model_id !== filterModel) return false
    if (filterGrade && d.grade !== filterGrade) return false
    return true
  })

  const canSeeCost = ['ADMIN', 'OPERATIONS'].includes(user?.role ?? '')

  return (
    <div>
      <PageHeader title="Sellable Stock" />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Input
              placeholder="Search IMEI, model, colour…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Select value={filterModel} onChange={e => setFilterModel(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">All models</option>
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.brand} {m.model_name} {m.ram} {m.storage} {m.colour}</option>
            ))}
          </Select>
          <Select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} style={{ minWidth: 120 }}>
            <option value="">All grades</option>
            <option value="A">Grade A</option>
            <option value="B">Grade B</option>
            <option value="C">Grade C</option>
          </Select>
          <span style={{ fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>
            {filtered.length} device{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No sellable devices found.</div>
        ) : (
          <Table headers={[
            'Inventory #', 'IMEI', 'Model', 'Grade', 'Status',
            'Selling Price', ...(canSeeCost ? ['Cost Price'] : []),
            'Days in Stock', 'Location',
          ]}>
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
                <TD><GradeBadge grade={d.grade} /></TD>
                <TD><StatusBadge status={d.status} /></TD>
                <TD style={{ fontWeight: 700, color: '#1d4ed8' }}>
                  {d.selling_price ? fmt(d.selling_price) : <span style={{ color: '#dc2626' }}>Not set</span>}
                </TD>
                {canSeeCost && (
                  <TD style={{ color: '#64748b' }}>
                    {d.purchase_cost ? fmt(d.purchase_cost) : '—'}
                  </TD>
                )}
                <TD style={{ color: '#64748b', fontSize: 12 }}>
                  {d.date_received ? `${daysSince(d.date_received)} days` : '—'}
                </TD>
                <TD style={{ fontSize: 12, color: '#64748b' }}>{d.location?.replace(/_/g, ' ') ?? '—'}</TD>
              </TR>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
