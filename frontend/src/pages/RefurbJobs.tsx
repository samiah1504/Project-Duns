import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getRefurbJobs, createRefurbJob, addPartsToJob, closeRefurbJob, getDevices, getParts, getUsers } from '../services/api'
import { RefurbJob, Device, Part, User } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select } from '../components/Layout'
import { fmt } from '../components/Layout'

const statusColor = (s: string) => s === 'closed' ? '#22c55e' : s === 'in_progress' ? '#f59e0b' : '#3b82f6'

export default function RefurbJobs() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<RefurbJob | null>(null)
  const [filterStatus, setFilterStatus] = useState('')

  const { data: jobs = [] } = useQuery({
    queryKey: ['refurb-jobs', filterStatus],
    queryFn: () => {
      const p: Record<string, string> = {}
      if (filterStatus) p.status = filterStatus
      return getRefurbJobs(p).then(r => r.data)
    },
  })

  const { data: engineers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
  })

  const { data: devices = [] } = useQuery({
    queryKey: ['devices-bench'],
    queryFn: () => getDevices({ status: 'AWAITING_REFURB' }).then(r => r.data),
  })

  const { data: parts = [] } = useQuery({
    queryKey: ['parts'],
    queryFn: () => getParts().then(r => r.data),
  })

  return (
    <div style={{ padding: 28 }}>
      <PageHeader
        title="Refurb Jobs"
        action={<Btn onClick={() => setShowNew(true)}>+ New Job</Btn>}
      />

      <Card style={{ marginBottom: 16 }}>
        <Select label="Filter Status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="closed">Closed</option>
        </Select>
      </Card>

      <Card>
        <Table headers={['Job #', 'Device', 'Engineer', 'Status', 'Opened', 'Outcome', 'Actions']}>
          {(jobs as RefurbJob[]).map(job => {
            const eng = (engineers as User[]).find(u => u.id === job.assigned_engineer_id)
            return (
              <TR key={job.id}>
                <TD><strong>{job.job_number}</strong></TD>
                <TD><code style={{ fontSize: 12 }}>{job.device_id.slice(0, 8)}</code></TD>
                <TD>{eng?.name ?? '—'}</TD>
                <TD>
                  <span style={{
                    background: statusColor(job.status) + '22', color: statusColor(job.status),
                    border: `1px solid ${statusColor(job.status)}55`,
                    padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                  }}>
                    {job.status.replace(/_/g, ' ')}
                  </span>
                </TD>
                <TD style={{ color: '#64748b' }}>{job.date_opened}</TD>
                <TD>{job.outcome ? <span style={{ color: '#22c55e', fontWeight: 600 }}>{job.outcome}</span> : '—'}</TD>
                <TD>
                  {job.status !== 'closed' && (
                    <Btn size="sm" variant="secondary" onClick={() => setSelected(job)}>
                      Manage
                    </Btn>
                  )}
                </TD>
              </TR>
            )
          })}
        </Table>
      </Card>

      <NewJobModal
        open={showNew}
        onClose={() => setShowNew(false)}
        devices={devices as Device[]}
        engineers={(engineers as User[]).filter(u => u.role === 'ENGINEER' || u.role === 'ADMIN')}
        onSuccess={() => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); setShowNew(false) }}
      />

      {selected && (
        <ManageJobModal
          job={selected}
          parts={parts as Part[]}
          onClose={() => setSelected(null)}
          onSuccess={() => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); setSelected(null) }}
        />
      )}
    </div>
  )
}

function NewJobModal({ open, onClose, devices, engineers, onSuccess }: {
  open: boolean; onClose: () => void
  devices: Device[]; engineers: User[]
  onSuccess: () => void
}) {
  const [deviceId, setDeviceId] = useState('')
  const [engId, setEngId] = useState('')
  const [fault, setFault] = useState('')

  const mut = useMutation({
    mutationFn: (data: unknown) => createRefurbJob(data),
    onSuccess: () => { toast.success('Job created'); onSuccess() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open={open} onClose={onClose} title="New Refurb Job">
      <form onSubmit={e => { e.preventDefault(); mut.mutate({ device_id: deviceId, assigned_engineer_id: engId || undefined, fault_description: fault }) }}>
        <Select label="Device (Awaiting Refurb)" value={deviceId} onChange={e => setDeviceId(e.target.value)} required>
          <option value="">Select device…</option>
          {devices.map(d => <option key={d.id} value={d.id}>{d.imei} — Grade {d.grade}</option>)}
        </Select>
        <Select label="Assign Engineer" value={engId} onChange={e => setEngId(e.target.value)}>
          <option value="">Unassigned</option>
          {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Input label="Fault Description" value={fault} onChange={e => setFault(e.target.value)} placeholder="Describe the fault…" />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" disabled={mut.isPending}>{mut.isPending ? 'Creating…' : 'Open Job'}</Btn>
        </div>
      </form>
    </Modal>
  )
}

function ManageJobModal({ job, parts, onClose, onSuccess }: {
  job: RefurbJob; parts: Part[]
  onClose: () => void; onSuccess: () => void
}) {
  const [partId, setPartId] = useState('')
  const [qty, setQty] = useState('1')
  const [outcome, setOutcome] = useState('')
  const [newGrade, setNewGrade] = useState('A')
  const [extCost, setExtCost] = useState('')

  const addMut = useMutation({
    mutationFn: (data: unknown) => addPartsToJob(job.id, data),
    onSuccess: () => { toast.success('Parts added'); onSuccess() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const closeMut = useMutation({
    mutationFn: (data: unknown) => closeRefurbJob(job.id, data),
    onSuccess: () => { toast.success('Job closed'); onSuccess() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open={true} onClose={onClose} title={`Manage: ${job.job_number}`}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
          Fault: {job.fault_description ?? '—'} · Parts used so far: {job.parts_used.length}
        </div>

        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Add Parts</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <select
            value={partId}
            onChange={e => setPartId(e.target.value)}
            style={{ flex: 2, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
          >
            <option value="">Select part…</option>
            {parts.map(p => <option key={p.id} value={p.id}>{p.name} (stock: {p.quantity_on_hand})</option>)}
          </select>
          <input
            type="number" value={qty} min="1" onChange={e => setQty(e.target.value)}
            style={{ width: 60, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
          />
          <Btn size="sm" disabled={!partId || addMut.isPending}
            onClick={() => addMut.mutate({ parts: [{ part_id: partId, quantity: parseInt(qty) }] })}>
            Add
          </Btn>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Close Job</div>
        <Select label="Outcome" value={outcome} onChange={e => setOutcome(e.target.value)}>
          <option value="">Select outcome…</option>
          <option value="regraded">Regraded (Fixed)</option>
          <option value="sent_external">Send External</option>
          <option value="scrapped">Scrap</option>
        </Select>
        {outcome === 'regraded' && (
          <Select label="New Grade" value={newGrade} onChange={e => setNewGrade(e.target.value)}>
            <option value="A">Grade A</option>
            <option value="B">Grade B</option>
            <option value="C">Grade C</option>
          </Select>
        )}
        {outcome === 'sent_external' && (
          <Input label="External Cost (₦)" type="number" value={extCost} onChange={e => setExtCost(e.target.value)} />
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn
            disabled={!outcome || closeMut.isPending}
            onClick={() => closeMut.mutate({
              outcome,
              new_grade: outcome === 'regraded' ? newGrade : undefined,
              external_cost: extCost ? parseFloat(extCost) : undefined,
            })}
          >
            {closeMut.isPending ? 'Closing…' : 'Close Job'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
