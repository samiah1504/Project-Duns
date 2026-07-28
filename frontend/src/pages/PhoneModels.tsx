import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getPhoneModels, createPhoneModel } from '../services/api'
import { PhoneModel } from '../types'
import { PageHeader, Card, Table, TR, TD, Btn, Modal, Input } from '../components/Layout'

type ModelForm = {
  brand: string
  model_name: string
  ram: string
  storage: string
  colour: string
}

const empty: ModelForm = { brand: '', model_name: '', ram: '', storage: '', colour: '' }

const COMMON_BRANDS = ['Apple', 'Samsung', 'Tecno', 'Infinix', 'Itel', 'Xiaomi', 'OnePlus', 'Google', 'Nokia']
const COMMON_RAM = ['4GB', '6GB', '8GB', '12GB', '16GB', '18GB', '24GB']
const COMMON_STORAGE = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB']

export default function PhoneModels() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState<ModelForm>(empty)
  const [search, setSearch] = useState('')

  const { data: models = [] } = useQuery({
    queryKey: ['phone-models'],
    queryFn: () => getPhoneModels().then(r => r.data),
  })

  const set = (k: keyof ModelForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const mut = useMutation({
    mutationFn: (data: unknown) => createPhoneModel(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['phone-models'] }); setShowNew(false); setForm(empty); toast.success('Model added') },
    onError: (e: { response?: { data?: { detail?: string } } }) => toast.error(e.response?.data?.detail ?? 'Error'),
  })

  const filtered = (models as PhoneModel[]).filter(m => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      m.brand.toLowerCase().includes(q) ||
      m.model_name.toLowerCase().includes(q) ||
      (m.ram ?? '').toLowerCase().includes(q) ||
      (m.storage ?? '').toLowerCase().includes(q) ||
      (m.colour ?? '').toLowerCase().includes(q)
    )
  })

  // Group by brand for display
  const byBrand: Record<string, PhoneModel[]> = {}
  for (const m of filtered) {
    if (!byBrand[m.brand]) byBrand[m.brand] = []
    byBrand[m.brand].push(m)
  }

  return (
    <div style={{ padding: 28 }}>
      <PageHeader title="Phone Models" action={<Btn onClick={() => { setForm(empty); setShowNew(true) }}>+ Add Model</Btn>} />

      <Card style={{ marginBottom: 16 }}>
        <Input
          label="Search models"
          placeholder="Brand, model name, storage, colour…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: 0 }}
        />
      </Card>

      {Object.keys(byBrand).length === 0 ? (
        <Card>
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>
            No models yet. Add your first phone model to get started.
          </div>
        </Card>
      ) : (
        Object.entries(byBrand).map(([brand, items]) => (
          <div key={brand} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>{brand.toUpperCase()}</div>
            <Card style={{ padding: 0 }}>
              <Table headers={['Model Name', 'RAM', 'ROM', 'Colour', 'Added']}>
                {items.map(m => (
                  <TR key={m.id}>
                    <TD><strong>{m.model_name}</strong></TD>
                    <TD style={{ color: '#64748b' }}>{m.ram ?? '—'}</TD>
                    <TD style={{ color: '#64748b' }}>{m.storage ?? '—'}</TD>
                    <TD style={{ color: '#64748b' }}>{m.colour ?? '—'}</TD>
                    <TD style={{ color: '#94a3b8', fontSize: 12 }}>{new Date(m.created_at).toLocaleDateString('en-GB')}</TD>
                  </TR>
                ))}
              </Table>
            </Card>
          </div>
        ))
      )}

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Add Phone Model">
        <form onSubmit={e => {
          e.preventDefault()
          mut.mutate({
            brand: form.brand,
            model_name: form.model_name,
            ram: form.ram || undefined,
            storage: form.storage || undefined,
            colour: form.colour || undefined,
          })
        }}>
          {/* Brand — datalist for quick pick from common brands */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }}>Brand *</label>
            <input
              list="brand-list"
              value={form.brand}
              onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
              required
              placeholder="e.g. Apple, Samsung…"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
            />
            <datalist id="brand-list">
              {COMMON_BRANDS.map(b => <option key={b} value={b} />)}
            </datalist>
          </div>

          <Input label="Model Name *" value={form.model_name} onChange={set('model_name')} required placeholder="e.g. iPhone 11, Galaxy A54…" />

          {/* RAM */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }}>RAM</label>
            <select
              value={form.ram}
              onChange={e => setForm(f => ({ ...f, ram: e.target.value }))}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, background: '#fff' }}
            >
              <option value="">— Select —</option>
              {COMMON_RAM.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* ROM / Storage — datalist */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }}>ROM (Storage)</label>
            <input
              list="storage-list"
              value={form.storage}
              onChange={e => setForm(f => ({ ...f, storage: e.target.value }))}
              placeholder="e.g. 64GB, 128GB…"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
            />
            <datalist id="storage-list">
              {COMMON_STORAGE.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>

          <Input label="Colour" value={form.colour} onChange={set('colour')} placeholder="e.g. Midnight, White, Black…" />

          <div style={{ background: '#f8fafc', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: '#475569', marginBottom: 16 }}>
            <strong>Tip:</strong> Create a separate entry for each storage/colour variant — e.g. "iPhone 11 64GB Black" and "iPhone 11 128GB White" as two records. This lets you track stock accurately per variant.
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="secondary" onClick={() => setShowNew(false)} type="button">Cancel</Btn>
            <Btn type="submit" disabled={mut.isPending}>{mut.isPending ? 'Adding…' : 'Add Model'}</Btn>
          </div>
        </form>
      </Modal>
    </div>
  )
}
