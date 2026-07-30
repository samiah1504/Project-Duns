/**
 * Visual Label Designer — true-to-size drag-and-drop canvas editor.
 *
 * Canvas invariant:
 *   Designer size = selected label size = print size.
 *   All element positions, widths, heights and margins are stored in mm.
 *   The canvas is a scaled but aspect-ratio-exact replica of the physical label.
 *   Print output uses @page { size: Wmm Hmm; margin: 0 } with absolute mm positioning
 *   so designer pixels map exactly to printed millimetres.
 *
 * View modes:
 *   fit    — canvas scaled to fit the viewport (default)
 *   actual — canvas rendered at CSS mm so it matches physical screen size
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { PageHeader, Card, Btn } from '../components/Layout'
import {
  LabelTemplate, LabelField, FieldType, FIELD_LABELS, isBarcode,
  autoPlaceFields, needsPlacement, getTemplates as getPresetTemplates,
} from '../hooks/useLabelTemplates'
import {
  getLabelSizes, saveLabelSizes, getSelectedLabelSizeId, saveSelectedLabelSizeId, LabelSize,
} from '../hooks/useLabelSizes'
import {
  fetchTemplates, saveNewTemplate, overwriteTemplate, removeTemplate, markDefault,
  APILabelTemplate,
} from '../hooks/useLabelTemplateAPI'
import { buildPrintHTML, buildCalibrationHTML, buildLabelElementsHTML, SAMPLE_DEVICE } from '../utils/labelRenderer'

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_MAX_W = 560    // px, fit-mode cap
const CANVAS_MAX_H = 420    // px, fit-mode cap
const NUDGE_SM     = 0.5    // mm
const NUDGE_LG     = 2.0    // mm
const RULER_H      = 22     // px, horizontal ruler height
const RULER_W      = 28     // px, vertical ruler width
const PX_PER_MM    = 96 / 25.4   // 3.7795… — standard CSS mm at 96 dpi

type Handle   = 'tl'|'tc'|'tr'|'ml'|'mr'|'bl'|'bc'|'br'
type ViewMode = 'fit' | 'actual'

// ─── Scale helpers ────────────────────────────────────────────────────────────

function computeScale(lw: number, lh: number, mode: ViewMode): number {
  if (mode === 'actual') return PX_PER_MM
  return Math.min(CANVAS_MAX_W / lw, CANVAS_MAX_H / lh)
}

function pxOf(mm: number, scale: number) { return mm * scale }
function mmOf(px: number, scale: number) { return px / scale }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

// ─── Resize handle positions ──────────────────────────────────────────────────

const HANDLE_POS: Record<Handle, React.CSSProperties> = {
  tl: { top: -5, left: -5,                  cursor: 'nw-resize' },
  tc: { top: -5, left: 'calc(50% - 4px)',   cursor: 'n-resize'  },
  tr: { top: -5, right: -5,                 cursor: 'ne-resize' },
  ml: { top: 'calc(50% - 4px)', left: -5,   cursor: 'w-resize'  },
  mr: { top: 'calc(50% - 4px)', right: -5,  cursor: 'e-resize'  },
  bl: { bottom: -5, left: -5,               cursor: 'sw-resize' },
  bc: { bottom: -5, left: 'calc(50% - 4px)',cursor: 's-resize'  },
  br: { bottom: -5, right: -5,              cursor: 'se-resize' },
}

// ─── Rulers ───────────────────────────────────────────────────────────────────

function HRuler({ totalMm, scale }: { totalMm: number; scale: number }) {
  const W = Math.ceil(totalMm * scale)
  const ticks: React.ReactNode[] = []
  for (let i = 0; i <= Math.ceil(totalMm); i++) {
    const x = i * scale
    const major = i % 10 === 0
    const mid   = i % 5 === 0
    const th    = major ? 14 : mid ? 9 : 5
    ticks.push(<line key={`l${i}`} x1={x} y1={RULER_H} x2={x} y2={RULER_H - th} stroke="#94a3b8" strokeWidth={major ? 1 : 0.5} />)
    if (major && i > 0)
      ticks.push(<text key={`t${i}`} x={x + 1.5} y={RULER_H - 15} fontSize={9} fontFamily="monospace" fill="#64748b">{i}</text>)
  }
  return (
    <svg width={W} height={RULER_H} style={{ display: 'block', background: '#f8fafc', borderBottom: '1px solid #cbd5e1', flexShrink: 0 }}>
      <text x={2} y={RULER_H - 15} fontSize={8} fontFamily="monospace" fill="#94a3b8">mm</text>
      {ticks}
    </svg>
  )
}

function VRuler({ totalMm, scale }: { totalMm: number; scale: number }) {
  const H = Math.ceil(totalMm * scale)
  const ticks: React.ReactNode[] = []
  for (let i = 0; i <= Math.ceil(totalMm); i++) {
    const y = i * scale
    const major = i % 10 === 0
    const mid   = i % 5 === 0
    const tw    = major ? 14 : mid ? 9 : 5
    ticks.push(<line key={`l${i}`} x1={RULER_W} y1={y} x2={RULER_W - tw} y2={y} stroke="#94a3b8" strokeWidth={major ? 1 : 0.5} />)
    if (major && i > 0)
      ticks.push(<text key={`t${i}`} x={RULER_W - tw - 2} y={y + 1} fontSize={9} fontFamily="monospace" fill="#64748b" textAnchor="end" dominantBaseline="middle">{i}</text>)
  }
  return (
    <svg width={RULER_W} height={H} style={{ display: 'block', background: '#f8fafc', borderRight: '1px solid #cbd5e1', flexShrink: 0 }}>
      {ticks}
    </svg>
  )
}

// ─── Field interaction overlay (no visual content — rendering handled by shared renderer) ──

const CO_SAMPLE = { name: 'TARDMART' }

interface FieldOverlayProps {
  field: LabelField; scale: number; selected: boolean
  onSelect: (e: React.MouseEvent) => void
  onDragStart: (e: React.MouseEvent, type: FieldType) => void
  onResizeStart: (e: React.MouseEvent, type: FieldType, handle: Handle) => void
}

function FieldOverlay({ field, scale, selected, onSelect, onDragStart, onResizeStart }: FieldOverlayProps) {
  const x = field.x ?? 0, y = field.y ?? 0, w = field.w ?? 30, h = field.h ?? 5
  return (
    <div
      onMouseDown={e => { onSelect(e); onDragStart(e, field.type) }}
      style={{
        position: 'absolute',
        left: pxOf(x, scale), top: pxOf(y, scale),
        width: pxOf(w, scale), height: pxOf(h, scale),
        zIndex: (field.zIndex ?? 0) + 10 + (selected ? 1000 : 0),
        cursor: 'move', boxSizing: 'border-box',
        background: 'transparent',
        border: selected ? '1.5px solid #3b82f6' : '1px dashed rgba(0,0,0,0)',
        userSelect: 'none',
      }}
    >
      {selected && (Object.keys(HANDLE_POS) as Handle[]).map(h => (
        <div key={h} onMouseDown={e => { e.stopPropagation(); onResizeStart(e, field.type, h) }}
          style={{
            position: 'absolute', width: 9, height: 9,
            background: '#3b82f6', border: '1.5px solid #fff', borderRadius: 2, zIndex: 10001,
            ...HANDLE_POS[h],
          }} />
      ))}
    </div>
  )
}

// ─── Canvas (drag + resize + keyboard) ───────────────────────────────────────

interface CanvasProps {
  template: LabelTemplate; size: LabelSize; scale: number
  selectedField: FieldType | null
  onSelectField: (t: FieldType | null) => void
  onCommitField: (type: FieldType, patch: Partial<LabelField>) => void
}

function Canvas({ template, size, scale, selectedField, onSelectField, onCommitField }: CanvasProps) {
  const W = size.widthMm, H = size.heightMm
  const { marginLeft: ml, marginRight: mr, marginTop: mt, marginBottom: mb } = template

  const dragRef = useRef<null | {
    type: FieldType; startMx: number; startMy: number
    startFx: number; startFy: number; fw: number; fh: number
    endX: number; endY: number
  }>(null)

  const resizeRef = useRef<null | {
    type: FieldType; handle: Handle
    startMx: number; startMy: number
    startFx: number; startFy: number; startFw: number; startFh: number
    endX: number; endY: number; endW: number; endH: number
  }>(null)

  const [livePos, setLivePos] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({})

  const getField = useCallback((type: FieldType) =>
    template.fields.find(f => f.type === type), [template.fields])

  const onDragStart = useCallback((e: React.MouseEvent, type: FieldType) => {
    e.preventDefault()
    const f = getField(type)
    if (!f) return
    dragRef.current = {
      type, startMx: e.pageX, startMy: e.pageY,
      startFx: f.x ?? 0, startFy: f.y ?? 0,
      fw: f.w ?? 30, fh: f.h ?? 5, endX: f.x ?? 0, endY: f.y ?? 0,
    }
  }, [getField])

  const onResizeStart = useCallback((e: React.MouseEvent, type: FieldType, handle: Handle) => {
    e.preventDefault(); e.stopPropagation()
    const f = getField(type)
    if (!f) return
    resizeRef.current = {
      type, handle, startMx: e.pageX, startMy: e.pageY,
      startFx: f.x ?? 0, startFy: f.y ?? 0,
      startFw: f.w ?? 30, startFh: f.h ?? 5,
      endX: f.x ?? 0, endY: f.y ?? 0, endW: f.w ?? 30, endH: f.h ?? 5,
    }
  }, [getField])

  useEffect(() => {
    const MIN_W = 2, MIN_H = 1.5

    const onMove = (e: MouseEvent) => {
      const dr = dragRef.current
      if (dr) {
        const dxMm = mmOf(e.pageX - dr.startMx, scale)
        const dyMm = mmOf(e.pageY - dr.startMy, scale)
        const nx = clamp(dr.startFx + dxMm, 0, W - dr.fw)
        const ny = clamp(dr.startFy + dyMm, 0, H - dr.fh)
        dr.endX = nx; dr.endY = ny
        setLivePos(p => ({ ...p, [dr.type]: { x: nx, y: ny, w: dr.fw, h: dr.fh } }))
        return
      }
      const rr = resizeRef.current
      if (!rr) return
      const dxMm = mmOf(e.pageX - rr.startMx, scale)
      const dyMm = mmOf(e.pageY - rr.startMy, scale)
      let { startFx: rx, startFy: ry, startFw: rw, startFh: rh } = rr
      const h = rr.handle
      if (h.includes('l')) { const nw = Math.max(MIN_W, rw - dxMm); rx = rx + rw - nw; rw = nw }
      if (h.includes('r')) { rw = Math.max(MIN_W, rw + dxMm) }
      if (h.includes('t')) { const nh = Math.max(MIN_H, rh - dyMm); ry = ry + rh - nh; rh = nh }
      if (h.includes('b')) { rh = Math.max(MIN_H, rh + dyMm) }
      rx = clamp(rx, 0, W - rw); ry = clamp(ry, 0, H - rh)
      rw = clamp(rw, MIN_W, W - rx); rh = clamp(rh, MIN_H, H - ry)
      rr.endX = rx; rr.endY = ry; rr.endW = rw; rr.endH = rh
      setLivePos(p => ({ ...p, [rr.type]: { x: rx, y: ry, w: rw, h: rh } }))
    }

    const onUp = () => {
      const dr = dragRef.current
      if (dr) {
        dragRef.current = null
        onCommitField(dr.type, { x: +dr.endX.toFixed(2), y: +dr.endY.toFixed(2) })
        setLivePos(p => { const n = { ...p }; delete n[dr.type]; return n })
      }
      const rr = resizeRef.current
      if (rr) {
        resizeRef.current = null
        onCommitField(rr.type, { x: +rr.endX.toFixed(2), y: +rr.endY.toFixed(2), w: +rr.endW.toFixed(2), h: +rr.endH.toFixed(2) })
        setLivePos(p => { const n = { ...p }; delete n[rr.type]; return n })
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [scale, W, H, onCommitField])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedField) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const step = e.shiftKey ? NUDGE_LG : NUDGE_SM
      let dx = 0, dy = 0
      if (e.key === 'ArrowLeft')  dx = -step
      if (e.key === 'ArrowRight') dx =  step
      if (e.key === 'ArrowUp')    dy = -step
      if (e.key === 'ArrowDown')  dy =  step
      if (e.key === 'Delete' || e.key === 'Backspace') { onCommitField(selectedField, { enabled: false }); return }
      if (dx === 0 && dy === 0) return
      e.preventDefault()
      const f = getField(selectedField)
      if (!f) return
      onCommitField(selectedField, {
        x: clamp(+(((f.x ?? 0) + dx).toFixed(2)), 0, W - (f.w ?? 10)),
        y: clamp(+(((f.y ?? 0) + dy).toFixed(2)), 0, H - (f.h ?? 5)),
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedField, getField, onCommitField, W, H])

  const cW = pxOf(W, scale), cH = pxOf(H, scale)
  const safW = Math.max(0, W - ml - mr), safH = Math.max(0, H - mt - mb)

  // Scale factor: CSS mm → canvas px
  // The shared renderer outputs mm-absolute HTML; this transform scales it to fit the canvas.
  const mmToPx = scale / PX_PER_MM

  // Build a live snapshot of the template with any in-progress drag/resize applied
  const liveTemplate = Object.keys(livePos).length === 0 ? template : {
    ...template,
    fields: template.fields.map(f => livePos[f.type] ? { ...f, ...livePos[f.type] } : f),
  }

  // Render label body using the exact same shared renderer as the print pipeline
  const labelHTML = buildLabelElementsHTML(liveTemplate, SAMPLE_DEVICE, CO_SAMPLE)

  return (
    <div
      onClick={() => onSelectField(null)}
      style={{
        position: 'relative', width: cW, height: cH, flexShrink: 0,
        background: '#fff',
        boxShadow: '0 0 0 1px #475569, 0 4px 20px rgba(0,0,0,0.22)',
        cursor: 'default', overflow: 'hidden',
      }}
    >
      {/* ── WYSIWYG rendering layer — identical pipeline to print output ── */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0,
          width: `${W}mm`, height: `${H}mm`,
          transformOrigin: '0 0',
          transform: `scale(${mmToPx})`,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
        dangerouslySetInnerHTML={{ __html: labelHTML }}
      />

      {/* Safe-area border — dashed, clearly visible */}
      <div style={{
        position: 'absolute',
        left: pxOf(ml, scale), top: pxOf(mt, scale),
        width: pxOf(safW, scale), height: pxOf(safH, scale),
        border: '1px dashed #93c5fd',
        pointerEvents: 'none', zIndex: 5,
      }} />

      {/* Corner marks at safe-area corners */}
      {[
        { l: pxOf(ml, scale) - 1, t: pxOf(mt, scale) - 1 },
        { r: pxOf(mr, scale) - 1, t: pxOf(mt, scale) - 1 },
        { l: pxOf(ml, scale) - 1, b: pxOf(mb, scale) - 1 },
        { r: pxOf(mr, scale) - 1, b: pxOf(mb, scale) - 1 },
      ].map((s, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: 'l' in s ? s.l : undefined,
          right: 'r' in s ? s.r : undefined,
          top: 't' in s ? s.t : undefined,
          bottom: 'b' in s ? s.b : undefined,
          width: 6, height: 6,
          borderColor: '#3b82f6',
          borderStyle: 'solid',
          borderWidth: i === 0 ? '1.5px 0 0 1.5px' : i === 1 ? '1.5px 1.5px 0 0' : i === 2 ? '0 0 1.5px 1.5px' : '0 1.5px 1.5px 0',
          pointerEvents: 'none', zIndex: 6,
        }} />
      ))}

      {/* Out-of-safe-area warning */}
      {template.fields.filter(f => f.enabled && f.type === selectedField).map(f => {
        const fx = f.x ?? 0, fy = f.y ?? 0, fw = f.w ?? 0, fh = f.h ?? 0
        if (fx >= ml && fy >= mt && (fx + fw) <= (W - mr) && (fy + fh) <= (H - mb)) return null
        return (
          <div key="warn" style={{
            position: 'absolute', top: -26, left: 0, right: 0,
            background: '#fef9c3', color: '#92400e', fontSize: 11,
            textAlign: 'center', padding: '2px 6px', borderRadius: 4,
            border: '1px solid #fde68a', whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>
            ⚠ Element extends outside the printable safe area
          </div>
        )
      })}

      {/* ── Transparent interaction overlays — drag/resize, no visual content ── */}
      {[...liveTemplate.fields]
        .filter(f => f.enabled)
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map(f => (
          <FieldOverlay
            key={f.type}
            field={f}
            scale={scale}
            selected={selectedField === f.type}
            onSelect={e => { e.stopPropagation(); onSelectField(f.type) }}
            onDragStart={onDragStart}
            onResizeStart={onResizeStart}
          />
        ))}
    </div>
  )
}

// ─── Canvas with mm rulers ────────────────────────────────────────────────────

function CanvasWithRulers({ template, size, scale, selectedField, onSelectField, onCommitField }: CanvasProps) {
  const W = size.widthMm, H = size.heightMm
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', userSelect: 'none' }}>
      {/* Top row: corner + horizontal ruler */}
      <div style={{ display: 'flex' }}>
        <div style={{ width: RULER_W, height: RULER_H, background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', borderRight: '1px solid #cbd5e1', flexShrink: 0 }} />
        <HRuler totalMm={W} scale={scale} />
      </div>
      {/* Middle row: vertical ruler + canvas */}
      <div style={{ display: 'flex' }}>
        <VRuler totalMm={H} scale={scale} />
        <Canvas
          template={template} size={size} scale={scale}
          selectedField={selectedField}
          onSelectField={onSelectField}
          onCommitField={onCommitField}
        />
      </div>
    </div>
  )
}

// ─── Properties panel ─────────────────────────────────────────────────────────

function PropertiesPanel({ field, template, labelW, labelH, onUpdate }: {
  field: LabelField; template: LabelTemplate; labelW: number; labelH: number
  onUpdate: (patch: Partial<LabelField>) => void
}) {
  const F: React.CSSProperties = { padding: '4px 7px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, width: '100%', boxSizing: 'border-box' }
  const LB: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 2 }
  const GR = (cols: string): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: cols, gap: 6, marginBottom: 8 })

  const numField = (label: string, key: keyof LabelField, min: number, max: number, step = 0.5, unit = '') => (
    <div>
      <label style={LB}>{label}{unit && <span style={{ fontWeight: 400, color: '#94a3b8' }}> ({unit})</span>}</label>
      <input style={F} type="number" min={min} max={max} step={step}
        value={(field[key] as number | undefined) ?? 0}
        onChange={e => onUpdate({ [key]: parseFloat(e.target.value) || 0 })} />
    </div>
  )

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: '#374151', marginBottom: 10, fontSize: 13 }}>{FIELD_LABELS[field.type]}</div>

      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Position (mm)</div>
      <div style={GR('1fr 1fr')}>
        {numField('X', 'x', 0, labelW, 0.1, 'mm')}
        {numField('Y', 'y', 0, labelH, 0.1, 'mm')}
      </div>
      <div style={GR('1fr 1fr')}>
        {numField('W', 'w', 1, labelW, 0.5, 'mm')}
        {numField('H', 'h', 1, labelH, 0.5, 'mm')}
      </div>

      {!isBarcode(field) && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', margin: '4px 0', textTransform: 'uppercase', letterSpacing: 0.5 }}>Text</div>
          <div style={GR('1fr 1fr')}>
            {numField('Size', 'fontSize', 0, 72, 0.5, 'pt')}
            <div>
              <label style={LB}>Weight</label>
              <select style={F} value={field.bold ? 'bold' : 'normal'}
                onChange={e => onUpdate({ bold: e.target.value === 'bold' })}>
                <option value="normal">Normal</option><option value="bold">Bold</option>
              </select>
            </div>
          </div>
          <div style={GR('1fr 1fr 1fr')}>
            <div>
              <label style={LB}>Style</label>
              <select style={F} value={field.italic ? 'italic' : 'normal'}
                onChange={e => onUpdate({ italic: e.target.value === 'italic' })}>
                <option value="normal">Normal</option><option value="italic">Italic</option>
              </select>
            </div>
            {numField('Line H', 'lineHeight', 0.8, 3, 0.1)}
            {numField('Spacing', 'letterSpacing', 0, 10, 0.5, 'pt')}
          </div>
          <div style={GR('1fr 1fr')}>
            <div>
              <label style={LB}>Align</label>
              <select style={F} value={field.align}
                onChange={e => onUpdate({ align: e.target.value as LabelField['align'] })}>
                <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
              </select>
            </div>
            <div>
              <label style={LB}>Colour</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="color" value={field.color || '#000000'}
                  onChange={e => onUpdate({ color: e.target.value })}
                  style={{ width: 34, height: 28, border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', padding: 2 }} />
                <input style={{ ...F, flex: 1 }} value={field.color || '#000000'}
                  onChange={e => onUpdate({ color: e.target.value })} />
              </div>
            </div>
          </div>
        </>
      )}

      {isBarcode(field) && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', margin: '4px 0', textTransform: 'uppercase', letterSpacing: 0.5 }}>Barcode</div>
          <div style={GR('1fr 1fr')}>
            {numField('Module W', 'barcodeModuleWidth', 1, 4, 0.5)}
            <div>
              <label style={LB}>Align</label>
              <select style={F} value={field.align}
                onChange={e => onUpdate({ align: e.target.value as LabelField['align'] })}>
                <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
              </select>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!field.barcodeShowText}
              onChange={e => onUpdate({ barcodeShowText: e.target.checked })} />
            <span style={{ fontSize: 12 }}>Show IMEI below barcode</span>
          </label>
        </>
      )}
    </div>
  )
}

// ─── Alignment toolbar ────────────────────────────────────────────────────────

function AlignmentToolbar({ field, template, labelW, labelH, onUpdate }: {
  field: LabelField | null; template: LabelTemplate; labelW: number; labelH: number
  onUpdate: (patch: Partial<LabelField>) => void
}) {
  if (!field) return null
  const { marginLeft: ml, marginRight: mr, marginTop: mt, marginBottom: mb } = template
  const sw = labelW - ml - mr, sh = labelH - mt - mb
  const fw = field.w ?? 30, fh = field.h ?? 5

  const btn = (label: string, patch: Partial<LabelField>) => (
    <button key={label} onClick={() => onUpdate(patch)} title={label}
      style={{ padding: '4px 8px', fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {label}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', width: '100%', marginBottom: 2 }}>ALIGN TO SAFE AREA</div>
      {btn('⇐ Left',   { x: +ml.toFixed(2) })}
      {btn('— Centre', { x: +(ml + (sw - fw) / 2).toFixed(2) })}
      {btn('⇒ Right',  { x: +(labelW - mr - fw).toFixed(2) })}
      {btn('⇑ Top',    { y: +mt.toFixed(2) })}
      {btn('| Middle', { y: +(mt + (sh - fh) / 2).toFixed(2) })}
      {btn('⇓ Bottom', { y: +(labelH - mb - fh).toFixed(2) })}
      {btn('Fill W',   { x: +ml.toFixed(2), w: +sw.toFixed(2) })}
    </div>
  )
}

// ─── Layer toolbar ────────────────────────────────────────────────────────────

function LayerToolbar({ field, template, onUpdateTemplate }: {
  field: LabelField | null; template: LabelTemplate
  onUpdateTemplate: (t: LabelTemplate) => void
}) {
  if (!field) return null

  const sorted = [...template.fields].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
  const idx = sorted.findIndex(f => f.type === field.type)
  const total = sorted.filter(f => f.enabled).length

  const reorder = (fn: (arr: LabelField[]) => LabelField[]) => {
    const next = fn(sorted).map((f, i) => ({ ...f, zIndex: i }))
    onUpdateTemplate({ ...template, fields: next })
  }
  const swap = (arr: LabelField[], i: number, j: number) => { const n = [...arr]; [n[i], n[j]] = [n[j], n[i]]; return n }

  const btn = (label: string, off: boolean, fn: () => void) => (
    <button key={label} onClick={fn} disabled={off}
      style={{ padding: '4px 8px', fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 4,
        cursor: off ? 'default' : 'pointer', background: off ? '#f1f5f9' : '#f8fafc', color: off ? '#cbd5e1' : '#374151' }}>
      {label}
    </button>
  )

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>LAYER ORDER</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {btn('⊤ Front', idx >= total - 1, () => reorder(a => { const n = a.filter(f => f.type !== field.type); n.push(a[idx]); return n }))}
        {btn('↑ Fwd',   idx >= total - 1, () => reorder(a => swap(a, idx, idx + 1)))}
        {btn('↓ Bwd',   idx <= 0,         () => reorder(a => swap(a, idx, idx - 1)))}
        {btn('⊥ Back',  idx <= 0,         () => reorder(a => { const n = a.filter(f => f.type !== field.type); n.unshift(a[idx]); return n }))}
      </div>
    </div>
  )
}

// ─── Margin controls ──────────────────────────────────────────────────────────

function MarginControls({ template, onUpdate }: { template: LabelTemplate; onUpdate: (t: LabelTemplate) => void }) {
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Safe-Area Margins (mm)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
        {(['marginTop', 'marginBottom', 'marginLeft', 'marginRight'] as const).map(k => (
          <div key={k}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', marginBottom: 2, textAlign: 'center' }}>
              {k.replace('margin', '')}
            </div>
            <input type="number" min="0" max="20" step="0.5" value={template[k]}
              onChange={e => onUpdate({ ...template, [k]: parseFloat(e.target.value) || 0 })}
              style={{ width: '100%', padding: '3px 5px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Field list ───────────────────────────────────────────────────────────────

function FieldList({ template, selectedField, onToggle, onSelectField }: {
  template: LabelTemplate; selectedField: FieldType | null
  onToggle: (t: FieldType) => void; onSelectField: (t: FieldType) => void
}) {
  return (
    <Card style={{ padding: 10, minWidth: 175 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Fields</div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 8 }}>✓ show · click to edit</div>
      {template.fields.map(f => (
        <div key={f.type} onClick={() => { if (f.enabled) onSelectField(f.type) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
            borderRadius: 5, marginBottom: 2, cursor: f.enabled ? 'pointer' : 'default',
            background: selectedField === f.type ? '#eff6ff' : f.enabled ? '#fff' : '#f8fafc',
            border: `1px solid ${selectedField === f.type ? '#3b82f6' : '#e8ecf0'}`,
            opacity: f.enabled ? 1 : 0.5,
          }}>
          <input type="checkbox" checked={f.enabled}
            onChange={e => { e.stopPropagation(); onToggle(f.type) }}
            style={{ accentColor: '#3b82f6', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: f.enabled ? 600 : 400, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {FIELD_LABELS[f.type]}
          </span>
        </div>
      ))}
    </Card>
  )
}

// ─── Template sidebar ─────────────────────────────────────────────────────────

function TemplateSidebar({ templates, activeId, sizes, isDirty, onSelect, onSetDefault, onSaveAs, onDelete, onSizesChange }: {
  templates: APILabelTemplate[]; activeId: string; sizes: LabelSize[]; isDirty: boolean
  onSelect: (id: string) => void; onSetDefault: () => void; onSaveAs: () => void
  onDelete: () => void; onSizesChange: (s: LabelSize[]) => void
}) {
  const [addingSize, setAddingSize] = useState(false)
  const [sN, setSN] = useState(''), [sW, setSW] = useState(''), [sH, setSH] = useState('')
  const F: React.CSSProperties = { padding: '4px 7px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, width: '100%' }

  const submitSize = () => {
    const w = parseFloat(sW), h = parseFloat(sH)
    if (!sN.trim() || !w || !h) { toast.error('Fill in name, width and height'); return }
    onSizesChange([...sizes, { id: `sz-${Date.now()}`, name: sN.trim(), widthMm: w, heightMm: h }])
    setAddingSize(false); setSN(''); setSW(''); setSH('')
    toast.success('Size added')
  }

  return (
    <div style={{ width: 205, flexShrink: 0 }}>
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Templates</div>
        {templates.map(t => (
          <div key={t.id} onClick={() => onSelect(t.id)}
            style={{
              padding: '6px 9px', borderRadius: 6, marginBottom: 3, cursor: 'pointer',
              background: t.id === activeId ? '#eff6ff' : '#f8fafc',
              border: `1px solid ${t.id === activeId ? '#3b82f6' : '#e2e8f0'}`,
              fontSize: 12, fontWeight: t.id === activeId ? 600 : 400,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            {t.is_default && <span style={{ fontSize: 9, background: '#22c55e', color: '#fff', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>DEF</span>}
            {t.id === activeId && isDirty && <span style={{ fontSize: 9, background: '#f59e0b', color: '#fff', borderRadius: 3, padding: '1px 4px', fontWeight: 700 }}>●</span>}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
          <Btn size="sm" onClick={onSaveAs}>+ Save As</Btn>
          <Btn size="sm" onClick={onSetDefault}>Default</Btn>
          <Btn size="sm" variant="danger" onClick={onDelete}>Del</Btn>
        </div>
      </Card>

      <Card style={{ padding: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Label Sizes</div>
        {sizes.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ flex: 1 }}>{s.name}</span>
            <span style={{ color: '#94a3b8', fontSize: 10 }}>{s.widthMm}×{s.heightMm}</span>
            <button onClick={() => {
              if (sizes.length <= 1) { toast.error('Cannot delete the last size'); return }
              onSizesChange(sizes.filter(x => x.id !== s.id))
            }} style={{ fontSize: 10, color: '#ef4444', cursor: 'pointer', background: 'none', border: 'none' }}>✕</button>
          </div>
        ))}
        {addingSize ? (
          <div style={{ marginTop: 6 }}>
            <input style={{ ...F, marginBottom: 4 }} value={sN} onChange={e => setSN(e.target.value)} placeholder="Name e.g. 50×15mm" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 4 }}>
              <input style={F} type="number" value={sW} onChange={e => setSW(e.target.value)} placeholder="W mm" />
              <input style={F} type="number" value={sH} onChange={e => setSH(e.target.value)} placeholder="H mm" />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <Btn size="sm" onClick={submitSize}>Add</Btn>
              <Btn size="sm" variant="secondary" onClick={() => setAddingSize(false)}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 6 }}><Btn size="sm" onClick={() => setAddingSize(true)}>+ Add Size</Btn></div>
        )}
      </Card>
    </div>
  )
}

// ─── Main LabelDesigner ───────────────────────────────────────────────────────

export default function LabelDesigner() {
  const [apiTemplates, setApiTemplates]       = useState<APILabelTemplate[]>([])
  const [loading, setLoading]                 = useState(true)
  const [workingTemplate, setWorkingTemplate] = useState<LabelTemplate | null>(null)
  const [activeApiId, setActiveApiId]         = useState<string | null>(null)
  const [isDirty, setIsDirty]                 = useState(false)
  const [saving, setSaving]                   = useState(false)
  const [sizes, setSizes]                     = useState<LabelSize[]>(getLabelSizes)
  const [selectedSizeId, setSelectedSizeId]   = useState<string | null>(getSelectedLabelSizeId)
  const [selectedField, setSelectedField]     = useState<FieldType | null>(null)
  const [viewMode, setViewMode]               = useState<ViewMode>('fit')
  const [renaming, setRenaming]               = useState(false)
  const [renameName, setRenameName]           = useState('')

  const selectedSize = sizes.find(s => s.id === selectedSizeId) ?? sizes[0] ?? null
  const scale = selectedSize ? computeScale(selectedSize.widthMm, selectedSize.heightMm, viewMode) : 1

  // ── Load on mount ─────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        let list = await fetchTemplates()
        if (list.length === 0) {
          const presets = getPresetTemplates()
          for (let i = 0; i < presets.length; i++) {
            const created = await saveNewTemplate(presets[i].name, presets[i])
            if (i === 0) { await markDefault(created.id); list.push({ ...created, is_default: true }) }
            else list.push(created)
          }
          list = await fetchTemplates()
        }
        if (cancelled) return
        setApiTemplates(list)
        const def = list.find(t => t.is_default) ?? list[0]
        if (def) {
          setActiveApiId(def.id)
          activateTemplate(def, list, sizes, selectedSizeId)
        }
      } catch {
        toast.error('Failed to load templates')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Restore the paper size saved in the template
  function activateTemplate(
    apiTmpl: APILabelTemplate,
    list: APILabelTemplate[],
    currentSizes: LabelSize[],
    currentSizeId: string | null,
  ) {
    let tmpl: LabelTemplate = { ...apiTmpl.data, id: apiTmpl.id, name: apiTmpl.name }

    // Restore the saved paper size if available
    let restoredSizeId = currentSizeId
    if (tmpl.paperWidthMm && tmpl.paperHeightMm) {
      const match = currentSizes.find(s =>
        Math.abs(s.widthMm - tmpl.paperWidthMm!) < 0.1 &&
        Math.abs(s.heightMm - tmpl.paperHeightMm!) < 0.1
      )
      if (match && match.id !== currentSizeId) {
        restoredSizeId = match.id
        setSelectedSizeId(match.id)
        saveSelectedLabelSizeId(match.id)
      }
    }

    const size = currentSizes.find(s => s.id === restoredSizeId) ?? currentSizes[0] ?? null
    if (size && needsPlacement(tmpl)) {
      tmpl = autoPlaceFields(tmpl, size.widthMm, size.heightMm)
    }
    setWorkingTemplate(tmpl)
    setIsDirty(false)
    setSelectedField(null)
    void list
  }

  // Auto-place when size changes
  useEffect(() => {
    if (!workingTemplate || !selectedSize) return
    if (needsPlacement(workingTemplate)) {
      setWorkingTemplate(t => t ? autoPlaceFields(t, selectedSize.widthMm, selectedSize.heightMm) : t)
    }
  }, [selectedSizeId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Warn on browser unload
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (isDirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [isDirty])

  // ── Size change — ask before reposition ───────────────────────────────────

  const handleSizeChange = (newId: string) => {
    if (newId === selectedSizeId) return
    const newSize = sizes.find(s => s.id === newId)
    if (!newSize || !workingTemplate || !selectedSize) {
      setSelectedSizeId(newId); saveSelectedLabelSizeId(newId); return
    }

    const hasPos = workingTemplate.fields.some(f => f.enabled && f.x !== undefined)
    if (!hasPos) {
      // Nothing placed yet — just switch
      setSelectedSizeId(newId); saveSelectedLabelSizeId(newId)
      setWorkingTemplate(t => t ? { ...t, paperWidthMm: newSize.widthMm, paperHeightMm: newSize.heightMm } : t)
      setIsDirty(true); return
    }

    const oldW = selectedSize.widthMm, oldH = selectedSize.heightMm
    const newW = newSize.widthMm,      newH = newSize.heightMm

    const doScale = window.confirm(
      `Template has element positions for ${oldW}×${oldH} mm.\n` +
      `Switching to ${newW}×${newH} mm.\n\n` +
      `OK  = Scale positions proportionally\n` +
      `Cancel = Reset to fresh auto-layout`
    )

    let updatedTemplate: LabelTemplate
    if (doScale) {
      const sx = newW / oldW, sy = newH / oldH
      updatedTemplate = {
        ...workingTemplate,
        paperWidthMm: newW, paperHeightMm: newH,
        marginLeft: +(workingTemplate.marginLeft * sx).toFixed(2),
        marginRight: +(workingTemplate.marginRight * sx).toFixed(2),
        marginTop: +(workingTemplate.marginTop * sy).toFixed(2),
        marginBottom: +(workingTemplate.marginBottom * sy).toFixed(2),
        fields: workingTemplate.fields.map(f => f.x === undefined ? f : {
          ...f,
          x: +(((f.x ?? 0) * sx).toFixed(2)),
          y: +(((f.y ?? 0) * sy).toFixed(2)),
          w: +(((f.w ?? 10) * sx).toFixed(2)),
          h: +(((f.h ?? 5) * sy).toFixed(2)),
        }),
      }
    } else {
      const bare = {
        ...workingTemplate,
        paperWidthMm: newW, paperHeightMm: newH,
        fields: workingTemplate.fields.map(f => ({ ...f, x: undefined, y: undefined, w: undefined, h: undefined, zIndex: undefined })),
      }
      updatedTemplate = autoPlaceFields(bare, newW, newH)
    }

    setWorkingTemplate(updatedTemplate)
    setSelectedSizeId(newId); saveSelectedLabelSizeId(newId)
    setIsDirty(true)
  }

  // ── Template switching ────────────────────────────────────────────────────

  const switchTemplate = (id: string) => {
    if (id === activeApiId) return
    if (isDirty && !window.confirm('You have unsaved changes. Discard and switch templates?')) return
    const found = apiTemplates.find(t => t.id === id)
    if (!found) return
    setActiveApiId(id)
    activateTemplate(found, apiTemplates, sizes, selectedSizeId)
  }

  // ── Edit working copy ─────────────────────────────────────────────────────

  const updateActive = useCallback((tmpl: LabelTemplate) => {
    setWorkingTemplate(tmpl); setIsDirty(true)
  }, [])

  const updateField = useCallback((type: FieldType, patch: Partial<LabelField>) => {
    setWorkingTemplate(prev => {
      if (!prev) return prev
      return { ...prev, fields: prev.fields.map(f => f.type === type ? { ...f, ...patch } : f) }
    })
    setIsDirty(true)
  }, [])

  // ── Save (overwrite) ──────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!workingTemplate || !activeApiId) { toast('Use "Save As" to create a new template'); return }
    // Include current paper size in the saved data
    const toSave: LabelTemplate = {
      ...workingTemplate,
      paperWidthMm: selectedSize?.widthMm,
      paperHeightMm: selectedSize?.heightMm,
    }
    setSaving(true)
    try {
      const updated = await overwriteTemplate(activeApiId, toSave.name, toSave)
      setApiTemplates(prev => prev.map(t => t.id === activeApiId ? updated : t))
      setWorkingTemplate(toSave)
      setIsDirty(false)
      toast.success('Template saved')
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Save As ───────────────────────────────────────────────────────────────

  const handleSaveAs = async () => {
    const name = window.prompt('Template name:', workingTemplate?.name ?? 'My Template')
    if (!name?.trim() || !workingTemplate) return
    const toSave: LabelTemplate = {
      ...workingTemplate, name: name.trim(),
      paperWidthMm: selectedSize?.widthMm,
      paperHeightMm: selectedSize?.heightMm,
    }
    setSaving(true)
    try {
      const created = await saveNewTemplate(name.trim(), toSave)
      setApiTemplates(prev => [...prev, created])
      setActiveApiId(created.id)
      setWorkingTemplate({ ...toSave, id: created.id })
      setIsDirty(false)
      toast.success(`"${created.name}" saved`)
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Set default ───────────────────────────────────────────────────────────

  const handleSetDefault = async () => {
    if (!activeApiId) return
    try {
      await markDefault(activeApiId)
      setApiTemplates(prev => prev.map(t => ({ ...t, is_default: t.id === activeApiId })))
      toast.success('Default template updated')
    } catch { toast.error('Failed') }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!activeApiId || apiTemplates.length <= 1) { toast.error('Cannot delete the last template'); return }
    const name = apiTemplates.find(t => t.id === activeApiId)?.name ?? 'this template'
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      await removeTemplate(activeApiId)
      const next = apiTemplates.filter(t => t.id !== activeApiId)
      setApiTemplates(next)
      const fallback = next.find(t => t.is_default) ?? next[0]
      if (fallback) { setActiveApiId(fallback.id); activateTemplate(fallback, next, sizes, selectedSizeId) }
      toast.success('Deleted')
    } catch { toast.error('Delete failed') }
  }

  // ── Misc actions ──────────────────────────────────────────────────────────

  const handleToggleField = (type: FieldType) => {
    if (!workingTemplate) return
    const f = workingTemplate.fields.find(x => x.type === type)
    if (!f) return
    if (f.enabled && selectedField === type) setSelectedField(null)
    updateField(type, { enabled: !f.enabled })
  }

  const handleRenameSubmit = () => {
    if (!renameName.trim() || !workingTemplate) { toast.error('Name required'); return }
    setWorkingTemplate({ ...workingTemplate, name: renameName.trim() })
    setIsDirty(true); setRenaming(false)
  }

  const handleTestPrint = () => {
    if (!selectedSize || !workingTemplate) { toast.error('Select a label size first'); return }
    const html = buildPrintHTML(workingTemplate, [SAMPLE_DEVICE], selectedSize, sizes, apiTemplates.map(t => t.data), 1)
    const w = window.open('', '_blank', 'width=900,height=600')
    if (w) w.document.write(html)
  }

  const handleCalibration = () => {
    if (!selectedSize) { toast.error('Select a label size first'); return }
    const html = buildCalibrationHTML(selectedSize.widthMm, selectedSize.heightMm)
    const w = window.open('', '_blank', 'width=700,height=500')
    if (w) w.document.write(html)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div><PageHeader title="Label Designer" />
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading templates…</div>
      </div>
    )
  }

  if (!workingTemplate) {
    return (
      <div><PageHeader title="Label Designer" />
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
          No templates. <Btn onClick={handleSaveAs}>Create First Template</Btn>
        </div>
      </div>
    )
  }

  const selectedFieldObj = workingTemplate.fields.find(f => f.type === selectedField) ?? null
  const activeApiTmpl    = apiTemplates.find(t => t.id === activeApiId)

  return (
    <div>
      <PageHeader title="Label Designer" />

      {/* Top bar */}
      <div style={{ padding: '0 24px 10px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {renaming ? (
          <>
            <input autoFocus value={renameName} onChange={e => setRenameName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(false) }}
              style={{ padding: '5px 9px', border: '1px solid #3b82f6', borderRadius: 6, fontSize: 14, width: 220 }} />
            <Btn size="sm" onClick={handleRenameSubmit}>OK</Btn>
            <Btn size="sm" variant="secondary" onClick={() => setRenaming(false)}>Cancel</Btn>
          </>
        ) : (
          <>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{workingTemplate.name}</span>
            {activeApiTmpl?.is_default && (
              <span style={{ fontSize: 10, background: '#dcfce7', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 7px', fontWeight: 700 }}>Default</span>
            )}
            {isDirty && <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>● Unsaved</span>}
            <Btn size="sm" variant="secondary" onClick={() => { setRenaming(true); setRenameName(workingTemplate.name) }}>Rename</Btn>
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* Paper size selector */}
        {sizes.length > 0 && (
          <select value={selectedSizeId ?? ''} onChange={e => handleSizeChange(e.target.value)}
            style={{ padding: '5px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
            {sizes.map(s => <option key={s.id} value={s.id}>{s.name} ({s.widthMm}×{s.heightMm}mm)</option>)}
          </select>
        )}
        {selectedSize && (
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
            {selectedSize.widthMm} × {selectedSize.heightMm} mm
          </span>
        )}

        {/* View mode toggle */}
        <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
          {(['fit', 'actual'] as ViewMode[]).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              style={{
                padding: '5px 10px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: viewMode === m ? '#3b82f6' : '#f8fafc',
                color: viewMode === m ? '#fff' : '#374151',
              }}>
              {m === 'fit' ? 'Fit' : '1:1 Actual'}
            </button>
          ))}
        </div>

        <button onClick={handleCalibration}
          style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontSize: 12 }}
          title="Print calibration rectangle to verify physical size">📐 Calibrate</button>
        <Btn variant="secondary" onClick={handleTestPrint}>🖨 Test Print</Btn>

        {/* Save button */}
        <div>
          <button onClick={handleSave} disabled={saving || !isDirty || !activeApiId}
            style={{ padding: '4px 12px', borderRadius: 5, border: 'none', cursor: saving || !isDirty || !activeApiId ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, background: isDirty ? '#16a34a' : '#e2e8f0', color: isDirty ? '#fff' : '#64748b' }}>
            {saving ? 'Saving…' : isDirty ? '💾 Save Template' : '✓ Saved'}
          </button>
        </div>
      </div>

      {/* Size info bar */}
      {selectedSize && (
        <div style={{ padding: '0 24px 8px', display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            Paper: <strong>{selectedSize.widthMm} × {selectedSize.heightMm} mm</strong>
          </span>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            Safe area: <strong>
              {(selectedSize.widthMm - workingTemplate.marginLeft - workingTemplate.marginRight).toFixed(1)} ×{' '}
              {(selectedSize.heightMm - workingTemplate.marginTop - workingTemplate.marginBottom).toFixed(1)} mm
            </strong>
          </span>
          <span style={{ fontSize: 11, color: viewMode === 'actual' ? '#3b82f6' : '#94a3b8' }}>
            {viewMode === 'actual'
              ? `1:1 actual size (${PX_PER_MM.toFixed(2)} px/mm @ 96 dpi)`
              : `Fit scale: ${computeScale(selectedSize.widthMm, selectedSize.heightMm, 'fit').toFixed(2)} px/mm`}
          </span>
        </div>
      )}

      <div style={{ padding: '0 24px 24px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>

        {/* Left sidebar */}
        <TemplateSidebar
          templates={apiTemplates} activeId={activeApiId ?? ''} sizes={sizes} isDirty={isDirty}
          onSelect={switchTemplate} onSetDefault={handleSetDefault} onSaveAs={handleSaveAs}
          onDelete={handleDelete} onSizesChange={next => { setSizes(next); saveLabelSizes(next) }} />

        {/* Field list */}
        <FieldList
          template={workingTemplate} selectedField={selectedField}
          onToggle={handleToggleField} onSelectField={t => setSelectedField(t)} />

        {/* Canvas area — scrollable for actual-size mode */}
        <div style={{
          flex: 1, overflow: viewMode === 'actual' ? 'auto' : 'visible',
          background: '#cbd5e1', padding: 16, borderRadius: 8,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          minHeight: 200,
        }}>
          {selectedSize ? (
            <>
              <CanvasWithRulers
                template={workingTemplate}
                size={selectedSize}
                scale={scale}
                selectedField={selectedField}
                onSelectField={setSelectedField}
                onCommitField={updateField}
              />
              <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center', lineHeight: 1.6 }}>
                <span style={{ color: '#3b82f6' }}>— — —</span> safe area &nbsp;|&nbsp;
                ↑↓←→ nudge 0.5mm &nbsp;|&nbsp; Shift+arrow 2mm &nbsp;|&nbsp; Del = hide
              </div>
            </>
          ) : (
            <div style={{ padding: 40, color: '#94a3b8', textAlign: 'center' }}>
              Add a label size in the "Label Sizes" panel to start designing.
            </div>
          )}
        </div>

        {/* Right: properties */}
        <div style={{ width: 230, flexShrink: 0 }}>
          {selectedFieldObj && selectedSize ? (
            <Card style={{ padding: 12 }}>
              <PropertiesPanel
                field={selectedFieldObj} template={workingTemplate}
                labelW={selectedSize.widthMm} labelH={selectedSize.heightMm}
                onUpdate={patch => updateField(selectedField!, patch)} />
              <AlignmentToolbar
                field={selectedFieldObj} template={workingTemplate}
                labelW={selectedSize.widthMm} labelH={selectedSize.heightMm}
                onUpdate={patch => updateField(selectedField!, patch)} />
              <LayerToolbar
                field={selectedFieldObj} template={workingTemplate} onUpdateTemplate={updateActive} />
              <MarginControls template={workingTemplate} onUpdate={updateActive} />
            </Card>
          ) : (
            <Card style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                <strong style={{ color: '#475569' }}>Click an element</strong> to select and edit it.<br />
                <strong style={{ color: '#475569' }}>Drag</strong> to move.<br />
                <strong style={{ color: '#475569' }}>Drag handles</strong> to resize.<br />
                <strong style={{ color: '#475569' }}>📐 Calibrate</strong> to verify physical print size.
              </div>
              <MarginControls template={workingTemplate} onUpdate={updateActive} />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
