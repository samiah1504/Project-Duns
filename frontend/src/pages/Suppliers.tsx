import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSuppliers, createSupplier, updateSupplier } from '../services/api'
import { Supplier } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input, Select } from '../components/Layout'

type SupplierForm = {
  name: string
  type: string
  phone: string
  email: string
  address: string
  bank_name: string
  account_number: string
  account_name: string
  notes: string
}

const empty: SupplierForm = {
  name: '', type: 'supplier', phone: '', email: '', address: '',
  bank_name: '', account_number: '', account_name: '', notes: '',
}

export default function Suppliers() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState<SupplierForm>(empty)
  const [filterType, setFilterType] = useState('')

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', filterType],
    queryFn: () => {
      const p: Record<string, string> = {}
      if (filterType) p.supplier_type = filterType
      return getSuppliers(p).then(r => r.data)
    },
  })

  const set = (k: keyof SupplierForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const toPayload = (f: SupplierForm) => ({
    name: f.name,
    type: f.type,
    contact: {
      ...(f.phone && { phone: f.phone }),
      ...(f.email && { email: f.email }),
      ...(f.address && { address: f.address }),
    },
    bank_details: {
      ...(f.bank_name && { bank_name: f.bank_name }),
      ...(f.account_number && { account_number: f.account_number }),
      ...(f.account_name && { account_name: f.account_name }),
    },
    notes: f.notes || undefined,
  })

  const fromSupplier = (s: Supplier): SupplierForm => ({
    name: s.name,
    type: s.type,
    phone: s.contact?.phone ?? '',
    email: s.contact?.email ?? '',
    address: s.contact?.address ?? '',
    bank_name: s.bank_details?.bank_name ?? '',
    account_number: s.bank_details?.account_number ?? '',
    account_name: s.bank_details?.account_name ?? '',
    notes: s.notes ?? '',
  })

  const createMut = useMutation({
    mutationFn: (data: unknown) => createSupplier(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); setShowNew(false); toast.success('Supplier added') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => updateSupplier(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); setEditing(null); toast.success('Supplier updated') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const openNew = () => { setForm(empty); setShowNew(true) }
  const openEdit = (s: Supplier) => { setForm(fromSupplier(s)); setEditing(s) }

  const typeLabel = (t: string) => t === 'vendor' ? 'External Repair Vendor' : 'Device Supplier'

  return (
    <div style={{ padding: 28 }}>
      <PageHeader title="Suppliers & Vendors" action={<Btn onClick={openNew}>+ Add Supplier</Btn>} />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <Select
            label="Filter Type"
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            style={{ maxWidth: 220, marginBottom: 0 }}
          >
            <option value="">All</option>
            <option value="supplier">Device Suppliers</option>
            <option value="vendor">External Repair Vendors</option>
          </Select>
        </div>
      </Card>

      <Card>
        <Table headers={['Name', 'Type', 'Phone', 'Email', 'Bank', 'Notes', 'Actions']}>
          {(suppliers as Supplier[]).map(s => (
            <TR key={s.id}>
              <TD><strong>{s.name}</strong></TD>
              <TD>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                  background: s.type === 'vendor' ? '#fef3c7' : '#dbeafe',
                  color: s.type === 'vendor' ? '#92400e' : '#1d4ed8',
                }}>
                  {typeLabel(s.type)}
                </span>
              </TD>
              <TD style={{ color: '#64748b' }}>{s.contact?.phone ?? '—'}</TD>
              <TD style={{ color: '#64748b' }}>{s.contact?.email ?? '—'}</TD>
              <TD style={{ color: '#64748b', fontSize: 12 }}>
                {s.bank_details?.bank_name
                  ? `${s.bank_details.bank_name} · ${s.bank_details.account_number ?? ''}`
                  : '—'}
              </TD>
              <TD style={{ color: '#94a3b8', fontSize: 12 }}>{s.notes ?? '—'}</TD>
              <TD>
                <Btn size="sm" variant="secondary" onClick={() => openEdit(s)}>Edit</Btn>
              </TD>
            </TR>
          ))}
          {(suppliers as Supplier[]).length === 0 && (
            <tr><td colSpan={7} style={{ padding: 20, color: '#94a3b8', textAlign: 'center' }}>No suppliers yet.</td></tr>
          )}
        </Table>
      </Card>

      <SupplierModal
        open={showNew}
        title="Add Supplier / Vendor"
        form={form}
        set={set}
        onClose={() => setShowNew(false)}
        onSubmit={e => { e.preventDefault(); createMut.mutate(toPayload(form)) }}
        pending={createMut.isPending}
        submitLabel="Add"
      />

      <SupplierModal
        open={!!editing}
        title={`Edit: ${editing?.name}`}
        form={form}
        set={set}
        onClose={() => setEditing(null)}
        onSubmit={e => { e.preventDefault(); editing && updateMut.mutate({ id: editing.id, data: toPayload(form) }) }}
        pending={updateMut.isPending}
        submitLabel="Save"
      />
    </div>
  )
}

function SupplierModal({ open, title, form, set, onClose, onSubmit, pending, submitLabel }: {
  open: boolean
  title: string
  form: SupplierForm
  set: (k: keyof SupplierForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  pending: boolean
  submitLabel: string
}) {
  if (!open) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 28, width: 520,
        maxHeight: '90vh', overflow: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#64748b' }}>✕</button>
        </div>
        <form onSubmit={onSubmit}>
          <Input label="Name *" value={form.name} onChange={set('name')} required />
          <Select label="Type" value={form.type} onChange={set('type')}>
            <option value="supplier">Device Supplier</option>
            <option value="vendor">External Repair Vendor</option>
          </Select>

          <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', margin: '12px 0 8px' }}>Contact</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Phone" value={form.phone} onChange={set('phone')} />
            <Input label="Email" type="email" value={form.email} onChange={set('email')} />
          </div>
          <Input label="Address" value={form.address} onChange={set('address')} />

          <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', margin: '12px 0 8px' }}>Bank Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Bank Name" value={form.bank_name} onChange={set('bank_name')} />
            <Input label="Account Number" value={form.account_number} onChange={set('account_number')} />
          </div>
          <Input label="Account Name" value={form.account_name} onChange={set('account_name')} />

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }}>Notes</label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={2}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="secondary" onClick={onClose} type="button">Cancel</Btn>
            <Btn type="submit" disabled={pending}>{pending ? 'Saving…' : submitLabel}</Btn>
          </div>
        </form>
      </div>
    </div>
  )
}
