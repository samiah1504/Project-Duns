import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  getRefurbJobs, createRefurbJob, addPartsToJob, closeRefurbJob,
  assignEngineerToJob, completeRefurbJob, passQCJob, failQCJob, returnToEngineerJob,
  getDevices, getParts, getEngineers,
} from '../services/api'
import { RefurbJob, Device, Part, User } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select, fmt } from '../components/Layout'

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  open:        { label: 'Open — Awaiting Engineer', bg: '#eff6ff', color: '#1d4ed8' },
  in_progress: { label: 'With Engineer',            bg: '#fef3c7', color: '#92400e' },
  awaiting_qc: { label: 'Awaiting QC',             bg: '#ede9fe', color: '#5b21b6' },
  qc_failed:   { label: 'QC Failed',               bg: '#fee2e2', color: '#991b1b' },
  closed:      { label: 'Closed',                  bg: '#f0fdf4', color: '#166534' },
}

function JobStatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, bg: '#f1f5f9', color: '#64748b' }
  return (
    <span style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}44`, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
      {m.label}
    </span>
  )
}

// ─── Assign Engineer Modal ────────────────────────────────────────────────────

function AssignEngineerModal({ job, engineers, onClose }: { job: RefurbJob; engineers: User[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [engId, setEngId] = useState(job.assigned_engineer_id ?? '')
  const [fault, setFault] = useState(job.fault_description ?? '')

  const mut = useMutation({
    mutationFn: () => assignEngineerToJob(job.id, { engineer_id: engId, fault_description: fault || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('Engineer assigned'); onClose() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open={true} title={`Assign Engineer — ${job.job_number}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Select value={engId} onChange={e => setEngId(e.target.value)}>
          <option value="">Select engineer…</option>
          {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Input placeholder="Fault description" value={fault} onChange={e => setFault(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => mut.mutate()} disabled={!engId || mut.isPending}>
            {mut.isPending ? 'Assigning…' : 'Assign & Start'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Manage Job Modal (add parts + complete) ─────────────────────────────────

function ManageJobModal({ job, parts, onClose }: { job: RefurbJob; parts: Part[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [partId, setPartId] = useState('')
  const [qty, setQty] = useState('1')
  const [notes, setNotes] = useState('')

  const addMut = useMutation({
    mutationFn: () => addPartsToJob(job.id, { parts: [{ part_id: partId, quantity: parseInt(qty) }] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('Parts added') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const completeMut = useMutation({
    mutationFn: () => completeRefurbJob(job.id, { notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('Sent to QC'); onClose() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const closeMut = useMutation({
    mutationFn: (data: { outcome: string; external_cost?: number }) => closeRefurbJob(job.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('Job closed'); onClose() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open={true} title={`${job.job_number} — With Engineer`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {job.parts_used.length > 0 && (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            Parts used: {job.parts_used.map(p => `${p.quantity}× ${p.part_id.slice(0, 6)}`).join(', ')}
          </div>
        )}

        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Add Parts</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={partId} onChange={e => setPartId(e.target.value)}
              style={{ flex: 2, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}>
              <option value="">Select part…</option>
              {parts.map(p => <option key={p.id} value={p.id}>{p.name} (stock: {p.quantity_on_hand})</option>)}
            </select>
            <input type="number" value={qty} min="1" onChange={e => setQty(e.target.value)}
              style={{ width: 60, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }} />
            <Btn size="sm" disabled={!partId || addMut.isPending} onClick={() => addMut.mutate()}>Add</Btn>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          <Input placeholder="Completion notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Btn onClick={() => completeMut.mutate()} disabled={completeMut.isPending}>
              {completeMut.isPending ? '…' : 'Mark Complete → Send to QC'}
            </Btn>
            <Btn variant="secondary" size="sm"
              onClick={() => closeMut.mutate({ outcome: 'sent_external' })} disabled={closeMut.isPending}>
              Send External
            </Btn>
            <Btn variant="danger" size="sm"
              onClick={() => closeMut.mutate({ outcome: 'scrapped' })} disabled={closeMut.isPending}>
              Scrap
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── QC Modal ────────────────────────────────────────────────────────────────

function QCModal({ job, onClose }: { job: RefurbJob; onClose: () => void }) {
  const qc = useQueryClient()
  const [newGrade, setNewGrade] = useState('')
  const [notes, setNotes] = useState('')

  const passMut = useMutation({
    mutationFn: () => passQCJob(job.id, { new_grade: newGrade || undefined, notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('QC passed — device is now SELLABLE'); onClose() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const failMut = useMutation({
    mutationFn: () => failQCJob(job.id, { notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('QC failed — returned to bench'); onClose() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open={true} title={`QC Check — ${job.job_number}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: '8px 12px', background: '#ede9fe', borderRadius: 6, fontSize: 13, color: '#5b21b6' }}>
          Device is awaiting quality check. Record the inspection result.
        </div>
        <Select value={newGrade} onChange={e => setNewGrade(e.target.value)}>
          <option value="">Grade unchanged</option>
          <option value="A">Upgrade to Grade A</option>
          <option value="B">Set Grade B</option>
          <option value="C">Set Grade C</option>
        </Select>
        <Input placeholder="QC notes" value={notes} onChange={e => setNotes(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={() => passMut.mutate()} disabled={passMut.isPending}>
            {passMut.isPending ? '…' : '✓ Pass QC — Move to Sellable'}
          </Btn>
          <Btn variant="danger" onClick={() => failMut.mutate()} disabled={failMut.isPending}>
            {failMut.isPending ? '…' : '✗ Fail QC — Return to Bench'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Return to Engineer Modal ─────────────────────────────────────────────────

function ReturnToEngineerModal({ job, engineers, onClose }: { job: RefurbJob; engineers: User[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [engId, setEngId] = useState(job.assigned_engineer_id ?? '')
  const [notes, setNotes] = useState('')

  const mut = useMutation({
    mutationFn: () => returnToEngineerJob(job.id, { engineer_id: engId || undefined, notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('Returned to engineer'); onClose() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open={true} title={`Return to Engineer — ${job.job_number}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: '8px 12px', background: '#fee2e2', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>
          QC failed. Return device to engineer for rework.
        </div>
        <Select value={engId} onChange={e => setEngId(e.target.value)}>
          <option value="">Same engineer</option>
          {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Input placeholder="Rework instructions" value={notes} onChange={e => setNotes(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? '…' : 'Return to Engineer'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── New Job Modal ────────────────────────────────────────────────────────────

function NewJobModal({ devices, engineers, onClose }: { devices: Device[]; engineers: User[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [deviceId, setDeviceId] = useState('')
  const [engId, setEngId] = useState('')
  const [fault, setFault] = useState('')

  const mut = useMutation({
    mutationFn: () => createRefurbJob({ device_id: deviceId, assigned_engineer_id: engId || undefined, fault_description: fault || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('Job created'); onClose() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open={true} title="New Refurb Job" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Select value={deviceId} onChange={e => setDeviceId(e.target.value)}>
          <option value="">Select device (Awaiting Refurb)…</option>
          {devices.map(d => (
            <option key={d.id} value={d.id}>{d.imei} — Grade {d.grade}</option>
          ))}
        </Select>
        <Select value={engId} onChange={e => setEngId(e.target.value)}>
          <option value="">No engineer yet</option>
          {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Input placeholder="Fault description" value={fault} onChange={e => setFault(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => mut.mutate()} disabled={!deviceId || mut.isPending}>
            {mut.isPending ? 'Creating…' : 'Open Job'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ModalState =
  | { type: 'assign'; job: RefurbJob }
  | { type: 'manage'; job: RefurbJob }
  | { type: 'qc'; job: RefurbJob }
  | { type: 'return'; job: RefurbJob }
  | { type: 'new' }
  | null

export default function RefurbJobs() {
  const [filterStatus, setFilterStatus] = useState('')
  const [modal, setModal] = useState<ModalState>(null)

  const { data: jobs = [] } = useQuery<RefurbJob[]>({
    queryKey: ['refurb-jobs', filterStatus],
    queryFn: () => {
      const p: Record<string, string> = filterStatus ? { status: filterStatus } : { active_only: 'true' }
      return getRefurbJobs(p).then(r => r.data)
    },
  })

  const { data: engineers = [] } = useQuery<User[]>({
    queryKey: ['engineers'],
    queryFn: () => getEngineers().then(r => r.data),
  })

  const { data: awaitingDevices = [] } = useQuery<Device[]>({
    queryKey: ['devices-awaiting-refurb'],
    queryFn: () => getDevices({ status: 'AWAITING_REFURB' }).then(r => r.data),
  })

  const { data: parts = [] } = useQuery<Part[]>({
    queryKey: ['parts'],
    queryFn: () => getParts().then(r => r.data),
  })

  const engineerUsers = engineers

  return (
    <div>
      <PageHeader
        title="Refurb Jobs"
        action={<Btn onClick={() => setModal({ type: 'new' })}>+ New Job</Btn>}
      />

      <Card style={{ marginBottom: 8, padding: '8px 16px', background: '#eff6ff', borderColor: '#93c5fd' }}>
        <span style={{ fontSize: 12, color: '#1e40af' }}>
          Jobs are created automatically when a device is received as Awaiting Refurb. Only active jobs are shown by default.
        </span>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Active jobs only</option>
          <option value="open">Open — Awaiting Engineer</option>
          <option value="in_progress">In Progress</option>
          <option value="awaiting_qc">Awaiting QC</option>
          <option value="qc_failed">QC Failed</option>
          <option value="closed">Closed</option>
        </Select>
      </Card>

      <Card>
        <Table headers={['Job #', 'Device ID', 'Engineer', 'Status', 'Opened', 'Parts', 'Actions']}>
          {jobs.map(job => {
            const eng = engineers.find(u => u.id === job.assigned_engineer_id)
            return (
              <TR key={job.id}>
                <TD>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{job.job_number}</div>
                  {job.auto_created && (
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>auto</div>
                  )}
                </TD>
                <TD><code style={{ fontSize: 11 }}>{job.device_id.slice(0, 8)}…</code></TD>
                <TD style={{ color: eng ? '#1e293b' : '#94a3b8' }}>{eng?.name ?? 'Unassigned'}</TD>
                <TD><JobStatusBadge status={job.status} /></TD>
                <TD style={{ color: '#64748b', fontSize: 12 }}>{job.date_opened}</TD>
                <TD style={{ color: '#64748b', fontSize: 12 }}>{job.parts_used.length}</TD>
                <TD>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {job.status === 'open' && (
                      <Btn size="sm" onClick={() => setModal({ type: 'assign', job })}>
                        Assign Engineer
                      </Btn>
                    )}
                    {job.status === 'in_progress' && (
                      <Btn size="sm" onClick={() => setModal({ type: 'manage', job })}>
                        Manage / Parts
                      </Btn>
                    )}
                    {job.status === 'awaiting_qc' && (
                      <Btn size="sm" variant="ghost" onClick={() => setModal({ type: 'qc', job })}>
                        QC Check
                      </Btn>
                    )}
                    {job.status === 'qc_failed' && (
                      <Btn size="sm" variant="danger" onClick={() => setModal({ type: 'return', job })}>
                        Return to Engineer
                      </Btn>
                    )}
                  </div>
                </TD>
              </TR>
            )
          })}
          {jobs.length === 0 && (
            <TR>
              <TD style={{ textAlign: 'center', color: '#94a3b8', padding: 32 }}>
                No active refurb jobs.
              </TD>
              <TD>{''}</TD><TD>{''}</TD><TD>{''}</TD><TD>{''}</TD><TD>{''}</TD><TD>{''}</TD>
            </TR>
          )}
        </Table>
      </Card>

      {modal?.type === 'new' && (
        <NewJobModal
          devices={awaitingDevices}
          engineers={engineerUsers}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'assign' && (
        <AssignEngineerModal job={modal.job} engineers={engineerUsers} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'manage' && (
        <ManageJobModal job={modal.job} parts={parts} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'qc' && (
        <QCModal job={modal.job} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'return' && (
        <ReturnToEngineerModal job={modal.job} engineers={engineerUsers} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
