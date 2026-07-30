/**
 * Visual Label Designer — drag-and-drop canvas editor.
 *
 * Canvas model:
 *   - Label dimensions come from the selected LabelSize (mm).
 *   - Scale = CANVAS_MAX_W / labelW  (capped so height ≤ CANVAS_MAX_H).
 *   - Element positions are stored in mm; pixels = mm × scale.
 *   - During drag/resize: DOM style is updated directly (no React re-render).
 *   - On mouseup: final position committed to React state → localStorage.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { PageHeader, Card, Btn } from '../components/Layout'
import {
  LabelTemplate, LabelField, FieldType, FIELD_LABELS, isBarcode,
  getTemplates, saveTemplates, getDefaultTemplateId, saveDefaultTemplateId,
  createTemplate, deleteTemplate, autoPlaceFields, needsPlacement,
} from '../hooks/useLabelTemplates'
import {
  getLabelSizes, saveLabelSizes, getSelectedLabelSizeId, saveSelectedLabelSizeId, LabelSize,
} from '../hooks/useLabelSizes'
import { buildPrintHTML, fieldValue, SAMPLE_DEVICE } from '../utils/labelRenderer'
import { barcodeSVG } from '../utils/barcode'

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_MAX_W = 580   // px
const CANVAS_MAX_H = 460   // px
const NUDGE_SM = 0.5       // mm
const NUDGE_LG = 2         // mm

type Handle = 'tl'|'tc'|'tr'|'ml'|'mr'|'bl'|'bc'|'br'

// ─── Scale helpers ────────────────────────────────────────────────────────────

function computeScale(lw: number, lh: number): number {
  return Math.min(CANVAS_MAX_W / lw, CANVAS_MAX_H / lh)
}

function px(mm: number, scale: number) { return mm * scale }
function mm(pixels: number, scale: number) { return pixels / scale }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

// ─── Handle positions ─────────────────────────────────────────────────────────

const HANDLE_POSITIONS: Record<Handle, React.CSSProperties> = {
  tl: { top: -5, left: -5,                  cursor: 'nw-resize' },
  tc: { top: -5, left: 'calc(50% - 4px)',   cursor: 'n-resize'  },
  tr: { top: -5, right: -5,                 cursor: 'ne-resize' },
  ml: { top: 'calc(50% - 4px)', left: -5,   cursor: 'w-resize'  },
  mr: { top: 'calc(50% - 4px)', right: -5,  cursor: 'e-resize'  },
  bl: { bottom: -5, left: -5,               cursor: 'sw-resize' },
  bc: { bottom: -5, left: 'calc(50% - 4px)',cursor: 's-resize'  },
  br: { bottom: -5, right: -5,              cursor: 'se-resize' },
}

// ─── Sample display values ────────────────────────────────────────────────────

const CO_SAMPLE = { name: 'TARDMART' }

function getDisplayVal(type: FieldType): string {
  return fieldValue(type, SAMPLE_DEVICE, CO_SAMPLE) || FIELD_LABELS[type]
}

// ─── Canvas element ───────────────────────────────────────────────────────────

interface CanvasElemProps {
  field: LabelField
  scale: number
  selected: boolean
  onSelect: (e: React.MouseEvent) => void
  onDragStart: (e: React.MouseEvent, type: FieldType) => void
  onResizeStart: (e: React.MouseEvent, type: FieldType, handle: Handle) => void
}

function CanvasElem({ field, scale, selected, onSelect, onDragStart, onResizeStart }: CanvasElemProps) {
  const x = field.x ?? 0, y = field.y ?? 0, w = field.w ?? 30, h = field.h ?? 5
  const zi = field.zIndex ?? 0

  const content = () => {
    if (isBarcode(field)) {
      const bw = w * 0.92, bh = h * 0.88
      const svg = barcodeSVG('352800112345678', { height: bh * scale * 0.88, scale: Math.max(1, Math.round(field.barcodeModuleWidth ?? 2)) })
      const styledSvg = svg.replace('<svg ', `<svg style="width:${bw * scale}px;height:${bh * scale}px;display:block;" `)
      return (
        <div style={{ display: 'flex', alignItems: 'center', height: '100%',
          justifyContent: field.align === 'left' ? 'flex-start' : field.align === 'right' ? 'flex-end' : 'center' }}
          dangerouslySetInnerHTML={{ __html: styledSvg }} />
      )
    }
    const fsPt = field.fontSize > 0 ? field.fontSize : Math.max(5, h * 0.60 * 2.835)
    const fsPx = fsPt * (96 / 72)  // pt → px at 96dpi
    return (
      <div style={{
        display: 'flex', alignItems: 'center', height: '100%',
        justifyContent: field.align === 'left' ? 'flex-start' : field.align === 'right' ? 'flex-end' : 'center',
        padding: '0 2px', overflow: 'hidden',
      }}>
        <span style={{
          fontSize: fsPx, fontWeight: field.bold ? 700 : 400,
          fontStyle: field.italic ? 'italic' : 'normal',
          color: field.color || '#000',
          lineHeight: field.lineHeight || 1.1,
          letterSpacing: field.letterSpacing || 0,
          textAlign: field.align, wordBreak: 'break-word', maxWidth: '100%',
        }}>
          {getDisplayVal(field.type)}
        </span>
      </div>
    )
  }

  return (
    <div
      onMouseDown={e => { onSelect(e); onDragStart(e, field.type) }}
      style={{
        position: 'absolute',
        left: px(x, scale), top: px(y, scale),
        width: px(w, scale), height: px(h, scale),
        zIndex: zi + (selected ? 1000 : 0),
        cursor: 'move',
        boxSizing: 'border-box',
        border: selected ? '1.5px solid #3b82f6' : '1px dashed transparent',
        outline: selected ? 'none' : undefined,
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {content()}

      {/* Resize handles */}
      {selected && (Object.keys(HANDLE_POSITIONS) as Handle[]).map(h => (
        <div
          key={h}
          onMouseDown={e => { e.stopPropagation(); onResizeStart(e, field.type, h) }}
          style={{
            position: 'absolute',
            width: 9, height: 9,
            background: '#3b82f6',
            border: '1.5px solid #fff',
            borderRadius: 2,
            zIndex: 10001,
            ...HANDLE_POSITIONS[h],
          }}
        />
      ))}
    </div>
  )
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

interface CanvasProps {
  template: LabelTemplate
  size: LabelSize
  selectedField: FieldType | null
  onSelectField: (t: FieldType | null) => void
  onUpdateField: (type: FieldType, patch: Partial<LabelField>) => void
  onCommitField: (type: FieldType, patch: Partial<LabelField>) => void
}

function Canvas({ template, size, selectedField, onSelectField, onUpdateField, onCommitField }: CanvasProps) {
  const scale = computeScale(size.widthMm, size.heightMm)
  const W = size.widthMm, H = size.heightMm
  const { marginLeft: ml, marginRight: mr, marginTop: mt, marginBottom: mb } = template

  // Refs for smooth drag/resize without React re-renders
  const dragRef = useRef<null | {
    type: FieldType
    startMx: number; startMy: number
    startFx: number; startFy: number
    fw: number; fh: number   // field w/h (constant during drag)
    endX: number; endY: number
  }>(null)

  const resizeRef = useRef<null | {
    type: FieldType
    handle: Handle
    startMx: number; startMy: number
    startFx: number; startFy: number; startFw: number; startFh: number
    endX: number; endY: number; endW: number; endH: number
  }>(null)

  // Live overrides during interaction (avoids saving to localStorage on every px)
  const [livePos, setLivePos] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({})

  // Element DOM refs for direct style update
  const elemDomRefs = useRef<Partial<Record<FieldType, HTMLDivElement>>>({})

  const getField = useCallback((type: FieldType) =>
    template.fields.find(f => f.type === type), [template.fields])

  // ── Drag ──────────────────────────────────────────────────────────────────

  const onDragStart = useCallback((e: React.MouseEvent, type: FieldType) => {
    e.preventDefault()
    const f = getField(type)
    if (!f) return
    dragRef.current = {
      type,
      startMx: e.pageX, startMy: e.pageY,
      startFx: f.x ?? 0, startFy: f.y ?? 0,
      fw: f.w ?? 30, fh: f.h ?? 5,
      endX: f.x ?? 0, endY: f.y ?? 0,
    }
  }, [getField])

  // ── Resize ────────────────────────────────────────────────────────────────

  const onResizeStart = useCallback((e: React.MouseEvent, type: FieldType, handle: Handle) => {
    e.preventDefault(); e.stopPropagation()
    const f = getField(type)
    if (!f) return
    resizeRef.current = {
      type, handle,
      startMx: e.pageX, startMy: e.pageY,
      startFx: f.x ?? 0, startFy: f.y ?? 0,
      startFw: f.w ?? 30, startFh: f.h ?? 5,
      endX: f.x ?? 0, endY: f.y ?? 0, endW: f.w ?? 30, endH: f.h ?? 5,
    }
  }, [getField])

  // ── Document mouse handlers ───────────────────────────────────────────────

  useEffect(() => {
    const MIN_W = 3, MIN_H = 2

    const onMove = (e: MouseEvent) => {
      // ── drag ──
      const dr = dragRef.current
      if (dr) {
        const dxMm = mm(e.pageX - dr.startMx, scale)
        const dyMm = mm(e.pageY - dr.startMy, scale)
        const nx = clamp(dr.startFx + dxMm, 0, W - dr.fw)
        const ny = clamp(dr.startFy + dyMm, 0, H - dr.fh)
        dr.endX = nx; dr.endY = ny
        setLivePos(prev => ({ ...prev, [dr.type]: { x: nx, y: ny, w: dr.fw, h: dr.fh } }))
        return
      }
      // ── resize ──
      const rr = resizeRef.current
      if (!rr) return
      const dxMm = mm(e.pageX - rr.startMx, scale)
      const dyMm = mm(e.pageY - rr.startMy, scale)
      let { startFx: rx, startFy: ry, startFw: rw, startFh: rh } = rr
      const h = rr.handle
      if (h.includes('l')) { const nw = Math.max(MIN_W, rw - dxMm); rx = rx + rw - nw; rw = nw }
      if (h.includes('r')) { rw = Math.max(MIN_W, rw + dxMm) }
      if (h.includes('t')) { const nh = Math.max(MIN_H, rh - dyMm); ry = ry + rh - nh; rh = nh }
      if (h.includes('b')) { rh = Math.max(MIN_H, rh + dyMm) }
      rx = clamp(rx, 0, W - rw); ry = clamp(ry, 0, H - rh)
      rw = clamp(rw, MIN_W, W - rx); rh = clamp(rh, MIN_H, H - ry)
      rr.endX = rx; rr.endY = ry; rr.endW = rw; rr.endH = rh
      setLivePos(prev => ({ ...prev, [rr.type]: { x: rx, y: ry, w: rw, h: rh } }))
    }

    const onUp = () => {
      const dr = dragRef.current
      if (dr) {
        dragRef.current = null
        onCommitField(dr.type, { x: parseFloat(dr.endX.toFixed(2)), y: parseFloat(dr.endY.toFixed(2)) })
        setLivePos(prev => { const n = { ...prev }; delete n[dr.type]; return n })
      }
      const rr = resizeRef.current
      if (rr) {
        resizeRef.current = null
        onCommitField(rr.type, {
          x: parseFloat(rr.endX.toFixed(2)), y: parseFloat(rr.endY.toFixed(2)),
          w: parseFloat(rr.endW.toFixed(2)), h: parseFloat(rr.endH.toFixed(2)),
        })
        setLivePos(prev => { const n = { ...prev }; delete n[rr.type]; return n })
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [scale, W, H, onCommitField])

  // ── Keyboard nudge ────────────────────────────────────────────────────────

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
      if (e.key === 'Delete' || e.key === 'Backspace') {
        onCommitField(selectedField, { enabled: false }); return
      }
      if (dx === 0 && dy === 0) return
      e.preventDefault()
      const f = getField(selectedField)
      if (!f) return
      onCommitField(selectedField, {
        x: clamp((f.x ?? 0) + dx, 0, W - (f.w ?? 10)),
        y: clamp((f.y ?? 0) + dy, 0, H - (f.h ?? 5)),
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedField, getField, onCommitField, W, H])

  const safW = Math.max(0, W - ml - mr)
  const safH = Math.max(0, H - mt - mb)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Canvas outer — background represents label area */}
      <div
        onClick={() => onSelectField(null)}
        style={{
          position: 'relative',
          width: px(W, scale), height: px(H, scale),
          background: '#fff',
          border: '1px solid #94a3b8',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          overflow: 'visible',
          cursor: 'default',
          flexShrink: 0,
        }}
      >
        {/* Safe-area dashed boundary */}
        <div style={{
          position: 'absolute',
          left: px(ml, scale), top: px(mt, scale),
          width: px(safW, scale), height: px(safH, scale),
          border: '1px dashed #cbd5e1',
          pointerEvents: 'none',
          zIndex: 0,
        }} />

        {/* Clip warning overlay */}
        {template.fields.filter(f => f.enabled).map(f => {
          const fx = f.x ?? 0, fy = f.y ?? 0, fw = f.w ?? 0, fh = f.h ?? 0
          const clips = fx < ml || fy < mt || (fx + fw) > (W - mr) || (fy + fh) > (H - mb)
          if (!clips || f.type !== selectedField) return null
          return (
            <div key={f.type} style={{
              position: 'absolute', top: -22, left: 0, right: 0,
              background: '#fef9c3', color: '#92400e', fontSize: 11,
              textAlign: 'center', padding: '2px 6px', borderRadius: 4,
              border: '1px solid #fde68a', whiteSpace: 'nowrap',
            }}>
              ⚠ Element extends beyond safe print area
            </div>
          )
        })}

        {/* Field elements */}
        {[...template.fields]
          .filter(f => f.enabled)
          .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
          .map(f => {
            const live = livePos[f.type]
            const displayField = live ? { ...f, ...live } : f
            return (
              <CanvasElem
                key={f.type}
                field={displayField}
                scale={scale}
                selected={selectedField === f.type}
                onSelect={e => { e.stopPropagation(); onSelectField(f.type) }}
                onDragStart={onDragStart}
                onResizeStart={onResizeStart}
              />
            )
          })}
      </div>

      {/* Scale indicator */}
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
        {size.widthMm} × {size.heightMm} mm &nbsp;|&nbsp; scale {scale.toFixed(1)}px/mm
        &nbsp;|&nbsp; ↑↓←→ nudge · Shift+arrow = 2mm · Delete = hide
      </div>
    </div>
  )
}

// ─── Properties panel ─────────────────────────────────────────────────────────

function PropertiesPanel({
  field, template, labelW, labelH, onUpdate,
}: {
  field: LabelField
  template: LabelTemplate
  labelW: number
  labelH: number
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
      <div style={{ fontWeight: 700, color: '#374151', marginBottom: 10, fontSize: 13 }}>
        {FIELD_LABELS[field.type]}
      </div>

      {/* Position */}
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Position</div>
      <div style={GR('1fr 1fr')}>
        {numField('X', 'x', 0, labelW, 0.1, 'mm')}
        {numField('Y', 'y', 0, labelH, 0.1, 'mm')}
      </div>
      <div style={GR('1fr 1fr')}>
        {numField('Width', 'w', 2, labelW, 0.5, 'mm')}
        {numField('Height', 'h', 2, labelH, 0.5, 'mm')}
      </div>

      {/* Appearance */}
      {!isBarcode(field) && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', margin: '6px 0 4px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Text</div>
          <div style={GR('1fr 1fr')}>
            {numField('Font Size', 'fontSize', 0, 72, 0.5, 'pt')}
            <div>
              <label style={LB}>Weight</label>
              <select style={F} value={field.bold ? 'bold' : 'normal'}
                onChange={e => onUpdate({ bold: e.target.value === 'bold' })}>
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
              </select>
            </div>
          </div>
          <div style={GR('1fr 1fr 1fr')}>
            <div>
              <label style={LB}>Style</label>
              <select style={F} value={field.italic ? 'italic' : 'normal'}
                onChange={e => onUpdate({ italic: e.target.value === 'italic' })}>
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </div>
            {numField('Line H', 'lineHeight', 0.8, 3, 0.1)}
            {numField('Spacing', 'letterSpacing', 0, 10, 0.5, 'pt')}
          </div>
          <div style={GR('1fr 1fr')}>
            <div>
              <label style={LB}>Alignment</label>
              <select style={F} value={field.align}
                onChange={e => onUpdate({ align: e.target.value as LabelField['align'] })}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div>
              <label style={LB}>Colour</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="color" value={field.color || '#000000'}
                  onChange={e => onUpdate({ color: e.target.value })}
                  style={{ width: 36, height: 30, border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', padding: 2 }} />
                <input style={{ ...F, flex: 1 }} value={field.color || '#000000'}
                  onChange={e => onUpdate({ color: e.target.value })} placeholder="#000000" />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Barcode */}
      {isBarcode(field) && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', margin: '6px 0 4px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Barcode</div>
          <div style={GR('1fr 1fr')}>
            {numField('Module Width', 'barcodeModuleWidth', 1, 4, 0.5)}
            <div>
              <label style={LB}>Alignment</label>
              <select style={F} value={field.align}
                onChange={e => onUpdate({ align: e.target.value as LabelField['align'] })}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 6 }}>
              <input type="checkbox" checked={!!field.barcodeShowText}
                onChange={e => onUpdate({ barcodeShowText: e.target.checked })} />
              <span style={{ fontSize: 12 }}>Show IMEI digits below barcode</span>
            </label>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Alignment toolbar ────────────────────────────────────────────────────────

function AlignmentToolbar({
  field, template, labelW, labelH, onUpdate,
}: {
  field: LabelField | null
  template: LabelTemplate
  labelW: number
  labelH: number
  onUpdate: (patch: Partial<LabelField>) => void
}) {
  if (!field) return null
  const { marginLeft: ml, marginRight: mr, marginTop: mt, marginBottom: mb } = template
  const sw = labelW - ml - mr, sh = labelH - mt - mb
  const fw = field.w ?? 30, fh = field.h ?? 5

  const btn = (label: string, patch: Partial<LabelField>) => (
    <button key={label} onClick={() => onUpdate(patch)}
      title={label}
      style={{
        padding: '4px 8px', fontSize: 11, border: '1px solid #e2e8f0',
        borderRadius: 4, background: '#f8fafc', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {label}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', width: '100%', marginBottom: 2 }}>ALIGN TO SAFE AREA</div>
      {btn('⇐ Left',   { x: ml })}
      {btn('— Centre', { x: ml + (sw - fw) / 2 })}
      {btn('⇒ Right',  { x: labelW - mr - fw })}
      {btn('⇑ Top',    { y: mt })}
      {btn('| Middle', { y: mt + (sh - fh) / 2 })}
      {btn('⇓ Bottom', { y: labelH - mb - fh })}
      {btn('Fill Width', { x: ml, w: sw })}
    </div>
  )
}

// ─── Layer ordering toolbar ───────────────────────────────────────────────────

function LayerToolbar({
  field, template, onUpdateTemplate,
}: {
  field: LabelField | null
  template: LabelTemplate
  onUpdateTemplate: (t: LabelTemplate) => void
}) {
  if (!field) return null

  const reorder = (fn: (fields: LabelField[]) => LabelField[]) => {
    const sorted = [...template.fields].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    const reindexed = fn(sorted).map((f, i) => ({ ...f, zIndex: i }))
    onUpdateTemplate({ ...template, fields: reindexed })
  }

  const idx = [...template.fields].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .findIndex(f => f.type === field.type)
  const total = template.fields.filter(f => f.enabled).length

  const swap = (arr: LabelField[], i: number, j: number) => {
    const n = [...arr]
    ;[n[i], n[j]] = [n[j], n[i]]
    return n
  }

  const btn = (label: string, disabled: boolean, fn: () => void) => (
    <button key={label} onClick={fn} disabled={disabled}
      style={{
        padding: '4px 8px', fontSize: 11, border: '1px solid #e2e8f0',
        borderRadius: 4, cursor: disabled ? 'default' : 'pointer',
        background: disabled ? '#f1f5f9' : '#f8fafc',
        color: disabled ? '#cbd5e1' : '#374151',
      }}>
      {label}
    </button>
  )

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>LAYER ORDER</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {btn('⊤ Front',    idx >= total - 1, () => reorder(arr => { const n = arr.filter(f => f.type !== field.type); n.push(arr[idx]); return n }))}
        {btn('↑ Forward',  idx >= total - 1, () => reorder(arr => swap(arr, idx, idx + 1)))}
        {btn('↓ Backward', idx <= 0,         () => reorder(arr => swap(arr, idx, idx - 1)))}
        {btn('⊥ Back',     idx <= 0,         () => reorder(arr => { const n = arr.filter(f => f.type !== field.type); n.unshift(arr[idx]); return n }))}
      </div>
    </div>
  )
}

// ─── Template list sidebar ────────────────────────────────────────────────────

function TemplateSidebar({
  templates, activeId, defaultId, sizes,
  onSelect, onSetDefault, onDuplicate, onDelete, onCreateNew, onSizesChange,
}: {
  templates: LabelTemplate[]; activeId: string; defaultId: string; sizes: LabelSize[]
  onSelect: (id: string) => void; onSetDefault: () => void; onDuplicate: () => void
  onDelete: () => void; onCreateNew: (name: string) => void; onSizesChange: (s: LabelSize[]) => void
}) {
  const [addingTmpl, setAddingTmpl] = useState(false)
  const [newName, setNewName] = useState('')
  const [addingSize, setAddingSize] = useState(false)
  const [sName, setSName] = useState(''), [sW, setSW] = useState(''), [sH, setSH] = useState('')
  const F: React.CSSProperties = { padding: '4px 7px', border: '1px solid #d1d5db', borderRadius: 5, fontSize: 12, width: '100%' }

  const submitSize = () => {
    const w = parseFloat(sW), h = parseFloat(sH)
    if (!sName.trim() || !w || !h) { toast.error('Fill in name, width and height'); return }
    onSizesChange([...sizes, { id: `sz-${Date.now()}`, name: sName.trim(), widthMm: w, heightMm: h }])
    setAddingSize(false); setSName(''); setSW(''); setSH('')
    toast.success('Size added')
  }

  return (
    <div style={{ width: 210, flexShrink: 0 }}>
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
            {t.id === defaultId && <span style={{ fontSize: 9, background: '#22c55e', color: '#fff', borderRadius: 3, padding: '1px 4px', fontWeight: 700, flexShrink: 0 }}>DEF</span>}
          </div>
        ))}
        {addingTmpl ? (
          <div style={{ marginTop: 6 }}>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { onCreateNew(newName); setAddingTmpl(false); setNewName('') } if (e.key === 'Escape') setAddingTmpl(false) }}
              style={{ ...F, marginBottom: 5 }} placeholder="Template name" />
            <div style={{ display: 'flex', gap: 5 }}>
              <Btn size="sm" onClick={() => { onCreateNew(newName); setAddingTmpl(false); setNewName('') }}>Create</Btn>
              <Btn size="sm" variant="secondary" onClick={() => setAddingTmpl(false)}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            <Btn size="sm" onClick={() => setAddingTmpl(true)}>+ New</Btn>
            <Btn size="sm" variant="secondary" onClick={onDuplicate}>Copy</Btn>
            <Btn size="sm" onClick={onSetDefault}>Default</Btn>
            <Btn size="sm" variant="danger" onClick={onDelete}>Del</Btn>
          </div>
        )}
      </Card>

      <Card style={{ padding: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Label Sizes</div>
        {sizes.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ flex: 1 }}>{s.name}</span>
            <span style={{ color: '#94a3b8' }}>{s.widthMm}×{s.heightMm}</span>
            <button onClick={() => {
              if (sizes.length <= 1) { toast.error('Cannot delete the last size'); return }
              onSizesChange(sizes.filter(x => x.id !== s.id))
            }}
              style={{ fontSize: 10, color: '#ef4444', cursor: 'pointer', background: 'none', border: 'none' }}>✕</button>
          </div>
        ))}
        {addingSize ? (
          <div style={{ marginTop: 6 }}>
            <input style={{ ...F, marginBottom: 4 }} value={sName} onChange={e => setSName(e.target.value)} placeholder="Name (e.g. 50×25mm)" />
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

// ─── Field list (left of canvas) ─────────────────────────────────────────────

function FieldList({
  template, selectedField, onToggle, onSelectField, onUpdateTemplate,
}: {
  template: LabelTemplate
  selectedField: FieldType | null
  onToggle: (t: FieldType) => void
  onSelectField: (t: FieldType) => void
  onUpdateTemplate: (t: LabelTemplate) => void
}) {
  return (
    <Card style={{ padding: 10, minWidth: 180 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Fields</div>
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 8 }}>Check to show · Click to select</div>
      {template.fields.map(f => (
        <div key={f.type}
          onClick={() => { if (f.enabled) onSelectField(f.type) }}
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

// ─── Main LabelDesigner ───────────────────────────────────────────────────────

export default function LabelDesigner() {
  const [templates, setTemplates] = useState<LabelTemplate[]>(getTemplates)
  const [activeId, setActiveId] = useState<string>(getDefaultTemplateId)
  const [defaultId, setDefaultId] = useState<string>(getDefaultTemplateId)
  const [sizes, setSizes] = useState<LabelSize[]>(getLabelSizes)
  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(getSelectedLabelSizeId)
  const [selectedField, setSelectedField] = useState<FieldType | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameName, setRenameName] = useState('')

  const rawActive = templates.find(t => t.id === activeId) ?? templates[0]
  const selectedSize = sizes.find(s => s.id === selectedSizeId) ?? sizes[0] ?? null

  // Auto-place fields when the template or size changes
  const active = selectedSize && needsPlacement(rawActive)
    ? autoPlaceFields(rawActive, selectedSize.widthMm, selectedSize.heightMm)
    : rawActive

  // Persist active on every change
  const persistTemplates = useCallback((next: LabelTemplate[]) => {
    setTemplates(next)
    saveTemplates(next)
  }, [])

  const persistSizes = (next: LabelSize[]) => {
    setSizes(next)
    saveLabelSizes(next)
  }

  const updateActive = useCallback((tmpl: LabelTemplate) => {
    const next = templates.map(t => t.id === tmpl.id ? tmpl : t)
    persistTemplates(next)
  }, [templates, persistTemplates])

  // When auto-placement runs, save it back to templates
  useEffect(() => {
    if (selectedSize && needsPlacement(rawActive)) {
      updateActive(autoPlaceFields(rawActive, selectedSize.widthMm, selectedSize.heightMm))
    }
  }, [activeId, selectedSizeId])  // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = useCallback((type: FieldType, patch: Partial<LabelField>) => {
    const fields = active.fields.map(f => f.type === type ? { ...f, ...patch } : f)
    updateActive({ ...active, fields })
  }, [active, updateActive])

  // Template actions
  const handleSetDefault = () => { saveDefaultTemplateId(active.id); setDefaultId(active.id); toast.success('Default set') }
  const handleDuplicate = () => {
    const t = createTemplate(`${active.name} (copy)`, active)
    setTemplates(getTemplates()); setActiveId(t.id); setSelectedField(null)
  }
  const handleDelete = () => {
    if (templates.length <= 1) { toast.error('Cannot delete the last template'); return }
    if (!confirm(`Delete "${active.name}"?`)) return
    deleteTemplate(active.id)
    const next = getTemplates(); setTemplates(next); setActiveId(next[0].id); setDefaultId(getDefaultTemplateId()); setSelectedField(null)
  }
  const handleCreateNew = (name: string) => {
    if (!name.trim()) { toast.error('Name required'); return }
    const t = createTemplate(name.trim()); setTemplates(getTemplates()); setActiveId(t.id); setSelectedField(null)
  }
  const handleToggleField = (type: FieldType) => {
    const f = active.fields.find(x => x.type === type)
    if (!f) return
    if (f.enabled && selectedField === type) setSelectedField(null)
    updateField(type, { enabled: !f.enabled })
  }

  const handleTestPrint = () => {
    if (!selectedSize) { toast.error('Select a label size first'); return }
    const html = buildPrintHTML(active, [SAMPLE_DEVICE], selectedSize, sizes, templates, 1)
    const popup = window.open('', '_blank', 'width=900,height=600')
    if (popup) popup.document.write(html)
  }

  const selectedFieldObj = active.fields.find(f => f.type === selectedField) ?? null

  // Rename active template
  const handleRenameSubmit = () => {
    if (!renameName.trim()) { toast.error('Name required'); return }
    updateActive({ ...active, name: renameName.trim() }); setRenaming(false)
  }

  // Size selector
  const handleSizeChange = (id: string) => {
    setSelectedSizeId(id); saveSelectedLabelSizeId(id)
  }

  return (
    <div>
      <PageHeader title="Label Designer" />

      {/* Top bar */}
      <div style={{ padding: '0 24px 10px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {renaming ? (
          <>
            <input autoFocus value={renameName} onChange={e => setRenameName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(false) }}
              style={{ padding: '5px 9px', border: '1px solid #3b82f6', borderRadius: 6, fontSize: 14, width: 200 }} />
            <Btn size="sm" onClick={handleRenameSubmit}>Save</Btn>
            <Btn size="sm" variant="secondary" onClick={() => setRenaming(false)}>Cancel</Btn>
          </>
        ) : (
          <>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{active.name}</span>
            {active.id === defaultId && <span style={{ fontSize: 10, background: '#dcfce7', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 7px', fontWeight: 700 }}>Default</span>}
            <Btn size="sm" variant="secondary" onClick={() => { setRenaming(true); setRenameName(active.name) }}>Rename</Btn>
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* Size selector */}
        {sizes.length > 0 && (
          <select
            value={selectedSizeId ?? ''}
            onChange={e => handleSizeChange(e.target.value)}
            style={{ padding: '5px 9px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
            {sizes.map(s => <option key={s.id} value={s.id}>{s.name} ({s.widthMm}×{s.heightMm}mm)</option>)}
          </select>
        )}

        <Btn variant="secondary" onClick={handleTestPrint}>🖨 Test Print</Btn>
      </div>

      <div style={{ padding: '0 24px 24px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>

        {/* Left sidebar */}
        <TemplateSidebar
          templates={templates} activeId={activeId} defaultId={defaultId} sizes={sizes}
          onSelect={id => { setActiveId(id); setSelectedField(null) }}
          onSetDefault={handleSetDefault}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onCreateNew={handleCreateNew}
          onSizesChange={persistSizes} />

        {/* Field list */}
        <FieldList
          template={active}
          selectedField={selectedField}
          onToggle={handleToggleField}
          onSelectField={t => setSelectedField(t)}
          onUpdateTemplate={updateActive} />

        {/* Canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {selectedSize ? (
            <Canvas
              template={active}
              size={selectedSize}
              selectedField={selectedField}
              onSelectField={setSelectedField}
              onUpdateField={(type, patch) => updateField(type, patch)}
              onCommitField={(type, patch) => updateField(type, patch)} />
          ) : (
            <Card style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
              Add a label size using the "Label Sizes" panel on the left to start designing.
            </Card>
          )}
        </div>

        {/* Right: properties + alignment */}
        <div style={{ width: 230, flexShrink: 0 }}>
          {selectedFieldObj && selectedSize ? (
            <Card style={{ padding: 12 }}>
              <PropertiesPanel
                field={selectedFieldObj}
                template={active}
                labelW={selectedSize.widthMm}
                labelH={selectedSize.heightMm}
                onUpdate={patch => updateField(selectedField!, patch)} />

              <AlignmentToolbar
                field={selectedFieldObj}
                template={active}
                labelW={selectedSize.widthMm}
                labelH={selectedSize.heightMm}
                onUpdate={patch => updateField(selectedField!, patch)} />

              <LayerToolbar
                field={selectedFieldObj}
                template={active}
                onUpdateTemplate={updateActive} />

              {/* Margin controls */}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Label Margins (mm)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                  {(['marginLeft', 'marginRight', 'marginTop', 'marginBottom'] as const).map(k => (
                    <div key={k}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', marginBottom: 2, textAlign: 'center' }}>
                        {k.replace('margin', '')}
                      </div>
                      <input type="number" min="0" max="20" step="0.5" value={active[k]}
                        onChange={e => updateActive({ ...active, [k]: parseFloat(e.target.value) || 0 })}
                        style={{ width: '100%', padding: '3px 5px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }} />
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          ) : (
            <Card style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
                <strong style={{ color: '#475569' }}>Click any element</strong> on the canvas to select and edit it.
                <br /><br />
                <strong style={{ color: '#475569' }}>Drag</strong> to reposition.<br />
                <strong style={{ color: '#475569' }}>Drag handles</strong> to resize.<br />
                <strong style={{ color: '#475569' }}>Arrow keys</strong> to nudge.<br />
                <strong style={{ color: '#475569' }}>Delete</strong> to hide.<br />
                <br />
                Enable/disable fields in the Fields panel.
              </div>

              {/* Margin controls when nothing selected */}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Label Margins (mm)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                  {(['marginLeft', 'marginRight', 'marginTop', 'marginBottom'] as const).map(k => (
                    <div key={k}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', marginBottom: 2, textAlign: 'center' }}>
                        {k.replace('margin', '')}
                      </div>
                      <input type="number" min="0" max="20" step="0.5" value={active[k]}
                        onChange={e => updateActive({ ...active, [k]: parseFloat(e.target.value) || 0 })}
                        style={{ width: '100%', padding: '3px 5px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }} />
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
