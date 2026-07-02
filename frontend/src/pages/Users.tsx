import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getUsers, createUser, updateUser } from '../services/api'
import { User } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select } from '../components/Layout'

export default function Users() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('SALES')

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => getUsers().then(r => r.data) })

  const createMut = useMutation({
    mutationFn: (data: unknown) => createUser(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowNew(false); toast.success('User created') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const deactivateMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateUser(id, { is_active: active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User updated') },
    onError: () => toast.error('Error'),
  })

  return (
    <div style={{ padding: 28 }}>
      <PageHeader title="Users" action={<Btn onClick={() => setShowNew(true)}>+ Add User</Btn>} />
      <Card>
        <Table headers={['Name', 'Email', 'Role', 'Status', 'Actions']}>
          {(users as User[]).map(u => (
            <TR key={u.id}>
              <TD><strong>{u.name}</strong></TD>
              <TD style={{ color: '#64748b' }}>{u.email}</TD>
              <TD>
                <span style={{
                  fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                  background: '#dbeafe', color: '#1d4ed8',
                }}>
                  {u.role}
                </span>
              </TD>
              <TD>
                <span style={{
                  fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                  background: u.is_active ? '#dcfce7' : '#fee2e2',
                  color: u.is_active ? '#166534' : '#991b1b',
                }}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
              </TD>
              <TD>
                <Btn size="sm" variant={u.is_active ? 'danger' : 'secondary'}
                  onClick={() => deactivateMut.mutate({ id: u.id, active: !u.is_active })}>
                  {u.is_active ? 'Deactivate' : 'Activate'}
                </Btn>
              </TD>
            </TR>
          ))}
        </Table>
      </Card>

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
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="secondary" onClick={() => setShowNew(false)} type="button">Cancel</Btn>
            <Btn type="submit" disabled={createMut.isPending}>{createMut.isPending ? 'Creating…' : 'Create User'}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  )
}
