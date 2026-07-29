import { useState, useCallback, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import { PageHeader, Card, Btn } from '../components/Layout'
import {
  LabelTemplate, LabelField, FieldType, FIELD_LABELS,
  getTemplates, saveTemplates, getDefaultTemplateId, saveDefaultTemplateId,
  createTemplate, updateTemplate, deleteTemplate,
} from '../hooks/useLabelTemplates'
import { getLabelSizes, saveLabelSizes, getSelectedLabelSizeId, saveSelectedLabelSizeId, LabelSize } from '../hooks/useLabelSizes'
import { buildPreviewHTML, buildPrintHTML, SAMPLE_DEVICE } from '../utils/labelRenderer'

// ─── helpers ─────────────────────────────────────────────────────────────────

function deepClone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) }

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldRow({
  field, index, total, selected,
  onToggle, onMove, onSelect,
}: {
  field: LabelField
  index: number
  total: number
  selected: boolean
  onToggle: () => void
  onMove: (dir: -1 | 1) => void
  onSelect: () => void
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        background: selected ? '#eff6ff' : field.enabled ? '#fff' : '#f8fafc',
        border: `1px solid ${selected ? '#3b82f6' : '#e2e8f0'}`,
        borderRadius: 6, marginBottom: 4, cursor: 'pointer',
        opacity: field.enabled ? 1 : 0.55,
      }}
    >
      <input
        type="checkbox"
        checked={field.enabled}
        onChange={e => { e.stopPropagation(); onToggle() }}
        style={{ accentColor: '#3b82f6', cursor: 'pointer' }}
      />
      <span style={{ flex: 1, fontSize: 13, fontWeight: field.enabled ? 600 : 400 }}>
        {FIELD_LABELS[field.type]}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <button
          disabled={index === 0}
          onClick={e => { e.stopPropagation(); onMove(-1) }}
          style={{ fontSize: 9, padding: '0 4px', lineHeight: 1.4, cursor: 'pointer', border: '1px solid #cbd5e1', borderRadius: 3, background: '#f8fafc', color: index === 0 ? '#cbd5e1' : '#374151' }}
        >▲</button>
        <button
          disabled={index === total - 1}
          onClick={e => { e.stopPropagation(); onMove(1) }}
          style={{ fontSize: 9, padding: '0 4px', lineHeight: 1.4, cursor: 'pointer', border: '1px solid #cbd5e1', borderRadius: 3, background: '#f8fafc', color: index === total - 1 ? '#cbd5e1' : '#374151' }}
        >▼</button>
      </div>
    </div>
  )
}

// ─── Field Settings Panel ─────────────────────────────────────────────────────

function FieldSettingsPanel({ field, onChange }: { field: LabelField; onChange: (f: LabelField) => void }) {
  const isBarcode = field.type === 'barcode' || field.type === 'qr_code'
  const F: React.CSSProperties = { padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 13, width: '100%' }
  const LB: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }
  const G: React.CSSProperties = { marginBottom: 12 }

  return (
    <div style={{ padding: 14, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 12 }}>
        {FIELD_LABELS[field.type]} Settings
      </div>

      {!isBarcode && (
        <>
          <div style={G}>
            <label style={LB}>Font Size (pt)</label>
            <input style={F} type="number" min="4" max="72" value={field.fontSize}
              onChange={e => onChange({ ...field, fontSize: parseFloat(e.target.value) || 8 })} />
          </div>
          <div style={G}>
            <label style={LB}>Weight</label>
            <select style={F} value={field.bold ? 'bold' : 'normal'}
              onChange={e => onChange({ ...field, bold: e.target.value === 'bold' })}>
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
            </select>
          </div>
          <div style={G}>
            <label style={LB}>Alignment</label>
            <select style={F} value={field.align}
              onChange={e => onChange({ ...field, align: e.target.value as LabelField['align'] })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </>
      )}

      {isBarcode && (
        <>
          <div style={G}>
            <label style={LB}>Barcode Height (mm)</label>
            <input style={F} type="number" min="4" max="50" value={field.barcodeHeight ?? 12}
              onChange={e => onChange({ ...field, barcodeHeight: parseFloat(e.target.value) || 12 })} />
          </div>
          <div style={G}>
            <label style={LB}>Module Width (scale)</label>
            <input style={F} type="number" min="1" max="5" step="0.5" value={field.barcodeModuleWidth ?? 2}
              onChange={e => onChange({ ...field, barcodeModuleWidth: parseFloat(e.target.value) || 2 })} />
          </div>
          <div style={G}>
            <label style={LB}>Alignment</label>
            <select style={F} value={field.align}
              onChange={e => onChange({ ...field, align: e.target.value as LabelField['align'] })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={LB}>Padding Top (mm)</label>
          <input style={F} type="number" min="0" max="20" step="0.5" value={field.paddingTop}
            onChange={e => onChange({ ...field, paddingTop: parseFloat(e.target.value) || 0 })} />
        </div>
        <div>
          <label style={LB}>Padding Bottom (mm)</label>
          <input style={F} type="number" min="0" max="20" step="0.5" value={field.paddingBottom}
            onChange={e => onChange({ ...field, paddingBottom: parseFloat(e.target.value) || 0 })} />
        </div>
      </div>
    </div>
  )
}

// ─── Main LabelDesigner ───────────────────────────────────────────────────────

export default function LabelDesigner() {
  const [templates, setTemplates] = useState<LabelTemplate[]>(getTemplates)
  const [activeId, setActiveId] = useState<string>(() => getDefaultTemplateId())
  const [defaultId, setDefaultId] = useState<string>(getDefaultTemplateId)
  const [sizes, setSizes] = useState<LabelSize[]>(getLabelSizes)
  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(getSelectedLabelSizeId)
  const [selectedFieldIdx, setSelectedFieldIdx] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const active = templates.find(t => t.id === activeId) ?? templates[0]
  const selectedSize = sizes.find(s => s.id === selectedSizeId) ?? sizes[0] ?? null

  // Persist and refresh templates list
  const persistTemplates = useCallback((next: LabelTemplate[]) => {
    setTemplates(next)
    saveTemplates(next)
  }, [])

  // Persist active template changes
  const updateActive = useCallback((tmpl: LabelTemplate) => {
    const next = templates.map(t => t.id === tmpl.id ? tmpl : t)
    persistTemplates(next)
  }, [templates, persistTemplates])

  const updateField = (idx: number, field: LabelField) => {
    if (!active) return
    const newFields = active.fields.map((f, i) => i === idx ? field : f)
    updateActive({ ...active, fields: newFields })
  }

  const toggleField = (idx: number) => {
    if (!active) return
    const f = active.fields[idx]
    updateField(idx, { ...f, enabled: !f.enabled })
  }

  const moveField = (idx: number, dir: -1 | 1) => {
    if (!active) return
    const newFields = moveItem(active.fields, idx, idx + dir)
    updateActive({ ...active, fields: newFields })
    setSelectedFieldIdx(idx + dir)
  }

  // Preview iframe
  useEffect(() => {
    if (!active || !selectedSize || !iframeRef.current) return
    const html = buildPreviewHTML(active, SAMPLE_DEVICE, selectedSize)
    iframeRef.current.srcdoc = html
  }, [active, selectedSize])

  // Template actions
  const selectTemplate = (id: string) => {
    setActiveId(id)
    setSelectedFieldIdx(null)
    setRenaming(false)
  }

  const handleSetDefault = () => {
    saveDefaultTemplateId(active.id)
    setDefaultId(active.id)
    toast.success(`"${active.name}" is now the default template`)
  }

  const handleDuplicate = () => {
    const name = `${active.name} (copy)`
    const tmpl = createTemplate(name, active)
    setTemplates(getTemplates())
    setActiveId(tmpl.id)
    toast.success('Template duplicated')
  }

  const handleDelete = () => {
    if (templates.length <= 1) { toast.error('Cannot delete the last template'); return }
    if (!confirm(`Delete template "${active.name}"?`)) return
    deleteTemplate(active.id)
    const next = getTemplates()
    setTemplates(next)
    setActiveId(next[0].id)
    setDefaultId(getDefaultTemplateId())
    toast.success('Template deleted')
  }

  const handleRenameSubmit = () => {
    if (!newName.trim()) { toast.error('Name is required'); return }
    updateActive({ ...active, name: newName.trim() })
    setRenaming(false)
    toast.success('Renamed')
  }

  const handleCreateNew = () => {
    if (!newName.trim()) { toast.error('Name is required'); return }
    const tmpl = createTemplate(newName.trim())
    setTemplates(getTemplates())
    setActiveId(tmpl.id)
    setAddingNew(false)
    setNewName('')
    toast.success('Template created')
  }

  const handleTestPrint = () => {
    if (!selectedSize) { toast.error('Select a label size first'); return }
    const html = buildPrintHTML(active, [SAMPLE_DEVICE], selectedSize, sizes, templates, 1)
    const popup = window.open('', '_blank', 'width=900,height=600')
    if (popup) popup.document.write(html)
  }

  const F: React.CSSProperties = { padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 13, width: '100%' }

  return (
    <div>
      <PageHeader title="Label Designer" />
      <div style={{ padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '220px 1fr 260px', gap: 16, alignItems: 'start' }}>

        {/* ── Left: Template list ── */}
        <div>
          <Card style={{ padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Templates</div>

            {templates.map(t => (
              <div
                key={t.id}
                onClick={() => selectTemplate(t.id)}
                style={{
                  padding: '7px 10px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
                  background: t.id === activeId ? '#eff6ff' : '#f8fafc',
                  border: `1px solid ${t.id === activeId ? '#3b82f6' : '#e2e8f0'}`,
                  fontSize: 13, fontWeight: t.id === activeId ? 600 : 400,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <span style={{ flex: 1 }}>{t.name}</span>
                {t.id === defaultId && (
                  <span style={{ fontSize: 9, background: '#22c55e', color: '#fff', borderRadius: 3, padding: '1px 5px', fontWeight: 700 }}>DEF</span>
                )}
              </div>
            ))}

            {addingNew ? (
              <div style={{ marginTop: 8 }}>
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateNew(); if (e.key === 'Escape') { setAddingNew(false); setNewName('') } }}
                  style={{ ...F, marginBottom: 6 }} placeholder="Template name" />
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" onClick={handleCreateNew}>Create</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => { setAddingNew(false); setNewName('') }}>Cancel</Btn>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <Btn size="sm" onClick={() => { setAddingNew(true); setNewName('') }}>
                  + New Template
                </Btn>
              </div>
            )}
          </Card>
        </div>

        {/* ── Middle: Fields & actions ── */}
        <div>
          <Card style={{ marginBottom: 16 }}>
            {/* Template header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              {renaming ? (
                <>
                  <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(false) }}
                    style={{ ...F, flex: 1 }} />
                  <Btn size="sm" onClick={handleRenameSubmit}>Save</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => setRenaming(false)}>Cancel</Btn>
                </>
              ) : (
                <>
                  <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>{active?.name}</h3>
                  {active?.id === defaultId && (
                    <span style={{ fontSize: 10, background: '#22c55e22', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 7px', fontWeight: 700 }}>Default</span>
                  )}
                  <Btn size="sm" variant="secondary" onClick={() => { setRenaming(true); setNewName(active?.name ?? '') }}>Rename</Btn>
                  <Btn size="sm" variant="secondary" onClick={handleDuplicate}>Duplicate</Btn>
                  {active?.id !== defaultId && (
                    <Btn size="sm" onClick={handleSetDefault}>Set Default</Btn>
                  )}
                  <Btn size="sm" variant="danger" onClick={handleDelete}>Delete</Btn>
                </>
              )}
            </div>

            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>
              Toggle fields on/off, reorder with ▲▼, click a field to edit its appearance.
            </p>

            {/* Field list */}
            {active?.fields.map((field, idx) => (
              <FieldRow
                key={field.type}
                field={field}
                index={idx}
                total={active.fields.length}
                selected={selectedFieldIdx === idx}
                onToggle={() => toggleField(idx)}
                onMove={dir => moveField(idx, dir)}
                onSelect={() => setSelectedFieldIdx(selectedFieldIdx === idx ? null : idx)}
              />
            ))}
          </Card>

          {/* Selected field settings */}
          {selectedFieldIdx !== null && active?.fields[selectedFieldIdx] && (
            <FieldSettingsPanel
              field={active.fields[selectedFieldIdx]}
              onChange={f => updateField(selectedFieldIdx, f)}
            />
          )}
        </div>

        {/* ── Right: Preview ── */}
        <div>
          <Card style={{ padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Live Preview</div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>Label Size</label>
              {sizes.length === 0 ? (
                <div style={{ fontSize: 12, color: '#ef4444' }}>
                  No sizes configured. <a href="/settings" style={{ color: '#3b82f6' }}>Go to Settings</a> → Label Printing Sizes to add one.
                </div>
              ) : (
                <select style={F} value={selectedSizeId ?? ''} onChange={e => { setSelectedSizeId(e.target.value); saveSelectedLabelSizeId(e.target.value) }}>
                  {sizes.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.widthMm}×{s.heightMm}mm)</option>
                  ))}
                </select>
              )}
            </div>

            {selectedSize && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
                {selectedSize.widthMm} × {selectedSize.heightMm} mm — sample device data
              </div>
            )}

            {/* iframe preview */}
            <div style={{
              border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden',
              background: '#f1f5f9', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {selectedSize ? (
                <iframe
                  ref={iframeRef}
                  style={{ width: '100%', height: 280, border: 'none', display: 'block' }}
                  title="Label preview"
                />
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 13, padding: 20 }}>Add a label size to see preview</div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <Btn onClick={handleTestPrint}>
                Test Print (Sample Data)
              </Btn>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
