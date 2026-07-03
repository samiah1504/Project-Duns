import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getUsers, createUser, updateUser, updateUserPermissions } from '../services/api'
import { User } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select } from '../components/Layout'

const ALL_MODULES: { key: string; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'devices', label: 'Devices' },
  { key: 'intake', label: 'Intake / Purchase Orders' },
  { key: 'refurb', label: 'Refurb Jobs' },
  { key: 'sales', label: 'Sales' },
  { key: 'customers', label: 'Customers' },
  { key: 'parts', label: 'Parts' },
  { key: 'returns', label: 'Returns' },
  { key: 'reports', label: 'Reports' },
  { key: 'phone_models', label: 'Phone Models' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'users', label: 'User Management' },
  { key: 'settings', label: 'Settings' },
]

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  ADMIN: { bg: '#fef3c7', color: '#92400e' },
  INVENTORY: { bg: '#dbeafe', color: '#1d4ed8' },
  SALES: { bg: '#dcfce7', color: '#166534' },
  ENGINEER: { bg: '#f3e8ff', color: '#7e22ce' },
  RECORDS: { bg: '#f1f5f9', color: '#475569' },
}

export default function Users() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [permUser, setPermUser] = useState<User | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('SALES')

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getUsers().then(r => r.data) })

  const createMut = useMutation({
    mutationFn: (data: unknown) => createUser(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowNew(false)
      setName(''); setEmail(''); setPassword(''); setRole('SALES')
      toast.success('User created')
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const deactivateMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateUser(id, { is_active: active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User updated') },
    onError: () => toast.error('Error'),
  })

  const rc = (r: string) => ROLE_COLORS[r] ?? { bg: '#f1f5f9', color: '#475569' }

  return (
    <div style={{ padding: 28 }}>
      <PageHeader title="Users & Access" action={<Btn onClick={() => setShowNew(true)}>+ Add User</Btn>} />
      <Card>
        <Table headers={['Name', 'Email', 'Role', 'Access', 'Status', 'Actions']}>
          {(users as User[]).map(u => (
            <TR key={u.id}>
              <TD><strong>{u.name}</strong></TD>
              <TD style={{ color: '#64748b' }}>{u.email}</TD>
              <TD>
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 600, background: rc(u.role).bg, color: rc(u.role).color }}>
                  {u.role}
                </span>
              </TD>
              <TD>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {u.allowed_modules
                    ? <span style={{ fontSize: 11, color: '#7e22ce', background: '#f3e8ff', padding: '1px 6px', borderRadius: 4 }}>Custom ({u.effective_modules.length} modules)</span>
                    : <span style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>Role defaults ({u.effective_modules.length} modules)</span>
                  }
                </div>
              </TD>
              <TD>
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 600, background: u.is_active ? '#dcfce7' : '#fee2e2', color: u.is_active ? '#166534' : '#991b1b' }}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
              </TD>
              <TD>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" variant="ghost" onClick={() => setPermUser(u)}>Manage Access</Btn>
                  <Btn size="sm" variant={u.is_active ? 'danger' : 'secondary'}
                    onClick={() => deactivateMut.mutate({ id: u.id, active: !u.is_active })}>
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </Btn>
                </div>
              </TD>
            </TR>
          ))}
        </Table>
      </Card>

      {/* Create User modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="Add User">
        <form onSubmit={e => { e.preventDefault(); createMut.mutate({ name, email, password, role }) }}>
          <Input label="Full Name" value={name} onChange={e => setName(e.target.value)} required />
          <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          <Select label="Role" value={role} onChange={e => setRole(e.target.value)}>
            <option value="ADMIN">Admin</option>
            <option value="INVENTORY">Inventory Officer</option>
            <option value="SALES">Sales Officer</option>
            <option value="ENGINEER">Engineer</option>
            <option value="RECORDS">Records / Accounts</option>
          </Select>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, background: '#f8fafc', padding: '8px 12px', borderRadius: 6 }}>
            Default module access will be assigned based on the selected role. You can customise it after creation via "Manage Access".
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="secondary" onClick={() => setShowNew(false)} type="button">Cancel</Btn>
            <Btn type="submit" disabled={createMut.isPending}>{createMut.isPending ? 'Creating…' : 'Create User'}</Btn>
          </div>
        </form>
      </Modal>

      {/* Permissions modal */}
      {permUser && (
        <PermissionsModal
          user={permUser}
          onClose={() => setPermUser(null)}
          onSaved={(updated) => {
            qc.invalidateQueries({ queryKey: ['users'] })
            setPermUser(updated)
            toast.success('Permissions updated')
          }}
        />
      )}
    </div>
  )
}

function PermissionsModal({ user, onClose, onSaved }: {
  user: User
  onClose: () => void
  onSaved: (u: User) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(user.effective_modules))
  const [isCustom, setIsCustom] = useState(!!user.allowed_modules)

  const mut = useMutation({
    mutationFn: (data: unknown) => updateUserPermissions(user.id, data),
    onSuccess: (res) => onSaved(res.data as User),
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Error saving permissions'),
  })

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    if (!isCustom) setIsCustom(true)
  }

  const resetToDefaults = () => {
    mut.mutate({ allowed_modules: null })
    setIsCustom(false)
  }

  const save = () => {
    mut.mutate({ allowed_modules: Array.from(selected) })
  }

  const rc = (r: string) => ROLE_COLORS[r] ?? { bg: '#f1f5f9', color: '#475569' }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 28, width: 520, maxHeight: '90vh', overflow: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Manage Access</h2>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{user.name} — {user.email}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748b' }}>×</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', background: '#f8fafc', borderRadius: 8 }}>
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 600, background: rc(user.role).bg, color: rc(user.role).color }}>{user.role}</span>
          <span style={{ fontSize: 13, color: '#64748b' }}>
            {isCustom ? 'Custom permissions set' : 'Using role defaults'}
          </span>
          {isCustom && (
            <button onClick={resetToDefaults} disabled={mut.isPending} style={{
              marginLeft: 'auto', background: 'none', border: '1px solid #cbd5e1', color: '#64748b',
              padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12,
            }}>
              Reset to role defaults
            </button>
          )}
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Module Access
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
          {ALL_MODULES.map(m => {
            const on = selected.has(m.key)
            return (
              <label key={m.key} style={{
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                padding: '10px 14px', borderRadius: 8, border: `1.5px solid ${on ? '#2563eb' : '#e2e8f0'}`,
                background: on ? '#eff6ff' : '#fff', transition: 'all 0.15s',
              }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(m.key)}
                  style={{ accentColor: '#2563eb', width: 16, height: 16 }}
                />
                <span style={{ fontSize: 13, fontWeight: on ? 600 : 400, color: on ? '#1d4ed8' : '#374151' }}>
                  {m.label}
                </span>
              </label>
            )
          })}
        </div>

        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>
          {selected.size} of {ALL_MODULES.length} modules enabled
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn disabled={mut.isPending} onClick={save}>
            {mut.isPending ? 'Saving…' : 'Save Permissions'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
