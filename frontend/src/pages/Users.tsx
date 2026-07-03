import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getUsers, createUser, updateUser, updateUserPermissions, resetUserPassword } from '../services/api'
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
  { key: 'expenses', label: 'Warehouse Expenses' },
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
  const [editUser, setEditUser] = useState<User | null>(null)
  const [resetUser, setResetUser] = useState<User | null>(null)

  // Create form state
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [employeeId, setEmployeeId] = useState('')
  const [role, setRole] = useState('SALES')

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getUsers().then(r => r.data) })

  const createMut = useMutation({
    mutationFn: (data: unknown) => createUser(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowNew(false)
      setName(''); setUsername(''); setPassword(''); setEmployeeId(''); setRole('SALES')
      toast.success('User created')
    },
    onError: (e: any) => toast.error(e.response?.data?.detail ?? 'Error'),
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
        <Table headers={['Name', 'Username', 'Employee ID', 'Role', 'Access', 'Status', 'Actions']}>
          {(users as User[]).map(u => (
            <TR key={u.id}>
              <TD>
                <strong>{u.name}</strong>
                {u.must_change_password && (
                  <span style={{ marginLeft: 6, fontSize: 10, background: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: 3 }}>
                    Must Change PW
                  </span>
                )}
              </TD>
              <TD style={{ color: '#64748b' }}>{u.username}</TD>
              <TD style={{ color: '#64748b', fontSize: 13 }}>{u.employee_id || '—'}</TD>
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
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <Btn size="sm" variant="ghost" onClick={() => setEditUser(u)}>Edit</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setPermUser(u)}>Access</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => setResetUser(u)}>Reset PW</Btn>
                  <Btn size="sm" variant={u.is_active ? 'danger' : 'secondary'}
                    onClick={() => deactivateMut.mutate({ id: u.id, active: !u.is_active })}>
                    {u.is_active ? 'Disable' : 'Enable'}
                  </Btn>
                </div>
              </TD>
            </TR>
          ))}
        </Table>
      </Card>

      {/* Create User modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="Add User">
        <form onSubmit={e => { e.preventDefault(); createMut.mutate({ name, username, password, employee_id: employeeId || null, role }) }}>
          <Input label="Full Name" value={name} onChange={e => setName(e.target.value)} required />
          <Input label="Username" value={username} onChange={e => setUsername(e.target.value)} required autoComplete="off" />
          <Input label="Employee ID (optional)" value={employeeId} onChange={e => setEmployeeId(e.target.value)} />
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                style={{ width: '100%', padding: '8px 40px 8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 15 }}>
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>
          <Select label="Role" value={role} onChange={e => setRole(e.target.value)}>
            <option value="ADMIN">Admin</option>
            <option value="INVENTORY">Inventory Officer</option>
            <option value="SALES">Sales Officer</option>
            <option value="ENGINEER">Engineer</option>
            <option value="RECORDS">Records / Accounts</option>
          </Select>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, background: '#f8fafc', padding: '8px 12px', borderRadius: 6 }}>
            User will be required to change password on first login. Default module access will be assigned based on role.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="secondary" onClick={() => setShowNew(false)} type="button">Cancel</Btn>
            <Btn type="submit" disabled={createMut.isPending}>{createMut.isPending ? 'Creating…' : 'Create User'}</Btn>
          </div>
        </form>
      </Modal>

      {/* Edit User modal */}
      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['users'] }); setEditUser(null); toast.success('User updated') }}
        />
      )}

      {/* Reset Password modal */}
      {resetUser && (
        <ResetPasswordModal
          user={resetUser}
          onClose={() => setResetUser(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['users'] }); setResetUser(null); toast.success('Password reset — user must change on next login') }}
        />
      )}

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

function EditUserModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user.name)
  const [username, setUsername] = useState(user.username)
  const [employeeId, setEmployeeId] = useState(user.employee_id ?? '')
  const [role, setRole] = useState(user.role)

  const mut = useMutation({
    mutationFn: (data: unknown) => updateUser(user.id, data),
    onSuccess: onSaved,
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open onClose={onClose} title={`Edit User — ${user.name}`}>
      <form onSubmit={e => { e.preventDefault(); mut.mutate({ name, username, employee_id: employeeId || null, role }) }}>
        <Input label="Full Name" value={name} onChange={e => setName(e.target.value)} required />
        <Input label="Username" value={username} onChange={e => setUsername(e.target.value)} required />
        <Input label="Employee ID (optional)" value={employeeId} onChange={e => setEmployeeId(e.target.value)} />
        <Select label="Role" value={role} onChange={e => setRole(e.target.value as any)}>
          <option value="ADMIN">Admin</option>
          <option value="INVENTORY">Inventory Officer</option>
          <option value="SALES">Sales Officer</option>
          <option value="ENGINEER">Engineer</option>
          <option value="RECORDS">Records / Accounts</option>
        </Select>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save Changes'}</Btn>
        </div>
      </form>
    </Modal>
  )
}

function ResetPasswordModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const mut = useMutation({
    mutationFn: (data: unknown) => resetUserPassword(user.id, data),
    onSuccess: onSaved,
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? 'Error'),
  })

  return (
    <Modal open onClose={onClose} title={`Reset Password — ${user.name}`}>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        Set a temporary password. The user will be required to change it on their next login.
      </div>
      <form onSubmit={e => { e.preventDefault(); mut.mutate({ new_password: newPassword }) }}>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }}>New Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              style={{ width: '100%', padding: '8px 40px 8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
            <button type="button" onClick={() => setShowPassword(v => !v)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 15 }}>
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" disabled={mut.isPending}>{mut.isPending ? 'Resetting…' : 'Reset Password'}</Btn>
        </div>
      </form>
    </Modal>
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
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{user.name} — @{user.username}</div>
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
