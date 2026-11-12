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
import { useAuth } from '../hooks/useAuth'
import { useStockOwners, OwnerTag } from '../hooks/useStockOwners'

// ─── Who can do what (mirrors backend/app/routers/refurb_jobs.py) ────────────
type Perms = {
  createJob: boolean; assign: boolean; qc: boolean; scrapAfterQc: boolean
  addParts: (job: RefurbJob) => boolean; complete: (job: RefurbJob) => boolean; closeFromBench: (job: RefurbJob) => boolean
}
function refurbPerms(user: User | null): Perms {
  const role = user?.role ?? ''
  const manager = role === 'ADMIN' || role === 'OPERATIONS'
  const inventory = role === 'INVENTORY'
  const engineer = role === 'ENGINEER'
  // Engineers may only work on jobs assigned to them
  const ownsJob = (job: RefurbJob) => !!user && job.assigned_engineer_id === user.id
  return {
    createJob: manager || engineer,
    assign: manager || inventory,
    qc: manager || inventory,
    scrapAfterQc: manager || inventory,
    addParts: job => manager || inventory || (engineer && ownsJob(job)),
    complete: job => manager || (engineer && ownsJob(job)),
    closeFromBench: job => manager || inventory || (engineer && ownsJob(job)),
  }
}

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  open:        { label: 'Open — Awaiting Engineer', bg: '#eff6ff', color: '#1d4ed8' },
  in_progress: { label: 'With Engineer',            bg: '#fef3c7', color: '#92400e' },
  awaiting_qc: { label: 'Awaiting QC',             bg: '#ede9fe', color: '#5b21b6' },
  qc_failed:   { label: 'QC Failed',               bg: '#fee2e2', color: '#991b1b' },
  closed:      { label: 'Closed',                  bg: '#f0fdf4', color: '#166534' },
}

// ─── Device identification helpers ───────────────────────────────────────────

/** "iPhone 13 Pro 128GB · Blue" — gracefully omits missing fields. */
function deviceTitle(job: RefurbJob): string {
  const m = job.device?.model
  if (!m) return ''
  const main = [m.brand, m.model_name, m.storage].filter(Boolean).join(' ')
  return m.colour ? `${main} · ${m.colour}` : main
}

/** IMEI for a job — the identifier users trace devices by. */
function jobImei(job: RefurbJob): string | null {
  return job.device?.imei ?? job.device_imei ?? null
}

/** Short one-liner for modal headers: "IMEI: 3567… · iPhone 13 Pro 128GB" */
function deviceShort(job: RefurbJob): string {
  const imei = jobImei(job)
  const id = imei ? `IMEI: ${imei}` : (job.device?.inventory_number ?? job.device_inventory_number ?? '')
  return [id, deviceTitle(job)].filter(Boolean).join(' · ')
}

function DeviceCell({ job }: { job: RefurbJob }) {
  const d = job.device
  const imei = jobImei(job)
  const title = deviceTitle(job)
  const invNo = d?.inventory_number ?? job.device_inventory_number
  const line3 = [invNo, d?.grade ? `Grade ${d.grade}` : ''].filter(Boolean).join(' · ')
  return (
    <div>
      <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
        {imei ?? <span style={{ color: '#94a3b8', fontFamily: 'inherit', fontWeight: 400 }}>IMEI unavailable</span>}
      </div>
      {title && <div style={{ fontSize: 12, color: '#334155' }}>{title}</div>}
      {line3 && <div style={{ fontSize: 11, color: '#64748b' }}>{line3}</div>}
    </div>
  )
}

/** Shown on jobs for a customer's own phone (return resolved as repair & return). */
function CustomerRepairNote() {
  return (
    <div style={{ padding: '8px 12px', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6, fontSize: 13, color: '#9a3412' }}>
      <strong>Customer repair.</strong> This is the customer's own phone. Passing QC marks it ready to return
      to the customer (status Sold). It does not go into sellable stock.
    </div>
  )
}

function CustomerRepairTag() {
  return (
    <div style={{ display: 'inline-block', marginTop: 2, fontSize: 10, fontWeight: 700, color: '#9a3412',
      background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 4, padding: '1px 6px' }}>
      CUSTOMER REPAIR
    </div>
  )
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
    <Modal open={true} title={`Assign Engineer — ${job.job_number}${deviceShort(job) ? " · " + deviceShort(job) : ""}`} onClose={onClose}>
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

function ManageJobModal({ job, parts, perms, onClose }: { job: RefurbJob; parts: Part[]; perms: Perms; onClose: () => void }) {
  const qc = useQueryClient()
  const [partId, setPartId] = useState('')
  const [qty, setQty] = useState('1')
  const [notes, setNotes] = useState('')
  const { nameOf, house } = useStockOwners(true)
  // Parts from the phone owner's own stock first; others are charged between owners
  const phoneOwnerId = job.device_owner_id ?? house?.id ?? ''
  const ownParts = parts.filter(p => (p.owner_id ?? house?.id) === phoneOwnerId)
  const otherParts = parts.filter(p => (p.owner_id ?? house?.id) !== phoneOwnerId)
  const picked = parts.find(p => p.id === partId)
  const pickedFromOther = !!picked && (picked.owner_id ?? house?.id) !== phoneOwnerId

  const addMut = useMutation({
    mutationFn: () => addPartsToJob(job.id, { parts: [{ part_id: partId, quantity: Math.max(1, parseInt(qty) || 1) }] }),
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
    <Modal open={true} title={`${job.job_number} — With Engineer${deviceShort(job) ? " · " + deviceShort(job) : ""}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {job.customer_repair && <CustomerRepairNote />}
        {job.parts_used.length > 0 && (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>Parts used:</div>
            {job.parts_used.map(p => {
              const part = parts.find(x => x.id === p.part_id)
              const label = part
                ? `${part.name}${part.sku ? ` — SKU: ${part.sku}` : ''}`
                : p.part_id.slice(0, 6) + '…'
              return (
                <div key={p.id}>{label} — Qty: {p.quantity}</div>
              )
            })}
          </div>
        )}

        {perms.addParts(job) && <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            Add Parts <span style={{ fontWeight: 400, color: '#64748b' }}>— phone owner:</span> <OwnerTag ownerId={phoneOwnerId} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={partId} onChange={e => setPartId(e.target.value)}
              style={{ flex: 2, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}>
              <option value="">Select part…</option>
              <optgroup label={`${nameOf(phoneOwnerId)} stock`}>
                {ownParts.map(p => <option key={p.id} value={p.id}>{p.name} (stock: {p.quantity_on_hand})</option>)}
              </optgroup>
              {otherParts.length > 0 && (
                <optgroup label="Other owners' stock (charged between owners)">
                  {otherParts.map(p => (
                    <option key={p.id} value={p.id}>{p.name} — {nameOf(p.owner_id)} (stock: {p.quantity_on_hand})</option>
                  ))}
                </optgroup>
              )}
            </select>
            <input type="number" value={qty} min="1" onChange={e => setQty(e.target.value)}
              style={{ width: 60, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }} />
            <Btn size="sm" disabled={!partId || addMut.isPending} onClick={() => addMut.mutate()}>Add</Btn>
          </div>
          {pickedFromOther && picked && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 4, padding: '6px 8px' }}>
              This part is from <strong>{nameOf(picked.owner_id)}</strong>'s stock. It is paid for straight away:
              an expense for <strong>{nameOf(phoneOwnerId)}</strong> and a part sale for {nameOf(picked.owner_id)}.
            </div>
          )}
        </div>}

        {(perms.complete(job) || perms.closeFromBench(job)) && <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          {perms.complete(job) && <Input placeholder="Completion notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {perms.complete(job) && <Btn onClick={() => completeMut.mutate()} disabled={completeMut.isPending}>
              {completeMut.isPending ? '…' : 'Mark Complete → Send to QC'}
            </Btn>}
            {perms.closeFromBench(job) && <><Btn variant="secondary" size="sm"
              onClick={() => closeMut.mutate({ outcome: 'sent_external' })} disabled={closeMut.isPending}>
              Send External
            </Btn>
            <Btn variant="danger" size="sm"
              onClick={() => closeMut.mutate({ outcome: 'scrapped' })} disabled={closeMut.isPending}>
              Scrap
            </Btn></>}
          </div>
        </div>}
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['refurb-jobs'] })
      toast.success(job.customer_repair ? 'QC passed — ready to return to the customer' : 'QC passed — device is now SELLABLE')
      onClose()
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const failMut = useMutation({
    mutationFn: () => failQCJob(job.id, { notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('QC failed — returned to bench'); onClose() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open={true} title={`QC Check — ${job.job_number}${deviceShort(job) ? " · " + deviceShort(job) : ""}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: '8px 12px', background: '#ede9fe', borderRadius: 6, fontSize: 13, color: '#5b21b6' }}>
          Device is awaiting quality check. Record the inspection result.
        </div>
        {job.customer_repair && <CustomerRepairNote />}
        <Select value={newGrade} onChange={e => setNewGrade(e.target.value)}>
          <option value="">Grade unchanged</option>
          <option value="A">Upgrade to Grade A</option>
          <option value="B">Set Grade B</option>
          <option value="C">Set Grade C</option>
        </Select>
        <Input placeholder="QC notes" value={notes} onChange={e => setNotes(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={() => passMut.mutate()} disabled={passMut.isPending}>
            {passMut.isPending ? '…' : job.customer_repair ? '✓ Pass QC — Return to Customer' : '✓ Pass QC — Move to Sellable'}
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

function ReturnToEngineerModal({ job, engineers, canScrap, onClose }: { job: RefurbJob; engineers: User[]; canScrap: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [engId, setEngId] = useState(job.assigned_engineer_id ?? '')
  const [notes, setNotes] = useState('')

  const mut = useMutation({
    mutationFn: () => returnToEngineerJob(job.id, { engineer_id: engId || undefined, notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('Returned to engineer'); onClose() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const scrapMut = useMutation({
    mutationFn: () => closeRefurbJob(job.id, { outcome: 'scrapped', notes: notes || 'Scrapped after failed QC' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refurb-jobs'] }); toast.success('Device scrapped'); onClose() },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open={true} title={`QC Failed — ${job.job_number}${deviceShort(job) ? " · " + deviceShort(job) : ""}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: '8px 12px', background: '#fee2e2', borderRadius: 6, fontSize: 13, color: '#991b1b' }}>
          QC failed. Return the device to an engineer for rework{canScrap ? ', or scrap it if it is beyond repair' : ''}.
        </div>
        <Select value={engId} onChange={e => setEngId(e.target.value)}>
          <option value="">Same engineer</option>
          {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Input placeholder="Rework instructions / scrap reason" value={notes} onChange={e => setNotes(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          {canScrap && (
            <Btn variant="danger" disabled={scrapMut.isPending || mut.isPending}
              onClick={() => { if (window.confirm('Scrap this device? This cannot be undone.')) scrapMut.mutate() }}>
              {scrapMut.isPending ? '…' : 'Scrap Device'}
            </Btn>
          )}
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
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const { user } = useAuth()
  const perms = refurbPerms(user)

  // Searching (IMEI, inventory # or job #) goes to the server and covers ALL jobs,
  // including closed ones, so any device's refurb history can be traced.
  const searchTerm = search.trim()
  const { data: jobs = [] } = useQuery<RefurbJob[]>({
    queryKey: ['refurb-jobs', filterStatus, searchTerm],
    queryFn: () => {
      const p: Record<string, string> = {}
      if (filterStatus) p.status = filterStatus
      else if (!searchTerm) p.active_only = 'true'
      if (searchTerm) p.search = searchTerm
      return getRefurbJobs(p).then(r => r.data)
    },
    placeholderData: prev => prev,
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

  const visibleJobs = jobs

  // Modals get the latest copy of the job so e.g. "Parts used" updates after adding parts
  const liveJob = (job: RefurbJob) => jobs.find(j => j.id === job.id) ?? job

  return (
    <div>
      <PageHeader
        title="Refurb Jobs"
        action={perms.createJob ? <Btn onClick={() => setModal({ type: 'new' })}>+ New Job</Btn> : undefined}
      />

      <Card style={{ marginBottom: 8, padding: '8px 16px', background: '#eff6ff', borderColor: '#93c5fd' }}>
        <span style={{ fontSize: 12, color: '#1e40af' }}>
          Jobs are created automatically when a device is received as Awaiting Refurb. Only active jobs are shown by default — searching by IMEI, inventory # or job # also finds closed jobs. A device returns to Sellable Stock when it passes QC.
        </span>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search IMEI, inventory #, brand, model or job #…"
            style={{ flex: 1, minWidth: 240, padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
          <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Active jobs only</option>
            <option value="open">Open — Awaiting Engineer</option>
            <option value="in_progress">In Progress</option>
            <option value="awaiting_qc">Awaiting QC</option>
            <option value="qc_failed">QC Failed</option>
            <option value="closed">Closed</option>
          </Select>
          <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
            {visibleJobs.length} job{visibleJobs.length !== 1 ? 's' : ''}
          </span>
        </div>
      </Card>

      <Card>
        <Table headers={['Job #', 'IMEI / Device', 'Engineer', 'Status', 'Opened', 'Parts', 'Actions']}>
          {visibleJobs.map(job => {
            const eng = engineers.find(u => u.id === job.assigned_engineer_id)
            return (
              <TR key={job.id}>
                <TD>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{job.job_number}</div>
                  {job.auto_created && (
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>auto</div>
                  )}
                  {job.customer_repair && <CustomerRepairTag />}
                </TD>
                <TD><DeviceCell job={job} /></TD>
                <TD style={{ color: eng ? '#1e293b' : '#94a3b8' }}>{eng?.name ?? 'Unassigned'}</TD>
                <TD><JobStatusBadge status={job.status} /></TD>
                <TD style={{ color: '#64748b', fontSize: 12 }}>{job.date_opened}</TD>
                <TD style={{ color: '#64748b', fontSize: 12 }}>{job.parts_used.length}</TD>
                <TD>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {job.status === 'open' && perms.assign && (
                      <Btn size="sm" onClick={() => setModal({ type: 'assign', job })}>
                        Assign Engineer
                      </Btn>
                    )}
                    {job.status === 'in_progress' && (perms.addParts(job) || perms.complete(job)) && (
                      <Btn size="sm" onClick={() => setModal({ type: 'manage', job })}>
                        Manage / Parts
                      </Btn>
                    )}
                    {job.status === 'awaiting_qc' && perms.qc && (
                      <Btn size="sm" variant="ghost" onClick={() => setModal({ type: 'qc', job })}>
                        QC Check
                      </Btn>
                    )}
                    {job.status === 'qc_failed' && perms.qc && (
                      <Btn size="sm" variant="danger" onClick={() => setModal({ type: 'return', job })}>
                        Rework / Scrap
                      </Btn>
                    )}
                  </div>
                </TD>
              </TR>
            )
          })}
          {visibleJobs.length === 0 && (
            <TR>
              <TD style={{ textAlign: 'center', color: '#94a3b8', padding: 32 }}>
                {search ? 'No jobs match your search.' : 'No active refurb jobs.'}
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
        <ManageJobModal job={liveJob(modal.job)} parts={parts} perms={perms} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'qc' && (
        <QCModal job={modal.job} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'return' && (
        <ReturnToEngineerModal job={modal.job} engineers={engineerUsers} canScrap={perms.scrapAfterQc} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
