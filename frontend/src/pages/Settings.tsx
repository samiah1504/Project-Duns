import { useState } from 'react'
import toast from 'react-hot-toast'
import { PageHeader, Card, Btn } from '../components/Layout'
import { getCompanySettings, saveCompanySettings, CompanySettings } from '../hooks/useCompanySettings'
import { getLabelSizes, saveLabelSizes, LabelSize } from '../hooks/useLabelSizes'

// ─── Label Size Manager ───────────────────────────────────────────────────────

interface SizeForm {
  name: string
  widthMm: string
  heightMm: string
}

const emptySizeForm = (): SizeForm => ({ name: '', widthMm: '', heightMm: '' })

function LabelSizeSettings() {
  const [sizes, setSizes] = useState<LabelSize[]>(getLabelSizes)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<SizeForm>(emptySizeForm)

  const persist = (next: LabelSize[]) => {
    setSizes(next)
    saveLabelSizes(next)
  }

  const startAdd = () => {
    setAdding(true)
    setEditing(null)
    setForm(emptySizeForm())
  }

  const startEdit = (s: LabelSize) => {
    setEditing(s.id)
    setAdding(false)
    setForm({ name: s.name, widthMm: String(s.widthMm), heightMm: String(s.heightMm) })
  }

  const cancel = () => { setAdding(false); setEditing(null); setForm(emptySizeForm()) }

  const validateForm = (): { widthMm: number; heightMm: number } | null => {
    const w = parseFloat(form.widthMm)
    const h = parseFloat(form.heightMm)
    if (!form.name.trim()) { toast.error('Name is required'); return null }
    if (!w || w <= 0) { toast.error('Width must be a positive number'); return null }
    if (!h || h <= 0) { toast.error('Height must be a positive number'); return null }
    return { widthMm: w, heightMm: h }
  }

  const handleAdd = () => {
    const dims = validateForm()
    if (!dims) return
    const next: LabelSize = {
      id: `size-${Date.now()}`,
      name: form.name.trim(),
      widthMm: dims.widthMm,
      heightMm: dims.heightMm,
    }
    persist([...sizes, next])
    toast.success('Label size added')
    cancel()
  }

  const handleUpdate = () => {
    const dims = validateForm()
    if (!dims) return
    persist(sizes.map(s =>
      s.id === editing
        ? { ...s, name: form.name.trim(), widthMm: dims.widthMm, heightMm: dims.heightMm }
        : s
    ))
    toast.success('Label size updated')
    cancel()
  }

  const handleDelete = (id: string) => {
    if (!confirm('Delete this label size?')) return
    persist(sizes.filter(s => s.id !== id))
    toast.success('Deleted')
  }

  const F: React.CSSProperties = {
    padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6,
    fontSize: 13, outline: 'none', background: '#fff',
  }

  return (
    <Card style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>Label Printing Sizes</h3>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
            Add label sizes to match your printer paper. All sizes can be edited or deleted.
          </p>
        </div>
        {!adding && !editing && (
          <Btn size="sm" onClick={startAdd}>+ Add Size</Btn>
        )}
      </div>

      {/* Size list */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: adding ? 16 : 0 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
            {['Name', 'Width (mm)', 'Height (mm)', ''].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sizes.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: '16px 10px', color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
                No label sizes yet. Click "+ Add Size" to add one.
              </td>
            </tr>
          )}
          {sizes.map(s => (
            <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              {editing === s.id ? (
                <>
                  <td style={{ padding: '6px 10px' }}>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      style={{ ...F, width: '100%' }} placeholder="Label name" />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input value={form.widthMm} onChange={e => setForm(f => ({ ...f, widthMm: e.target.value }))}
                      style={{ ...F, width: 80 }} type="number" min="10" step="0.5" placeholder="30" />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input value={form.heightMm} onChange={e => setForm(f => ({ ...f, heightMm: e.target.value }))}
                      style={{ ...F, width: 80 }} type="number" min="10" step="0.5" placeholder="25" />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn size="sm" onClick={handleUpdate}>Save</Btn>
                      <Btn size="sm" variant="secondary" onClick={cancel}>Cancel</Btn>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td style={{ padding: '6px 10px' }}>{s.name}</td>
                  <td style={{ padding: '6px 10px', color: '#475569' }}>{s.widthMm}</td>
                  <td style={{ padding: '6px 10px', color: '#475569' }}>{s.heightMm}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn size="sm" variant="secondary" onClick={() => startEdit(s)}>Edit</Btn>
                      <Btn size="sm" variant="danger" onClick={() => handleDelete(s.id)}>Delete</Btn>
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Add form */}
      {adding && (
        <div style={{
          marginTop: 12, padding: 14, background: '#f8fafc',
          border: '1px solid #e2e8f0', borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>New Label Size</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Display Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                style={{ ...F, width: '100%' }} placeholder="e.g. 40 mm × 30 mm" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Width (mm) *</label>
              <input value={form.widthMm} onChange={e => setForm(f => ({ ...f, widthMm: e.target.value }))}
                style={{ ...F, width: '100%' }} type="number" min="10" step="0.5" placeholder="30" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Height (mm) *</label>
              <input value={form.heightMm} onChange={e => setForm(f => ({ ...f, heightMm: e.target.value }))}
                style={{ ...F, width: '100%' }} type="number" min="10" step="0.5" placeholder="25" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn size="sm" onClick={handleAdd}>Add Size</Btn>
            <Btn size="sm" variant="secondary" onClick={cancel}>Cancel</Btn>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Main Settings page ───────────────────────────────────────────────────────

export default function Settings() {
  const [form, setForm] = useState<CompanySettings>(getCompanySettings)
  const [saved, setSaved] = useState(false)

  const set = (k: keyof CompanySettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  const save = () => {
    if (!form.name.trim()) { toast.error('Company name is required'); return }
    saveCompanySettings(form)
    setSaved(true)
    toast.success('Company details saved')
    setTimeout(() => setSaved(false), 2000)
  }

  const reset = () => {
    if (!confirm('Reset to default values?')) return
    localStorage.removeItem('tardmart_company_settings')
    setForm(getCompanySettings())
    toast('Reset to defaults')
  }

  const L: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 5 }
  const F: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 14, boxSizing: 'border-box', marginBottom: 16 }
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }

  return (
    <div>
      <PageHeader title="Company Settings" />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, padding: '0 24px 24px' }}>

        <div>
          <Card>
            <h3 style={{ margin: '0 0 20px', fontSize: 15 }}>Company Details</h3>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>
              These details appear on all receipts, invoices, and barcode labels.
            </p>

            <div style={grid}>
              <div>
                <label style={L}>Company Name *</label>
                <input style={F} value={form.name} onChange={set('name')} placeholder="Tardmart Ventures" />
              </div>
              <div>
                <label style={L}>Tagline</label>
                <input style={F} value={form.tagline} onChange={set('tagline')} placeholder="Quality Refurbished Phones" />
              </div>
              <div>
                <label style={L}>Phone Number</label>
                <input style={F} value={form.phone} onChange={set('phone')} placeholder="+234 800 000 0000" />
              </div>
              <div>
                <label style={L}>Email Address</label>
                <input style={F} value={form.email} onChange={set('email')} placeholder="info@tardmart.com" type="email" />
              </div>
            </div>

            <div>
              <label style={L}>Address</label>
              <input style={F} value={form.address} onChange={set('address')} placeholder="Full address" />
            </div>

            <div>
              <label style={L}>Bank / Payment Details</label>
              <textarea
                style={{ ...F, minHeight: 72, resize: 'vertical', fontFamily: 'inherit' }}
                value={form.bankDetails}
                onChange={set('bankDetails')}
                placeholder="Bank name, account number, account name"
              />
            </div>

            <div>
              <label style={L}>Receipt Footer Note</label>
              <textarea
                style={{ ...F, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
                value={form.receiptNote}
                onChange={set('receiptNote')}
                placeholder="Thank you for your business!"
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn variant="secondary" onClick={reset}>Reset to Defaults</Btn>
              <Btn onClick={save}>{saved ? '✓ Saved' : 'Save Changes'}</Btn>
            </div>
          </Card>

          <LabelSizeSettings />
        </div>

        {/* Preview */}
        <div>
          <Card style={{ padding: 20 }}>
            <h4 style={{ margin: '0 0 14px', fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Receipt Header Preview</h4>
            <div style={{
              border: '1px solid #e2e8f0', borderRadius: 8, padding: 16,
              fontFamily: 'Arial, sans-serif', fontSize: 12, textAlign: 'center',
            }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{form.name || 'Company Name'}</div>
              {form.tagline && <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{form.tagline}</div>}
              {form.phone && <div style={{ fontSize: 11, marginTop: 4 }}>📞 {form.phone}</div>}
              {form.email && <div style={{ fontSize: 11 }}>✉ {form.email}</div>}
              {form.address && <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{form.address}</div>}
              <div style={{ borderTop: '1px solid #ddd', marginTop: 10, paddingTop: 8, fontSize: 10, color: '#888' }}>
                Receipt No: INV-20240101-001 &nbsp;|&nbsp; Date: {new Date().toISOString().slice(0, 10)}
              </div>
            </div>

            {form.bankDetails && (
              <>
                <h4 style={{ margin: '16px 0 10px', fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Payment Details Preview</h4>
                <div style={{
                  border: '1px solid #e2e8f0', borderRadius: 8, padding: 12,
                  fontFamily: 'Arial, sans-serif', fontSize: 11, whiteSpace: 'pre-wrap',
                  background: '#f8fafc', color: '#374151',
                }}>
                  {form.bankDetails}
                </div>
              </>
            )}

            {form.receiptNote && (
              <>
                <h4 style={{ margin: '16px 0 10px', fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Footer Preview</h4>
                <div style={{
                  border: '1px solid #e2e8f0', borderRadius: 8, padding: 12,
                  fontFamily: 'Arial, sans-serif', fontSize: 11, textAlign: 'center',
                  color: '#555', fontStyle: 'italic',
                }}>
                  {form.receiptNote}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
