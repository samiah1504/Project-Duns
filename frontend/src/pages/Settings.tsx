import { useState } from 'react'
import toast from 'react-hot-toast'
import { PageHeader, Card, Btn } from '../components/Layout'
import { getCompanySettings, saveCompanySettings, CompanySettings } from '../hooks/useCompanySettings'

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
