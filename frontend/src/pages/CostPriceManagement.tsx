import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getPendingCostEntry, updateCostPrice, getDevicePriceHistory, getDevices } from '../services/api'
import { Device, PriceChange } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, fmt } from '../components/Layout'

// ─── Price history modal ───────────────────────────────────────────────────────

function PriceHistoryModal({ imei, onClose }: { imei: string; onClose: () => void }) {
  const { data: history = [], isLoading } = useQuery<PriceChange[]>({
    queryKey: ['price-history', imei],
    queryFn: () => getDevicePriceHistory(imei).then(r => r.data),
  })

  return (
    <Modal open onClose={onClose} title={`Price History — ${imei}`} maxWidth={700}>
      {isLoading ? (
        <div style={{ padding: 24, color: '#64748b' }}>Loading…</div>
      ) : history.length === 0 ? (
        <div style={{ padding: 24, color: '#94a3b8' }}>No price changes recorded yet.</div>
      ) : (
        <Table headers={['Date/Time', 'Field', 'Action', 'Old Value', 'New Value', 'Role', 'Notes']}>
          {history.map(h => (
            <TR key={h.id}>
              <TD>{new Date(h.timestamp).toLocaleString()}</TD>
              <TD>{h.field === 'purchase_cost' ? 'Cost Price' : 'Selling Price'}</TD>
              <TD>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
                  background: h.action === 'set' ? '#dcfce7' : '#fef3c7',
                  color: h.action === 'set' ? '#15803d' : '#92400e',
                }}>
                  {h.action.toUpperCase()}
                </span>
              </TD>
              <TD>{h.old_value ? fmt(h.old_value) : '—'}</TD>
              <TD>{h.new_value ? fmt(h.new_value) : '—'}</TD>
              <TD>{h.user_role}</TD>
              <TD>{h.notes ?? '—'}</TD>
            </TR>
          ))}
        </Table>
      )}
    </Modal>
  )
}

// ─── Edit cost price modal ────────────────────────────────────────────────────

function EditCostModal({ device, onClose }: { device: Device; onClose: () => void }) {
  const [cost, setCost] = useState(device.purchase_cost ? String(parseFloat(device.purchase_cost)) : '')
  const [notes, setNotes] = useState('')
  const qc = useQueryClient()

  const mut = useMutation({
    mutationFn: () => updateCostPrice(device.imei, { purchase_cost: parseFloat(cost), notes: notes || undefined }),
    onSuccess: () => {
      toast.success('Cost price updated')
      qc.invalidateQueries({ queryKey: ['pending-cost'] })
      qc.invalidateQueries({ queryKey: ['all-devices'] })
      onClose()
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? 'Failed to update cost price'),
  })

  const sp = device.selling_price ? parseFloat(device.selling_price) : null
  const cp = parseFloat(cost) || 0
  const gp = sp !== null ? sp - cp : null
  const margin = sp && sp > 0 && gp !== null ? (gp / sp) * 100 : null

  return (
    <Modal open onClose={onClose} title={`Set Cost Price — ${device.imei}`} maxWidth={460}>
      <div style={{ marginBottom: 14 }}>
        {device.model && (
          <div style={{
            padding: '8px 12px', background: '#f8fafc', borderRadius: 6,
            fontSize: 13, marginBottom: 10,
          }}>
            <strong>{device.model.brand} {device.model.model_name}</strong>
            {device.model.storage ? ` ${device.model.storage}` : ''}
            {' · Grade '}{device.grade}
            {device.model.colour ? ` · ${device.model.colour}` : ''}
          </div>
        )}
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>
          <strong>Selling Price:</strong> {device.selling_price ? fmt(device.selling_price) : <span style={{ color: '#d97706' }}>Not set</span>}
        </div>
        <Input
          label="Cost Price (₦) *"
          type="number"
          value={cost}
          onChange={e => setCost(e.target.value)}
          min="0"
          step="0.01"
          style={{ marginBottom: 10 }}
        />
        <Input
          label="Notes (optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        {sp !== null && cost && (
          <div style={{
            background: gp !== null && gp >= 0 ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${gp !== null && gp >= 0 ? '#bbf7d0' : '#fecaca'}`,
            borderRadius: 6, padding: '10px 14px', fontSize: 13,
          }}>
            <div><strong>Gross Profit:</strong> {gp !== null ? fmt(String(gp)) : '—'}</div>
            <div><strong>Margin:</strong> {margin !== null ? `${margin.toFixed(1)}%` : '—'}</div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => mut.mutate()} disabled={mut.isPending || !cost || parseFloat(cost) <= 0}>
          {mut.isPending ? 'Saving…' : 'Save Cost Price'}
        </Btn>
      </div>
    </Modal>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CostPriceManagement() {
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [editing, setEditing] = useState<Device | null>(null)
  const [viewHistory, setViewHistory] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const { data: pending = [], isLoading: pendingLoading } = useQuery<Device[]>({
    queryKey: ['pending-cost'],
    queryFn: () => getPendingCostEntry().then(r => r.data),
  })

  const { data: allDevices = [], isLoading: allLoading } = useQuery<Device[]>({
    queryKey: ['all-devices'],
    queryFn: () => getDevices().then(r => r.data),
    enabled: tab === 'all',
  })

  const devices = tab === 'pending' ? pending : allDevices
  const isLoading = tab === 'pending' ? pendingLoading : allLoading

  const filtered = devices.filter(d => {
    if (!search) return true
    const q = search.toLowerCase()
    return d.imei.includes(q) || (d.inventory_number ?? '').toLowerCase().includes(q)
  })

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 18px', cursor: 'pointer', fontWeight: active ? 700 : 400,
    fontSize: 14, border: 'none', background: 'none',
    borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
    color: active ? '#1d4ed8' : '#64748b',
  })

  return (
    <div>
      <PageHeader title="Cost Price Management — ADMIN / OPERATIONS Only" />

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
        <button style={tabStyle(tab === 'pending')} onClick={() => setTab('pending')}>
          Pending Cost Entry {pending.length > 0 && <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11 }}>{pending.length}</span>}
        </button>
        <button style={tabStyle(tab === 'all')} onClick={() => setTab('all')}>All Devices</button>
      </div>

      <Card>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
          <input
            placeholder="Search by IMEI or inventory number…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 320, padding: '7px 11px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
        </div>

        {isLoading ? (
          <div style={{ padding: 32, color: '#64748b', textAlign: 'center' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 32, color: '#94a3b8', textAlign: 'center' }}>
            {tab === 'pending' ? 'All devices have cost prices set. ✓' : 'No devices found.'}
          </div>
        ) : (
          <Table headers={['Model', 'Grade', 'IMEI', 'Inventory #', 'Status', 'Selling Price', 'Cost Price', 'Gross Profit', 'Margin', '']}>
            {filtered.map(d => {
              const sp = d.selling_price ? parseFloat(d.selling_price) : null
              const cp = d.purchase_cost ? parseFloat(d.purchase_cost) : null
              const gp = sp !== null && cp !== null ? sp - cp : null
              const margin = sp && sp > 0 && gp !== null ? (gp / sp) * 100 : null
              return (
                <TR key={d.id}>
                  <TD>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {d.model ? `${d.model.brand} ${d.model.model_name}` : '—'}
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
                  <TD>
                    <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.imei}</span>
                  </TD>
                  <TD>{d.inventory_number ?? '—'}</TD>
                  <TD>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
                      background: '#f1f5f9', color: '#475569',
                    }}>{d.status.replace(/_/g, ' ')}</span>
                  </TD>
                  <TD>
                    {d.selling_price
                      ? fmt(d.selling_price)
                      : <span style={{ color: '#d97706', fontSize: 11, fontWeight: 600 }}>Not Set</span>
                    }
                  </TD>
                  <TD>
                    {cp
                      ? fmt(d.purchase_cost!)
                      : <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 600 }}>Pending</span>
                    }
                  </TD>
                  <TD>{gp !== null ? fmt(String(gp)) : '—'}</TD>
                  <TD>
                    {margin !== null ? (
                      <span style={{ color: margin >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                        {margin.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </TD>
                  <TD>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn size="sm" onClick={() => setEditing(d)}>Set Cost</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setViewHistory(d.imei)}>History</Btn>
                    </div>
                  </TD>
                </TR>
              )
            })}
          </Table>
        )}
      </Card>

      {editing && <EditCostModal device={editing} onClose={() => setEditing(null)} />}
      {viewHistory && <PriceHistoryModal imei={viewHistory} onClose={() => setViewHistory(null)} />}
    </div>
  )
}
