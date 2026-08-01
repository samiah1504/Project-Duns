import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getDevices, transferDevice } from '../services/api'
import { DeviceWithModel } from '../types'
import { PageHeader, Card, Table, TR, TD, Modal, Input, Select, Btn, fmt } from '../components/Layout'

function daysSince(dateStr?: string): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function CancelReturnModal({ device, onClose }: { device: DeviceWithModel; onClose: () => void }) {
  const qc = useQueryClient()
  const [toStatus, setToStatus] = useState<'AWAITING_REFURB' | 'SELLABLE'>('AWAITING_REFURB')
  const [notes, setNotes] = useState('')

  const mut = useMutation({
    mutationFn: () => transferDevice(device.imei, {
      to_status: toStatus,
      to_location: toStatus === 'SELLABLE' ? 'SALES_STOCK' : 'INTAKE',
      notes: notes || 'Return cancelled',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-to-return'] })
      toast.success('Return cancelled')
      onClose()
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open={true} title="Cancel Return" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: '#374151' }}>
          Cancel return for <strong>{device.imei}</strong>?
        </p>
        <Select value={toStatus} onChange={e => setToStatus(e.target.value as typeof toStatus)}>
          <option value="AWAITING_REFURB">Move back to Awaiting Refurb</option>
          <option value="SELLABLE">Mark as Sellable</option>
        </Select>
        <Input
          placeholder="Notes (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : 'Confirm Cancel Return'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

export default function StockToReturn() {
  const [search, setSearch] = useState('')
  const [cancelDevice, setCancelDevice] = useState<DeviceWithModel | null>(null)

  const { data: devices = [], isLoading } = useQuery<DeviceWithModel[]>({
    queryKey: ['stock-to-return'],
    queryFn: async () => {
      const res = await getDevices({ status: 'STOCK_TO_RETURN' })
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
      <PageHeader title="Stock to Return" />

      <Card style={{ marginBottom: 8, padding: '8px 16px', background: '#fef2f2', borderColor: '#fca5a5' }}>
        <span style={{ fontSize: 13, color: '#991b1b' }}>
          These devices are marked for return to supplier. They are excluded from sellable stock and cannot be sold.
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
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No stock marked for return.</div>
        ) : (
          <Table headers={['Inventory #', 'IMEI', 'Model', 'Grade', 'Selling Price', 'Days Pending', 'Actions']}>
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
                <TD>{d.selling_price ? fmt(d.selling_price) : '—'}</TD>
                <TD style={{ color: '#dc2626', fontWeight: 600 }}>
                  {daysSince(d.updated_at)} days
                </TD>
                <TD>
                  <Btn variant="secondary" size="sm" onClick={() => setCancelDevice(d)}>
                    Cancel Return
                  </Btn>
                </TD>
              </TR>
            ))}
          </Table>
        )}
      </Card>

      {cancelDevice && (
        <CancelReturnModal device={cancelDevice} onClose={() => setCancelDevice(null)} />
      )}
    </div>
  )
}
