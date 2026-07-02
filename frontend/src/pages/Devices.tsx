import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getDevices, getPhoneModels, transferDevice } from '../services/api'
import { Device, PhoneModel } from '../types'
import { PageHeader, Card, Table, TR, TD, statusBadge, Btn, Modal, Select, Input } from '../components/Layout'
import { fmt } from '../components/Layout'
import { useNavigate } from 'react-router-dom'

const STATUS_OPTIONS = [
  '', 'AWAITING_REFURB', 'IN_REFURB', 'SENT_EXTERNAL',
  'SCRAPPED', 'SELLABLE', 'RESERVED', 'SOLD', 'RETURNED',
]

export default function Devices() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [filterStatus, setFilterStatus] = useState('')
  const [filterImei, setFilterImei] = useState('')
  const [transferDevice_, setTransferDevice] = useState<Device | null>(null)
  const [toStatus, setToStatus] = useState('')
  const [toLocation, setToLocation] = useState('')

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices', filterStatus, filterImei],
    queryFn: () => {
      const p: Record<string, string> = {}
      if (filterStatus) p.status = filterStatus
      if (filterImei) p.imei = filterImei
      return getDevices(p).then(r => r.data)
    },
  })

  const { data: models = [] } = useQuery({
    queryKey: ['phone-models'],
    queryFn: () => getPhoneModels().then(r => r.data),
  })

  const modelMap = Object.fromEntries((models as PhoneModel[]).map(m => [m.id, `${m.brand} ${m.model_name} ${m.storage ?? ''}`]))

  const mutation = useMutation({
    mutationFn: ({ imei, data }: { imei: string; data: unknown }) => transferDevice(imei, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devices'] }); setTransferDevice(null); toast.success('Device transferred') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Transfer failed'),
  })

  const LOCATION_FOR_STATUS: Record<string, string> = {
    AWAITING_REFURB: 'BENCH',
    IN_REFURB: 'BENCH',
    SENT_EXTERNAL: 'EXTERNAL',
    SCRAPPED: 'SCRAP',
    SELLABLE: 'SALES_STOCK',
    RESERVED: 'SALES_STOCK',
  }

  const handleTransfer = () => {
    if (!transferDevice_ || !toStatus) return
    const loc = toLocation || LOCATION_FOR_STATUS[toStatus] || 'INTAKE'
    mutation.mutate({ imei: transferDevice_.imei, data: { to_status: toStatus, to_location: loc } })
  }

  return (
    <div style={{ padding: 28 }}>
      <PageHeader
        title="Devices"
        action={<Btn onClick={() => navigate('/devices/new')}>+ Add Device</Btn>}
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Search IMEI"
              placeholder="Enter IMEI..."
              value={filterImei}
              onChange={e => setFilterImei(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Select label="Filter by Status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || 'All Statuses'}</option>)}
            </Select>
          </div>
          <Btn variant="secondary" onClick={() => { setFilterImei(''); setFilterStatus('') }}>Clear</Btn>
        </div>
      </Card>

      <Card>
        {isLoading ? <div style={{ color: '#64748b', padding: 20 }}>Loading…</div> : (
          <Table headers={['IMEI', 'Model', 'Grade', 'Status', 'Location', 'Total Cost', 'Actions']}>
            {(devices as Device[]).map(d => (
              <TR key={d.id} onClick={() => navigate(`/devices/${d.imei}`)}>
                <TD><code style={{ fontSize: 12 }}>{d.imei}</code></TD>
                <TD>{modelMap[d.model_id] ?? d.model_id.slice(0, 8)}</TD>
                <TD>
                  <span style={{
                    fontWeight: 700,
                    color: d.grade === 'A' ? '#22c55e' : d.grade === 'B' ? '#f59e0b' : '#ef4444',
                  }}>
                    Grade {d.grade}
                  </span>
                </TD>
                <TD>{statusBadge(d.status)}</TD>
                <TD style={{ color: '#64748b' }}>{d.location.replace(/_/g, ' ')}</TD>
                <TD>{fmt(d.total_cost)}</TD>
                <TD onClick={e => e.stopPropagation()}>
                  <Btn size="sm" variant="secondary" onClick={() => setTransferDevice(d)}>Transfer</Btn>
                </TD>
              </TR>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={!!transferDevice_} onClose={() => setTransferDevice(null)} title={`Transfer ${transferDevice_?.imei}`}>
        <Select label="New Status" value={toStatus} onChange={e => { setToStatus(e.target.value); setToLocation(LOCATION_FOR_STATUS[e.target.value] ?? '') }}>
          <option value="">Select status…</option>
          {STATUS_OPTIONS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select label="New Location" value={toLocation} onChange={e => setToLocation(e.target.value)}>
          {['INTAKE', 'BENCH', 'SALES_STOCK', 'EXTERNAL', 'SCRAP'].map(l => (
            <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>
          ))}
        </Select>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="secondary" onClick={() => setTransferDevice(null)}>Cancel</Btn>
          <Btn onClick={handleTransfer} disabled={!toStatus || mutation.isPending}>
            {mutation.isPending ? 'Transferring…' : 'Transfer'}
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
