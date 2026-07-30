import { useState, useCallback, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import { PageHeader, Card, Btn } from '../components/Layout'
import {
  LabelTemplate, LabelField, FieldType, FIELD_LABELS, isBarcode,
  getTemplates, saveTemplates, getDefaultTemplateId, saveDefaultTemplateId,
  createTemplate, deleteTemplate,
} from '../hooks/useLabelTemplates'
import {
  getLabelSizes, saveLabelSizes, getSelectedLabelSizeId, saveSelectedLabelSizeId, LabelSize,
} from '../hooks/useLabelSizes'
import { buildPreviewHTML, buildPrintHTML, SAMPLE_DEVICE } from '../utils/labelRenderer'

// ─── helpers ─────────────────────────────────────────────────────────────────

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldRow({
  field, index, total, selected, onToggle, onMove, onSelect,
}: {
  field: LabelField; index: number; total: number; selected: boolean
  onToggle: () => void; onMove: (dir: -1 | 1) => void; onSelect: () => void
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        background: selected ? '#eff6ff' : field.enabled ? '#fff' : '#f8fafc',
        border: `1px solid ${selected ? '#3b82f6' : '#e2e8f0'}`,
        borderRadius: 6, marginBottom: 4, cursor: 'pointer',
        opacity: field.enabled ? 1 : 0.5,
      }}
    >
      <input
        type="checkbox" checked={field.enabled}
        onChange={e => { e.stopPropagation(); onToggle() }}
        style={{ accentColor: '#3b82f6', cursor: 'pointer', flexShrink: 0 }}
      />
      <span style={{ flex: 1, fontSize: 13, fontWeight: field.enabled ? 600 : 400, userSelect: 'none' }}>
        {FIELD_LABELS[field.type]}
        {isBarcode(field) && <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>(encodes IMEI)</span>}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {(['▲', '▼'] as const).map((arrow, ai) => (
          <button key={arrow}
            disabled={(ai === 0 && index === 0) || (ai === 1 && index === total - 1)}
            onClick={e => { e.stopPropagation(); onMove(ai === 0 ? -1 : 1) }}
            style={{
              fontSize: 9, padding: '1px 5px', lineHeight: 1.4, cursor: 'pointer',
              border: '1px solid #cbd5e1', borderRadius: 3, background: '#f8fafc',
              color: (ai === 0 && index === 0) || (ai === 1 && index === total - 1) ? '#d1d5db' : '#374151',
            }}
          >{arrow}</button>
        ))}
      </div>
    </div>
  )
}

// ─── Field settings panel ─────────────────────────────────────────────────────

function FieldSettingsPanel({ field, onChange }: { field: LabelField; onChange: (f: LabelField) => void }) {
  const F: React.CSSProperties = { padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 13, width: '100%' }
  const LB: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }
  const G: React.CSSProperties = { marginBottom: 10 }

  return (
    <Card style={{ marginTop: 8, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 10 }}>
        {FIELD_LABELS[field.type]} — appearance
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {!isBarcode(field) && (
          <>
            <div style={G}>
              <label style={LB}>Font Size (pt)</label>
              <input style={F} type="number" min="0" max="72" value={field.fontSize}
                onChange={e => onChange({ ...field, fontSize: parseFloat(e.target.value) || 0 })} />
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>0 = auto</div>
            </div>
            <div style={G}>
              <label style={LB}>Weight</label>
              <select style={F} value={field.bold ? 'bold' : 'normal'}
                onChange={e => onChange({ ...field, bold: e.target.value === 'bold' })}>
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
              </select>
            </div>
          </>
        )}
        <div style={{ ...G, gridColumn: isBarcode(field) ? 'span 2' : undefined }}>
          <label style={LB}>Alignment</label>
          <select style={F} value={field.align}
            onChange={e => onChange({ ...field, align: e.target.value as LabelField['align'] })}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      </div>

      {isBarcode(field) && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>
          Barcode height and width auto-scale to fill available space on the label.
          The barcode encodes the device IMEI using Code 128 for scanner compatibility.
        </div>
      )}
    </Card>
  )
}

// ─── Margin controls ──────────────────────────────────────────────────────────

function MarginControls({
  template, onChange,
}: { template: LabelTemplate; onChange: (t: LabelTemplate) => void }) {
  const F: React.CSSProperties = { padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, width: '100%' }
  const LB: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 2, textAlign: 'center' }

  const field = (key: keyof LabelTemplate, label: string) => (
    <div>
      <label style={LB}>{label}</label>
      <input style={F} type="number" min="0" max="20" step="0.5"
        value={(template[key] as number) ?? 0}
        onChange={e => onChange({ ...template, [key]: parseFloat(e.target.value) || 0 })} />
    </div>
  )

  return (
    <div style={{ marginTop: 12, padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>MARGINS (mm)</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
        {field('marginLeft', 'Left')}
        {field('marginRight', 'Right')}
        {field('marginTop', 'Top')}
        {field('marginBottom', 'Bottom')}
      </div>
    </div>
  )
}

// ─── Preview pane ─────────────────────────────────────────────────────────────

function PreviewPane({
  template, sizes, selectedSizeId, onSizeChange,
}: {
  template: LabelTemplate
  sizes: LabelSize[]
  selectedSizeId: string | null
  onSizeChange: (id: string) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [customW, setCustomW] = useState<string>('')
  const [customH, setCustomH] = useState<string>('')
  const [useCustom, setUseCustom] = useState(false)

  const selectedSize = sizes.find(s => s.id === selectedSizeId) ?? sizes[0] ?? null
  const previewSize: LabelSize | null = useCustom && parseFloat(customW) > 0 && parseFloat(customH) > 0
    ? { id: 'custom', name: 'Custom', widthMm: parseFloat(customW), heightMm: parseFloat(customH) }
    : selectedSize

  useEffect(() => {
    if (!previewSize || !iframeRef.current) return
    iframeRef.current.srcdoc = buildPreviewHTML(template, SAMPLE_DEVICE, previewSize)
  }, [template, previewSize])

  const F: React.CSSProperties = { padding: '4px 7px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, width: '100%' }
  const LB: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 2 }

  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
        Live Preview
      </div>

      {/* Saved sizes */}
      {sizes.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <label style={LB}>Saved Label Size</label>
          <select style={F} value={selectedSizeId ?? ''} disabled={useCustom}
            onChange={e => { onSizeChange(e.target.value); saveSelectedLabelSizeId(e.target.value) }}>
            {sizes.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.widthMm}×{s.heightMm}mm)</option>
            ))}
          </select>
        </div>
      )}

      {/* Custom size toggle */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: '#475569' }}>
          <input type="checkbox" checked={useCustom} onChange={e => setUseCustom(e.target.checked)}
            style={{ accentColor: '#3b82f6' }} />
          Preview with custom size (mm)
        </label>
        {useCustom && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
            <div>
              <label style={LB}>Width</label>
              <input style={F} type="number" min="10" max="300" step="0.5" value={customW}
                onChange={e => setCustomW(e.target.value)} placeholder="50" />
            </div>
            <div>
              <label style={LB}>Height</label>
              <input style={F} type="number" min="10" max="300" step="0.5" value={customH}
                onChange={e => setCustomH(e.target.value)} placeholder="25" />
            </div>
          </div>
        )}
      </div>

      {previewSize && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
          {previewSize.widthMm} × {previewSize.heightMm} mm — showing sample data
        </div>
      )}

      {/* iframe preview */}
      <div style={{
        border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden',
        background: '#e2e8f0', minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {previewSize ? (
          <iframe ref={iframeRef} style={{ width: '100%', height: 260, border: 'none', display: 'block' }} title="Label preview" />
        ) : (
          <div style={{ color: '#94a3b8', fontSize: 12, padding: 20, textAlign: 'center' }}>
            Add a label size in Settings → Label Printing Sizes,<br />or use the custom size option above.
          </div>
        )}
      </div>
    </Card>
  )
}

// ─── Size manager (inline in designer) ───────────────────────────────────────

function SizeManagerPanel({
  sizes, onSizesChange,
}: { sizes: LabelSize[]; onSizesChange: (s: LabelSize[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState(''), [w, setW] = useState(''), [h, setH] = useState('')
  const F: React.CSSProperties = { padding: '4px 7px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12 }

  const handleAdd = () => {
    const wn = parseFloat(w), hn = parseFloat(h)
    if (!name.trim() || !wn || !hn) { toast.error('Name, width and height are required'); return }
    const next = [...sizes, { id: `size-${Date.now()}`, name: name.trim(), widthMm: wn, heightMm: hn }]
    onSizesChange(next)
    setAdding(false); setName(''); setW(''); setH('')
    toast.success('Size added')
  }

  return (
    <Card style={{ marginTop: 14, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>LABEL SIZES</div>
        {!adding && <Btn size="sm" onClick={() => setAdding(true)}>+ Add</Btn>}
      </div>

      {sizes.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '8px 0' }}>
          No sizes yet. Click "+ Add" to create one.
        </div>
      )}

      {sizes.map(s => (
        <div key={s.id} style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
          padding: '4px 0', borderBottom: '1px solid #f1f5f9',
        }}>
          <span style={{ flex: 1 }}>{s.name}</span>
          <span style={{ color: '#94a3b8' }}>{s.widthMm}×{s.heightMm}mm</span>
          <button onClick={() => {
            if (sizes.length <= 1) { toast.error('Cannot delete last size'); return }
            onSizesChange(sizes.filter(x => x.id !== s.id))
          }}
            style={{ fontSize: 10, color: '#ef4444', cursor: 'pointer', background: 'none', border: 'none', padding: '1px 4px' }}>✕</button>
        </div>
      ))}

      {adding && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input style={{ ...F, width: '100%' }} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 50×25mm" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input style={F} type="number" value={w} onChange={e => setW(e.target.value)} placeholder="Width mm" />
            <input style={F} type="number" value={h} onChange={e => setH(e.target.value)} placeholder="Height mm" />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn size="sm" onClick={handleAdd}>Add</Btn>
            <Btn size="sm" variant="secondary" onClick={() => { setAdding(false); setName(''); setW(''); setH('') }}>Cancel</Btn>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Main LabelDesigner ───────────────────────────────────────────────────────

export default function LabelDesigner() {
  const [templates, setTemplates] = useState<LabelTemplate[]>(getTemplates)
  const [activeId, setActiveId] = useState<string>(getDefaultTemplateId)
  const [defaultId, setDefaultId] = useState<string>(getDefaultTemplateId)
  const [sizes, setSizes] = useState<LabelSize[]>(getLabelSizes)
  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(getSelectedLabelSizeId)
  const [selectedFieldIdx, setSelectedFieldIdx] = useState<number | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState('')

  const active = templates.find(t => t.id === activeId) ?? templates[0]

  const persistTemplates = useCallback((next: LabelTemplate[]) => {
    setTemplates(next)
    saveTemplates(next)
  }, [])

  const persistSizes = (next: LabelSize[]) => {
    setSizes(next)
    saveLabelSizes(next)
  }

  const updateActive = useCallback((tmpl: LabelTemplate) => {
    persistTemplates(templates.map(t => t.id === tmpl.id ? tmpl : t))
  }, [templates, persistTemplates])

  const updateField = (idx: number, field: LabelField) => {
    if (!active) return
    updateActive({ ...active, fields: active.fields.map((f, i) => i === idx ? field : f) })
  }

  const toggleField = (idx: number) => {
    const f = active.fields[idx]
    updateField(idx, { ...f, enabled: !f.enabled })
  }

  const moveField = (idx: number, dir: -1 | 1) => {
    updateActive({ ...active, fields: moveItem(active.fields, idx, idx + dir) })
    setSelectedFieldIdx(idx + dir)
  }

  const handleSetDefault = () => {
    saveDefaultTemplateId(active.id)
    setDefaultId(active.id)
    toast.success(`"${active.name}" is now the default template`)
  }

  const handleDuplicate = () => {
    const tmpl = createTemplate(`${active.name} (copy)`, active)
    setTemplates(getTemplates())
    setActiveId(tmpl.id)
    setSelectedFieldIdx(null)
    toast.success('Template duplicated')
  }

  const handleDelete = () => {
    if (templates.length <= 1) { toast.error('Cannot delete the last template'); return }
    if (!confirm(`Delete "${active.name}"?`)) return
    deleteTemplate(active.id)
    const next = getTemplates()
    setTemplates(next)
    setActiveId(next[0].id)
    setDefaultId(getDefaultTemplateId())
    setSelectedFieldIdx(null)
    toast.success('Deleted')
  }

  const handleRename = () => {
    if (!renameName.trim()) { toast.error('Name required'); return }
    updateActive({ ...active, name: renameName.trim() })
    setRenaming(false)
    toast.success('Renamed')
  }

  const handleCreateNew = () => {
    if (!newName.trim()) { toast.error('Name required'); return }
    const tmpl = createTemplate(newName.trim())
    setTemplates(getTemplates())
    setActiveId(tmpl.id)
    setAddingNew(false)
    setNewName('')
    setSelectedFieldIdx(null)
    toast.success('Template created')
  }

  const handleTestPrint = () => {
    const sz = sizes.find(s => s.id === selectedSizeId) ?? sizes[0]
    if (!sz) { toast.error('Add a label size first'); return }
    const html = buildPrintHTML(active, [SAMPLE_DEVICE], sz, sizes, templates, 1)
    const popup = window.open('', '_blank', 'width=900,height=600')
    if (popup) popup.document.write(html)
  }

  const F: React.CSSProperties = { padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 13, width: '100%' }

  return (
    <div>
      <PageHeader title="Label Designer" />
      <div style={{ padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '220px 1fr 300px', gap: 16, alignItems: 'start' }}>

        {/* ── Left: Template list + size manager ── */}
        <div>
          <Card style={{ padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Templates</div>

            {templates.map(t => (
              <div key={t.id} onClick={() => { setActiveId(t.id); setSelectedFieldIdx(null); setRenaming(false) }}
                style={{
                  padding: '7px 10px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
                  background: t.id === activeId ? '#eff6ff' : '#f8fafc',
                  border: `1px solid ${t.id === activeId ? '#3b82f6' : '#e2e8f0'}`,
                  fontSize: 13, fontWeight: t.id === activeId ? 600 : 400,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                {t.id === defaultId && (
                  <span style={{ fontSize: 9, background: '#22c55e', color: '#fff', borderRadius: 3, padding: '1px 5px', fontWeight: 700, flexShrink: 0 }}>DEF</span>
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
                <Btn size="sm" onClick={() => { setAddingNew(true); setNewName('') }}>+ New Template</Btn>
              </div>
            )}
          </Card>

          <SizeManagerPanel sizes={sizes} onSizesChange={persistSizes} />
        </div>

        {/* ── Centre: Fields + settings ── */}
        <div>
          <Card>
            {/* Template header bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {renaming ? (
                <>
                  <input autoFocus value={renameName} onChange={e => setRenameName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false) }}
                    style={{ ...F, flex: 1, minWidth: 120 }} />
                  <Btn size="sm" onClick={handleRename}>Save</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => setRenaming(false)}>Cancel</Btn>
                </>
              ) : (
                <>
                  <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>{active?.name}</h3>
                  {active?.id === defaultId && (
                    <span style={{ fontSize: 10, background: '#dcfce7', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 7px', fontWeight: 700 }}>Default</span>
                  )}
                  <Btn size="sm" variant="secondary" onClick={() => { setRenaming(true); setRenameName(active?.name ?? '') }}>Rename</Btn>
                  <Btn size="sm" variant="secondary" onClick={handleDuplicate}>Duplicate</Btn>
                  {active?.id !== defaultId && <Btn size="sm" onClick={handleSetDefault}>Set Default</Btn>}
                  <Btn size="sm" variant="danger" onClick={handleDelete}>Delete</Btn>
                </>
              )}
            </div>

            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
              Toggle fields on/off, reorder with ▲▼, click a row to adjust appearance.
              Font sizes auto-calculate when set to 0.
            </p>

            {active?.fields.map((field, idx) => (
              <FieldRow key={field.type} field={field} index={idx} total={active.fields.length}
                selected={selectedFieldIdx === idx}
                onToggle={() => toggleField(idx)}
                onMove={dir => moveField(idx, dir)}
                onSelect={() => setSelectedFieldIdx(selectedFieldIdx === idx ? null : idx)} />
            ))}

            {/* Per-field settings */}
            {selectedFieldIdx !== null && active?.fields[selectedFieldIdx] && (
              <FieldSettingsPanel
                field={active.fields[selectedFieldIdx]}
                onChange={f => updateField(selectedFieldIdx, f)} />
            )}

            {/* Margin controls */}
            {active && (
              <MarginControls template={active} onChange={updateActive} />
            )}
          </Card>
        </div>

        {/* ── Right: Preview + test print ── */}
        <div>
          <PreviewPane
            template={active}
            sizes={sizes}
            selectedSizeId={selectedSizeId}
            onSizeChange={setSelectedSizeId} />

          <div style={{ marginTop: 12 }}>
            <Btn onClick={handleTestPrint}>🖨 Test Print (Sample Data)</Btn>
          </div>

          <div style={{ marginTop: 12, padding: 10, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
            <strong>Auto-scaling:</strong> Font sizes, barcode dimensions, and spacing all adapt
            automatically to any label size. Margins keep all content inside the printable area.
          </div>
        </div>
      </div>
    </div>
  )
}
