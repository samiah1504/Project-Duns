import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDevices, getPhoneModels, getSuppliers } from '../services/api'
import { DeviceWithModel, PhoneModel, Supplier } from '../types'
import { PageHeader, Card, Table, TR, TD, Input, Select, fmt } from '../components/Layout'
import { useAuth } from '../hooks/useAuth'

const STATUS_LABELS: Record<string, string> = {
  AWAITING_REFURB: 'Awaiting Refurb',
  IN_REFURB: 'In Refurb',
  AWAITING_QC: 'Awaiting QC',
  FAILED_QC: 'Failed QC',
  SENT_EXTERNAL: 'Sent External',
  SELLABLE: 'Sellable',
  RESERVED: 'Reserved',
  SOLD: 'Sold',
  RETURNED: 'Returned',
  STOCK_TO_RETURN: 'Stock to Return',
  HARVESTED: 'Harvested',
  SCRAPPED: 'Scrapped',
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  AWAITING_REFURB: { bg: '#fef3c7', color: '#92400e' },
  IN_REFURB:       { bg: '#dbeafe', color: '#1e40af' },
  AWAITING_QC:     { bg: '#ede9fe', color: '#5b21b6' },
  FAILED_QC:       { bg: '#fee2e2', color: '#991b1b' },
  SENT_EXTERNAL:   { bg: '#e0f2fe', color: '#0369a1' },
  SELLABLE:        { bg: '#f0fdf4', color: '#166534' },
  RESERVED:        { bg: '#fdf4ff', color: '#7e22ce' },
  SOLD:            { bg: '#f8fafc', color: '#334155' },
  RETURNED:        { bg: '#fff7ed', color: '#9a3412' },
  STOCK_TO_RETURN: { bg: '#fef2f2', color: '#dc2626' },
  HARVESTED:       { bg: '#f0fdf4', color: '#065f46' },
  SCRAPPED:        { bg: '#f1f5f9', color: '#64748b' },
}

function StatusBadge({ status }: { status: string }) {
  const { bg, color } = STATUS_COLORS[status] ?? { bg: '#f1f5f9', color: '#64748b' }
  return (
    <span style={{ background: bg, color, border: `1px solid ${color}`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default function AllDevices() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterModel, setFilterModel] = useState('')
  const [filterGrade, setFilterGrade] = useState('')

  const { data: devices = [], isLoading } = useQuery<DeviceWithModel[]>({
    queryKey: ['all-devices', filterStatus],
    queryFn: async () => {
      const params: Record<string, string> = {}
      if (filterStatus) params.status = filterStatus
      const res = await getDevices(params)
      return res.data
    },
  })

  const { data: models = [] } = useQuery<PhoneModel[]>({
    queryKey: ['phone-models'],
    queryFn: async () => {
      const res = await getPhoneModels()
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
      <PageHeader title="All Devices" />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Input
              placeholder="Search IMEI, model, colour…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
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
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No devices found.</div>
        ) : (
          <Table headers={[
            'Inventory #', 'IMEI', 'Model', 'Grade', 'Status', 'Location',
            'Selling Price', ...(canSeeCost ? ['Cost Price'] : []),
            'Date Received',
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
                <TD>
                  <span style={{
                    background: d.grade === 'A' ? '#16a34a' : d.grade === 'B' ? '#d97706' : '#dc2626',
                    color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 800,
                  }}>{d.grade}</span>
                </TD>
                <TD><StatusBadge status={d.status} /></TD>
                <TD style={{ fontSize: 12, color: '#64748b' }}>{d.location?.replace(/_/g, ' ') ?? '—'}</TD>
                <TD style={{ color: '#1d4ed8', fontWeight: 600 }}>
                  {d.selling_price ? fmt(d.selling_price) : '—'}
                </TD>
                {canSeeCost && (
                  <TD style={{ color: '#64748b' }}>
                    {d.purchase_cost ? fmt(d.purchase_cost) : '—'}
                  </TD>
                )}
                <TD style={{ fontSize: 12, color: '#64748b' }}>
                  {d.date_received ? new Date(d.date_received).toLocaleDateString() : '—'}
                </TD>
              </TR>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
