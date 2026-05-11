import { useEffect, useRef, useState } from 'react'
import { type TLShapeId } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import {
  getScaleConfig,
  setScaleConfig,
  SCALE_PRESETS,
  type ScaleUnit,
  type ScaleConfig,
} from '../lib/scaleConfig'

type SelInfo = {
  id: TLShapeId
  type: string
  props: Record<string, unknown>
} | null

export function RBar() {
  const editor = useEditor()
  const [sel, setSel] = useState<SelInfo>(null)
  const [scale, setScaleState] = useState<ScaleConfig>({ unit: 'mm', pxPerMm: 1 })

  useEffect(() => {
    if (!editor) return
    const unsub = editor.store.listen(() => {
      const shapes = editor.getSelectedShapes()
      if (shapes.length === 1) {
        const s = shapes[0]
        setSel({ id: s.id, type: s.type, props: s.props as Record<string, unknown> })
      } else {
        setSel(null)
      }
      setScaleState(getScaleConfig(editor))
    })
    return unsub
  }, [editor])

  const handleUnit = (unit: ScaleUnit) => { if (editor) setScaleConfig(editor, { unit }) }
  const handlePreset = (pxPerMm: number) => { if (editor) setScaleConfig(editor, { pxPerMm }) }

  return (
    <aside className="rbar">
      <section className="rbar-section">
        <h3>스케일</h3>
        <div className="rbar-row">
          <span>단위</span>
          <div className="rbar-toggle">
            {(['mm', 'cm', 'm'] as ScaleUnit[]).map(u => (
              <button key={u} className={scale.unit === u ? 'active' : ''} onClick={() => handleUnit(u)}>{u}</button>
            ))}
          </div>
        </div>
        <div style={{ padding: '4px 0 8px' }}>
          <div style={{ color: '#666', fontSize: 11, marginBottom: 4 }}>배율</div>
          <select
            value={scale.pxPerMm}
            onChange={e => handlePreset(Number(e.target.value))}
            style={{ width: '100%', fontSize: 12, padding: '3px 6px', border: '1px solid #e0e0e0', borderRadius: 4 }}
          >
            {SCALE_PRESETS.map(p => <option key={p.pxPerMm} value={p.pxPerMm}>{p.label}</option>)}
          </select>
        </div>
      </section>

      {sel ? (
        <PropsPanel sel={sel} scale={scale} />
      ) : (
        <section className="rbar-section">
          <h3>프로젝트</h3>
          <div className="rbar-row"><span>파일명</span><span>Drawing 1</span></div>
        </section>
      )}
    </aside>
  )
}

// ---------- per-type property editors ----------

function PropsPanel({ sel, scale }: { sel: NonNullable<SelInfo>; scale: ScaleConfig }) {
  const editor = useEditor()

  if (sel.type === 'wall') {
    const p = sel.props as { x2: number; y2: number; thickness: number }
    const lenPx = Math.sqrt(p.x2 ** 2 + p.y2 ** 2)
    const lenMm = lenPx / scale.pxPerMm
    const thickMm = p.thickness / scale.pxPerMm

    const setLength = (mm: number) => {
      if (!editor || mm < 1) return
      const newPx = mm * scale.pxPerMm
      const ratio = lenPx > 0 ? newPx / lenPx : 1
      editor.updateShape({ id: sel.id, type: 'wall' as never, props: { x2: p.x2 * ratio, y2: p.y2 * ratio } })
    }

    const setThickness = (mm: number) => {
      if (!editor || mm < 1) return
      editor.updateShape({ id: sel.id, type: 'wall' as never, props: { thickness: mm * scale.pxPerMm } })
    }

    return (
      <section className="rbar-section">
        <h3>벽</h3>
        <PropField label="길이" value={lenMm} unit={scale.unit} onCommit={setLength} />
        <PropField label="두께" value={thickMm} unit={scale.unit} onCommit={setThickness} />
      </section>
    )
  }

  if (sel.type === 'block') {
    const p = sel.props as { w: number; h: number; blockId: string }
    const wMm = p.w / scale.pxPerMm
    const hMm = p.h / scale.pxPerMm

    const setW = (mm: number) => {
      if (!editor || mm < 1) return
      editor.updateShape({ id: sel.id, type: 'block' as never, props: { w: mm * scale.pxPerMm } })
    }
    const setH = (mm: number) => {
      if (!editor || mm < 1) return
      editor.updateShape({ id: sel.id, type: 'block' as never, props: { h: mm * scale.pxPerMm } })
    }

    return (
      <section className="rbar-section">
        <h3>블록 ({p.blockId})</h3>
        <PropField label="너비" value={wMm} unit={scale.unit} onCommit={setW} />
        <PropField label="높이" value={hMm} unit={scale.unit} onCommit={setH} />
      </section>
    )
  }

  if (sel.type === 'door') {
    const p = sel.props as { width: number; thickness: number; swing: number }
    const wMm = p.width / scale.pxPerMm
    const setW = (mm: number) => {
      if (!editor || mm < 1) return
      editor.updateShape({ id: sel.id, type: 'door' as never, props: { width: mm * scale.pxPerMm } })
    }
    const setSwing = (v: number) => {
      if (!editor) return
      editor.updateShape({ id: sel.id, type: 'door' as never, props: { swing: v } })
    }
    return (
      <section className="rbar-section">
        <h3>문</h3>
        <PropField label="너비" value={wMm} unit={scale.unit} onCommit={setW} />
        <div className="rbar-row">
          <span>열림방향</span>
          <div className="rbar-toggle">
            <button className={p.swing === 1 ? 'active' : ''} onClick={() => setSwing(1)}>↑</button>
            <button className={p.swing === -1 ? 'active' : ''} onClick={() => setSwing(-1)}>↓</button>
          </div>
        </div>
      </section>
    )
  }

  if (sel.type === 'text') {
    const p = sel.props as { text: string; size: string }
    const setSize = (v: string) => {
      if (!editor) return
      editor.updateShape({ id: sel.id, type: 'text' as never, props: { size: v } })
    }
    return (
      <section className="rbar-section">
        <h3>텍스트</h3>
        <div className="rbar-row"><span>내용</span><span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.text || '(비어있음)'}</span></div>
        <div className="rbar-row">
          <span>크기</span>
          <div className="rbar-toggle">
            {(['s', 'm', 'l', 'xl'] as const).map(s => (
              <button key={s} className={p.size === s ? 'active' : ''} onClick={() => setSize(s)}>{s}</button>
            ))}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="rbar-section">
      <h3>선택됨</h3>
      <div className="rbar-row"><span>유형</span><span>{sel.type}</span></div>
    </section>
  )
}

// ---------- reusable numeric input ----------

function PropField({
  label, value, unit, onCommit,
}: {
  label: string
  value: number
  unit: string
  onCommit: (v: number) => void
}) {
  const dispUnit = unit === 'm' ? 'm' : unit === 'cm' ? 'cm' : 'mm'
  const dispVal = unit === 'm' ? value / 1000 : unit === 'cm' ? value / 10 : value
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    if (draft === null) return
    const raw = parseFloat(draft)
    if (!isNaN(raw) && raw > 0) {
      // convert back to mm then let onCommit handle px
      const mm = unit === 'm' ? raw * 1000 : unit === 'cm' ? raw * 10 : raw
      onCommit(mm)
    }
    setDraft(null)
  }

  return (
    <div className="rbar-row">
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <input
          ref={inputRef}
          className="prop-input"
          value={draft ?? dispVal.toFixed(unit === 'm' ? 3 : 1)}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { commit(); inputRef.current?.blur() } if (e.key === 'Escape') setDraft(null) }}
        />
        <span style={{ fontSize: 11, color: '#999' }}>{dispUnit}</span>
      </div>
    </div>
  )
}
