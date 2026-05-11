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
import { exportPng, exportSvg } from '../lib/exportPng'
import { saveProject, openProject } from '../lib/project'
import { exportDxf } from '../lib/dxf'
import { getDefaultWallThickness, setDefaultWallThickness, getWallHeightMm, setWallHeightMm } from '../lib/settings'

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

      {/* 프로젝트 저장/열기 */}
      <ProjectSection />

      {/* 그리드 크기 설정 */}
      <GridSection />

      {/* 기본 벽 두께 설정 */}
      <WallDefaultSection scale={scale} />

      {/* 3D 벽 높이 */}
      <WallHeightSection />

      {/* 내보내기 */}
      <ExportSection />

      {sel ? (
        <PropsPanel sel={sel} scale={scale} />
      ) : null}
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

  if (sel.type === 'window') {
    const p = sel.props as { width: number; thickness: number }
    const wMm = p.width / scale.pxPerMm
    const tMm = p.thickness / scale.pxPerMm
    const setW = (mm: number) => {
      if (!editor || mm < 1) return
      editor.updateShape({ id: sel.id, type: 'window' as never, props: { width: mm * scale.pxPerMm } })
    }
    const setT = (mm: number) => {
      if (!editor || mm < 1) return
      editor.updateShape({ id: sel.id, type: 'window' as never, props: { thickness: mm * scale.pxPerMm } })
    }
    return (
      <section className="rbar-section">
        <h3>창문</h3>
        <PropField label="너비" value={wMm} unit={scale.unit} onCommit={setW} />
        <PropField label="두께" value={tMm} unit={scale.unit} onCommit={setT} />
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

  if (sel.type === 'comment') {
    const p = sel.props as { text: string; resolved: boolean; author: string }
    const update = (patch: Partial<typeof p>) =>
      editor?.updateShape({ id: sel.id, type: 'comment' as never, props: patch })
    return (
      <section className="rbar-section">
        <h3>코멘트</h3>
        <div style={{ padding: '4px 0 6px' }}>
          <textarea
            style={{ width: '100%', minHeight: 80, fontSize: 12, padding: '6px 8px',
              border: '1px solid #e0e0e0', borderRadius: 4, resize: 'vertical', fontFamily: 'inherit' }}
            value={p.text}
            placeholder="코멘트 입력..."
            onChange={e => update({ text: e.target.value })}
          />
        </div>
        <div className="rbar-row">
          <span>작성자</span>
          <input className="prop-input" style={{ flex: 1, minWidth: 0 }}
            value={p.author} placeholder="이름"
            onChange={e => update({ author: e.target.value })} />
        </div>
        <div className="rbar-row">
          <span>상태</span>
          <button
            className={`export-btn${p.resolved ? ' active' : ''}`}
            style={{ background: p.resolved ? '#4caf50' : undefined, color: p.resolved ? '#fff' : undefined }}
            onClick={() => update({ resolved: !p.resolved })}
          >
            {p.resolved ? '✓ 해결됨' : '미해결'}
          </button>
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

// ---------- grid size ----------

const GRID_SIZES = [5, 10, 20, 50, 100, 200, 500]

function GridSection() {
  const editor = useEditor()
  const [gridPx, setGridPx] = useState(20)

  useEffect(() => {
    if (!editor) return
    const unsub = editor.store.listen(() => {
      const g = (editor.getInstanceState() as { gridSize?: number }).gridSize
      if (g) setGridPx(g)
    })
    return unsub
  }, [editor])

  const setGrid = (px: number) => {
    if (!editor) return
    editor.updateInstanceState({ gridSize: px } as never)
    setGridPx(px)
  }

  return (
    <section className="rbar-section">
      <h3>그리드</h3>
      <div style={{ padding: '4px 0 8px' }}>
        <select
          value={gridPx}
          onChange={e => setGrid(Number(e.target.value))}
          style={{ width: '100%', fontSize: 12, padding: '3px 6px', border: '1px solid #e0e0e0', borderRadius: 4 }}
        >
          {GRID_SIZES.map(s => <option key={s} value={s}>{s} px</option>)}
        </select>
      </div>
    </section>
  )
}

// ---------- 3D wall height ----------

function WallHeightSection() {
  const [mm, setMm] = useState(getWallHeightMm)
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = parseFloat(draft)
    if (!isNaN(v) && v > 0) { setWallHeightMm(v); setMm(v) }
    setDraft(null)
  }
  return (
    <section className="rbar-section">
      <h3>벽 높이 (3D)</h3>
      <div className="rbar-row">
        <span>높이</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input
            className="prop-input"
            value={draft ?? String(mm)}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(null) }}
          />
          <span style={{ fontSize: 11, color: '#999' }}>mm</span>
        </div>
      </div>
    </section>
  )
}

// ---------- wall default thickness ----------

function WallDefaultSection({ scale }: { scale: ScaleConfig }) {
  const [thickPx, setThickPx] = useState(getDefaultWallThickness)
  const thickMm = thickPx / scale.pxPerMm
  const dispUnit = scale.unit
  const dispVal = scale.unit === 'm' ? thickMm / 1000 : scale.unit === 'cm' ? thickMm / 10 : thickMm
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    if (draft === null) return
    const raw = parseFloat(draft)
    if (!isNaN(raw) && raw > 0) {
      const mm = scale.unit === 'm' ? raw * 1000 : scale.unit === 'cm' ? raw * 10 : raw
      const px = mm * scale.pxPerMm
      setDefaultWallThickness(px)
      setThickPx(px)
    }
    setDraft(null)
  }

  return (
    <section className="rbar-section">
      <h3>벽 기본 두께</h3>
      <div className="rbar-row">
        <span>두께</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input
            ref={inputRef}
            className="prop-input"
            value={draft ?? dispVal.toFixed(dispUnit === 'm' ? 3 : 1)}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') { commit(); inputRef.current?.blur() }
              if (e.key === 'Escape') setDraft(null)
            }}
          />
          <span style={{ fontSize: 11, color: '#999' }}>{dispUnit}</span>
        </div>
      </div>
    </section>
  )
}

// ---------- project save / open ----------

function ProjectSection() {
  const editor = useEditor()
  const [projectName, setProjectName] = useState('untitled')

  return (
    <section className="rbar-section">
      <h3>프로젝트</h3>
      <div className="rbar-row">
        <span>이름</span>
        <input
          className="prop-input"
          style={{ flex: 1, minWidth: 0 }}
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        <button className="export-btn" onClick={() => editor && saveProject(editor, projectName)}>저장</button>
        <button className="export-btn" onClick={() => editor && openProject(editor)}>열기</button>
        <button className="export-btn" onClick={() => editor && exportDxf(editor, projectName)}>DXF</button>
      </div>
    </section>
  )
}

// ---------- export ----------

function ExportSection() {
  const editor = useEditor()
  const [loading, setLoading] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setLoading(true)
    try { await fn() } finally { setLoading(false) }
  }

  return (
    <section className="rbar-section">
      <h3>내보내기</h3>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          className="export-btn"
          disabled={loading}
          onClick={() => editor && run(() => exportPng(editor))}
        >PNG</button>
        <button
          className="export-btn"
          disabled={loading}
          onClick={() => editor && run(() => exportSvg(editor))}
        >SVG</button>
      </div>
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
