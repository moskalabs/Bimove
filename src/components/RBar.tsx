import React, { useEffect, useRef, useState } from 'react'
import { type TLShapeId, createShapeId } from 'tldraw'
import {
  Lock, Unlock, FlipHorizontal2, RotateCw, Check, Wand2, Link2, History,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
} from 'lucide-react'
import { useEditor } from '../context/EditorContext'
import { detectWalls } from '../lib/detectWalls'
import {
  getScaleConfig,
  setScaleConfig,
  SCALE_PRESETS,
  type ScaleUnit,
  type ScaleConfig,
} from '../lib/scaleConfig'
import { exportPng, exportSvg, printPdf } from '../lib/exportPng'
import { createShareLink, copyToClipboard } from '../lib/shareLink'
import { saveVersion } from '../lib/versions'
import { useProjectId } from '../context/ProjectContext'
import { VersionHistoryPanel } from './VersionHistoryPanel'
import { saveProject, openProject } from '../lib/project'
import { exportDxf } from '../lib/dxf'
import {
  getDefaultWallThicknessMm, setDefaultWallThicknessMm,
  getWallHeightMm, setWallHeightMm,
  getShowWallLengths, setShowWallLengths,
  getShowRoomAreas, setShowRoomAreas,
  getRoomNames,
  getSnapEnabled, setSnapEnabled,
} from '../lib/settings'
import { detectRooms } from '../lib/roomDetection'
import { formatArea } from '../lib/formatArea'
import { drawingState } from '../lib/drawingState'

type SelInfo = {
  id: TLShapeId
  type: string
  props: Record<string, unknown>
} | null

export function RBar() {
  const editor = useEditor()
  const [sel, setSel] = useState<SelInfo>(null)
  const [scale, setScaleState] = useState<ScaleConfig>({ unit: 'mm', pxPerMm: 1 })
  const [toolId, setToolId] = useState<string>('select')

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
      setToolId(editor.getCurrentToolId())
    })
    return unsub
  }, [editor])

  const showWallProps = toolId === 'wall' || sel?.type === 'wall'

  const handleUnit = (unit: ScaleUnit) => { if (editor) setScaleConfig(editor, { unit }) }
  const handlePreset = (pxPerMm: number) => { if (editor) setScaleConfig(editor, { pxPerMm }) }

  const selectedShapes = editor?.getSelectedShapes() ?? []

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

      {/* 스냅 설정 */}
      <SnapSection />

      {/* 기본 벽 두께 설정 (벽체 작성/선택 시에만) */}
      {showWallProps && <WallDefaultSection scale={scale} />}

      {/* 3D 벽 높이 (벽체 작성/선택 시에만) */}
      {showWallProps && <WallHeightSection />}

      {/* 표시 설정 */}
      <DisplaySection scale={scale} />

      {/* 방 면적 요약 */}
      <RoomAreaSection scale={scale} />

      {/* 내보내기 메뉴 */}
      <ExportMenuSection />

      {selectedShapes.length > 1 && <AlignPanel />}
      {sel ? (
        <PropsPanel sel={sel} scale={scale} />
      ) : null}

      {/* 그리는 중 길이·각도 표시 (하단 고정) */}
      <DistanceReadoutSection toolId={toolId} scale={scale} />
    </aside>
  )
}

// ---------- ortho snap toggle ----------

function SnapSection() {
  const [on, setOn] = useState(getSnapEnabled)

  const toggle = () => {
    const next = !on
    setSnapEnabled(next)
    setOn(next)
  }

  return (
    <section className="rbar-section">
      <h3>스냅</h3>
      <div className="rbar-row">
        <span>직교 스냅</span>
        <button
          className={`export-btn${on ? ' active' : ''}`}
          style={on ? { background: '#333', color: '#fff', borderColor: '#333' } : undefined}
          onClick={toggle}
        >
          {on ? '켜짐' : '꺼짐'}
        </button>
      </div>
    </section>
  )
}

// ---------- live length/angle readout while drawing ----------

function DistanceReadoutSection({ toolId, scale }: { toolId: string; scale: ScaleConfig }) {
  const editor = useEditor()
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const currentToolId = editor.getCurrentToolId()
      if (currentToolId !== 'wall') { setText(null); return }
      const drawingId = drawingState.drawingId
      const shape = drawingId ? editor.getShape(drawingId as never) : undefined
      if (!shape) { setText(null); return }
      const p = shape.props as { x2: number; y2: number }
      const lenPx = Math.hypot(p.x2, p.y2)
      if (lenPx <= 5) { setText(null); return }
      const lenMm = lenPx / scale.pxPerMm
      const formatted = scale.unit === 'm'
        ? `${(lenMm / 1000).toFixed(2)} m`
        : scale.unit === 'cm'
        ? `${(lenMm / 10).toFixed(1)} cm`
        : `${Math.round(lenMm)} mm`
      const angleDeg = (Math.atan2(p.y2, p.x2) * 180 / Math.PI).toFixed(1)
      setText(`${formatted}  ${angleDeg}°`)
    }
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor, scale])

  if (toolId !== 'wall') return null

  return (
    <section className="rbar-section">
      <h3>길이·각도</h3>
      <div className="rbar-row">
        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: text ? '#1a73e8' : '#bbb' }}>
          {text ?? '그리는 중 표시됩니다'}
        </span>
      </div>
    </section>
  )
}

// ---------- per-type property editors ----------

function PropsPanel({ sel, scale }: { sel: NonNullable<SelInfo>; scale: ScaleConfig }) {
  const editor = useEditor()
  const shape = editor?.getShape(sel.id)
  const isLocked = shape?.isLocked ?? false

  const lockBtn = (
    <section className="rbar-section" style={{ paddingTop: 10, paddingBottom: 10 }}>
      <button
        className="export-btn"
        style={isLocked ? { background: '#555', color: '#fff', borderColor: '#555' } : undefined}
        onClick={() => editor?.updateShape({ id: sel.id, isLocked: !isLocked } as never)}
      >
        {isLocked
          ? <span className="icon-label"><Unlock size={14} strokeWidth={1.75} /> 잠금 해제</span>
          : <span className="icon-label"><Lock size={14} strokeWidth={1.75} /> 잠금</span>}
      </button>
    </section>
  )

  if (sel.type === 'image') {
    return (
      <>
        {lockBtn}
        <ImageDetectSection sel={sel} />
      </>
    )
  }

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
      <>
        {lockBtn}
        <section className="rbar-section">
          <h3>벽</h3>
          <PropField label="길이" value={lenMm} unit={scale.unit} onCommit={setLength} />
          <PropField label="두께" value={thickMm} unit={scale.unit} onCommit={setThickness} />
        </section>
      </>
    )
  }

  if (sel.type === 'block') {
    const p = sel.props as { w: number; h: number; blockId: string }
    const shape = editor?.getShape(sel.id)
    const rotDeg = shape ? Math.round((shape.rotation ?? 0) * 180 / Math.PI) : 0
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
    const setRot = (deg: number) => {
      if (!editor) return
      editor.updateShape({ id: sel.id, rotation: (deg * Math.PI) / 180 } as never)
    }

    return (
      <>
        {lockBtn}
        <section className="rbar-section">
          <h3>블록 ({p.blockId})</h3>
          <PropField label="너비" value={wMm} unit={scale.unit} onCommit={setW} />
          <PropField label="높이" value={hMm} unit={scale.unit} onCommit={setH} />
          <RotationField value={rotDeg} onCommit={setRot} />
        </section>
      </>
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
      <>
        {lockBtn}
        <section className="rbar-section">
          <h3>창문</h3>
          <PropField label="너비" value={wMm} unit={scale.unit} onCommit={setW} />
          <PropField label="두께" value={tMm} unit={scale.unit} onCommit={setT} />
        </section>
      </>
    )
  }

  if (sel.type === 'door') {
    const p = sel.props as { width: number; thickness: number; swing: number; flipped?: boolean }
    const shape = editor?.getShape(sel.id)
    const rotDeg = shape ? Math.round((shape.rotation ?? 0) * 180 / Math.PI) : 0
    const wMm = p.width / scale.pxPerMm
    const setW = (mm: number) => {
      if (!editor || mm < 1) return
      editor.updateShape({ id: sel.id, type: 'door' as never, props: { width: mm * scale.pxPerMm } })
    }
    const setSwing = (v: number) => {
      if (!editor) return
      editor.updateShape({ id: sel.id, type: 'door' as never, props: { swing: v } })
    }
    const setRot = (deg: number) => {
      if (!editor) return
      editor.updateShape({ id: sel.id, rotation: (deg * Math.PI) / 180 } as never)
    }
    const flipDoor = () => {
      if (!editor) return
      editor.updateShape({ id: sel.id, type: 'door' as never, props: { flipped: !p.flipped } })
    }
    return (
      <>
        {lockBtn}
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
          <RotationField value={rotDeg} onCommit={setRot} />
          <div className="rbar-row">
            <span>뒤집기</span>
            <button className={`export-btn${p.flipped ? ' active' : ''}`}
              style={p.flipped ? { background: '#555', color: '#fff', borderColor: '#555' } : undefined}
              onClick={flipDoor}>
              <span className="icon-label"><FlipHorizontal2 size={14} strokeWidth={1.75} /> {p.flipped ? '뒤집힘' : '뒤집기'}</span>
            </button>
          </div>
        </section>
      </>
    )
  }

  if (sel.type === 'text') {
    const p = sel.props as { text: string; size: string; color: string; textAlign: string }
    const set = (props: object) => editor?.updateShape({ id: sel.id, type: 'text' as never, props } as never)
    const TEXT_COLORS = [
      { id: 'black', label: '검정', hex: '#1d1d1d' },
      { id: 'grey', label: '회색', hex: '#9a9a9a' },
      { id: 'blue', label: '파랑', hex: '#1a73e8' },
      { id: 'red', label: '빨강', hex: '#ea4335' },
    ]
    return (
      <>
        {lockBtn}
        <section className="rbar-section">
          <h3>텍스트</h3>
          <div className="rbar-row">
            <span>크기</span>
            <div className="rbar-toggle">
              {(['s', 'm', 'l', 'xl'] as const).map(s => (
                <button key={s} className={p.size === s ? 'active' : ''} onClick={() => set({ size: s })}>
                  {s === 's' ? '소' : s === 'm' ? '중' : s === 'l' ? '대' : '특'}
                </button>
              ))}
            </div>
          </div>
          <div className="rbar-row">
            <span>정렬</span>
            <div className="rbar-toggle">
              <button className={p.textAlign === 'start' ? 'active' : ''} onClick={() => set({ textAlign: 'start' })}>←</button>
              <button className={p.textAlign === 'middle' ? 'active' : ''} onClick={() => set({ textAlign: 'middle' })}>↔</button>
              <button className={p.textAlign === 'end' ? 'active' : ''} onClick={() => set({ textAlign: 'end' })}>→</button>
            </div>
          </div>
          <div className="rbar-row">
            <span>색상</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {TEXT_COLORS.map(c => (
                <button
                  key={c.id}
                  title={c.label}
                  onClick={() => set({ color: c.id })}
                  style={{
                    width: 20, height: 20, borderRadius: 4, border: p.color === c.id ? '2px solid #333' : '1.5px solid #ddd',
                    background: c.hex, cursor: 'pointer', padding: 0,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="rbar-row" style={{ fontSize: 11, color: '#999' }}>
            <span>더블클릭으로 내용 편집</span>
          </div>
        </section>
      </>
    )
  }

  if (sel.type === 'dimension') {
    const p = sel.props as { x2: number; y2: number; offset: number }
    const len = Math.sqrt(p.x2 ** 2 + p.y2 ** 2)
    const lenMm = len / scale.pxPerMm
    const setOffset = (mm: number) => {
      if (!editor || mm < 1) return
      editor.updateShape({ id: sel.id, type: 'dimension' as never, props: { offset: mm * scale.pxPerMm } })
    }
    return (
      <>
        {lockBtn}
        <section className="rbar-section">
          <h3>치수선</h3>
          <div className="rbar-row">
            <span>길이</span>
            <span style={{ color: '#333', fontWeight: 500, fontFamily: 'monospace' }}>
              {scale.unit === 'm' ? `${(lenMm / 1000).toFixed(2)}m` : scale.unit === 'cm' ? `${(lenMm / 10).toFixed(1)}cm` : `${Math.round(lenMm)}mm`}
            </span>
          </div>
          <PropField label="오프셋" value={p.offset / scale.pxPerMm} unit={scale.unit} onCommit={setOffset} />
        </section>
      </>
    )
  }

  if (sel.type === 'comment') {
    const p = sel.props as { text: string; resolved: boolean; author: string }
    const update = (patch: Partial<typeof p>) =>
      editor?.updateShape({ id: sel.id, type: 'comment' as never, props: patch })
    return (
      <>
        {lockBtn}
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
              {p.resolved ? <span className="icon-label"><Check size={14} strokeWidth={1.75} /> 해결됨</span> : '미해결'}
            </button>
          </div>
        </section>
      </>
    )
  }

  return (
    <section className="rbar-section">
      <h3>선택됨</h3>
      <div className="rbar-row"><span>유형</span><span>{sel.type}</span></div>
    </section>
  )
}

// ---------- multi-select align ----------

function AlignPanel() {
  const editor = useEditor()
  if (!editor) return null

  const ids = editor.getSelectedShapeIds()
  if (ids.length < 2) return null

  const align = (alignment: 'left' | 'center-horizontal' | 'right' | 'top' | 'center-vertical' | 'bottom') =>
    editor.alignShapes(ids, alignment)
  const distribute = (axis: 'horizontal' | 'vertical') =>
    editor.distributeShapes(ids, axis)

  const btnStyle: React.CSSProperties = {
    width: 28, height: 28, border: '1px solid #e0e0e0', borderRadius: 4,
    background: '#fff', cursor: 'pointer', fontSize: 13, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  }

  return (
    <section className="rbar-section">
      <h3>정렬 ({ids.length}개 선택)</h3>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button style={btnStyle} title="왼쪽 맞춤" onClick={() => align('left')}><AlignStartVertical size={16} strokeWidth={1.75} /></button>
        <button style={btnStyle} title="가운데 맞춤 (수평)" onClick={() => align('center-horizontal')}><AlignCenterVertical size={16} strokeWidth={1.75} /></button>
        <button style={btnStyle} title="오른쪽 맞춤" onClick={() => align('right')}><AlignEndVertical size={16} strokeWidth={1.75} /></button>
        <button style={btnStyle} title="위쪽 맞춤" onClick={() => align('top')}><AlignStartHorizontal size={16} strokeWidth={1.75} /></button>
        <button style={btnStyle} title="가운데 맞춤 (수직)" onClick={() => align('center-vertical')}><AlignCenterHorizontal size={16} strokeWidth={1.75} /></button>
        <button style={btnStyle} title="아래쪽 맞춤" onClick={() => align('bottom')}><AlignEndHorizontal size={16} strokeWidth={1.75} /></button>
        <button style={btnStyle} title="수평 간격 균등" onClick={() => distribute('horizontal')}><AlignHorizontalDistributeCenter size={16} strokeWidth={1.75} /></button>
        <button style={btnStyle} title="수직 간격 균등" onClick={() => distribute('vertical')}><AlignVerticalDistributeCenter size={16} strokeWidth={1.75} /></button>
      </div>
    </section>
  )
}

// ---------- grid size ----------

const GRID_SIZES = [5, 10, 20, 50, 100, 200, 500]

function GridSection() {
  const editor = useEditor()
  const [gridPx, setGridPx] = useState(20)
  const [gridOn, setGridOn] = useState(false)

  useEffect(() => {
    if (!editor) return
    const unsub = editor.store.listen(() => {
      const state = editor.getInstanceState()
      const g = (state as { gridSize?: number }).gridSize
      if (g) setGridPx(g)
      setGridOn(!!(state as { isGridMode?: boolean }).isGridMode)
    })
    return unsub
  }, [editor])

  const setGrid = (px: number) => {
    if (!editor) return
    editor.updateInstanceState({ gridSize: px } as never)
    setGridPx(px)
  }

  const toggleGrid = () => {
    if (!editor) return
    const next = !gridOn
    editor.updateInstanceState({ isGridMode: next } as never)
    setGridOn(next)
  }

  return (
    <section className="rbar-section">
      <h3>그리드</h3>
      <div className="rbar-row">
        <span>표시</span>
        <button
          className={`export-btn${gridOn ? ' active' : ''}`}
          style={gridOn ? { background: '#333', color: '#fff', borderColor: '#333' } : undefined}
          onClick={toggleGrid}
        >
          {gridOn ? '켜짐' : '꺼짐'}
        </button>
      </div>
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

// ---------- image → auto wall detection ----------

function ImageDetectSection({ sel }: { sel: NonNullable<SelInfo> }) {
  const editor = useEditor()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const run = async () => {
    if (!editor || busy) return
    const assetId = (sel.props as { assetId?: string }).assetId
    if (!assetId) { setMsg('이미지 데이터를 찾을 수 없습니다.'); return }
    const asset = editor.getAsset(assetId as never) as { props?: { src?: string } } | undefined
    const src = asset?.props?.src
    if (!src) { setMsg('이미지 소스를 읽을 수 없습니다.'); return }

    const shape = editor.getShape(sel.id)
    if (!shape) return
    const { x: ox, y: oy } = shape
    const { w: sw, h: sh } = shape.props as { w: number; h: number }

    setBusy(true)
    setMsg('OpenCV 로딩 및 분석 중… (처음엔 다소 걸려요)')
    try {
      const { lines, width, height } = await detectWalls(src)
      if (lines.length === 0) { setMsg('선분을 찾지 못했습니다. 더 선명한 도면을 써보세요.'); return }
      const kx = sw / width, ky = sh / height
      const thickness = getDefaultWallThicknessMm() * getScaleConfig(editor!).pxPerMm
      const shapes = lines.map((ln) => {
        const x1 = ox + ln.x1 * kx, y1 = oy + ln.y1 * ky
        const x2 = ox + ln.x2 * kx, y2 = oy + ln.y2 * ky
        return {
          id: createShapeId(),
          type: 'wall' as const,
          x: x1, y: y1,
          props: { x2: x2 - x1, y2: y2 - y1, thickness },
        }
      })
      editor.createShapes(shapes as never)
      editor.setSelectedShapes(shapes.map(s => s.id))
      setMsg(`${shapes.length}개의 벽을 생성했습니다.`)
    } catch (e) {
      setMsg('분석 중 오류: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rbar-section">
      <h3>도면 이미지</h3>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 8, lineHeight: 1.5 }}>
        업로드한 도면에서 벽 선을 자동으로 추출합니다.
      </div>
      <button className="export-btn" disabled={busy} onClick={run} style={{ width: '100%' }}>
        {busy ? '분석 중…' : <span className="icon-label"><Wand2 size={14} strokeWidth={1.75} /> 벽 자동 인식</span>}
      </button>
      {msg && <div style={{ fontSize: 11, color: busy ? '#1a73e8' : '#666', marginTop: 8, lineHeight: 1.5 }}>{msg}</div>}
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

// ---------- display toggles ----------

function DisplaySection({ scale: _scale }: { scale: ScaleConfig }) {
  const [showLengths, setShowLengths] = useState(getShowWallLengths)
  const [showAreas, setShowAreas] = useState(getShowRoomAreas)

  const toggle = (kind: 'lengths' | 'areas') => {
    if (kind === 'lengths') {
      const next = !showLengths
      setShowLengths(next)
      setShowWallLengths(next)
    } else {
      const next = !showAreas
      setShowAreas(next)
      setShowRoomAreas(next)
    }
    window.dispatchEvent(new Event('bimove:settings'))
  }

  return (
    <section className="rbar-section">
      <h3>표시</h3>
      <div className="rbar-row">
        <span>벽 길이</span>
        <button className={`toggle-btn${showLengths ? ' active' : ''}`} onClick={() => toggle('lengths')}>
          {showLengths ? '켜짐' : '꺼짐'}
        </button>
      </div>
      <div className="rbar-row">
        <span>방 면적</span>
        <button className={`toggle-btn${showAreas ? ' active' : ''}`} onClick={() => toggle('areas')}>
          {showAreas ? '켜짐' : '꺼짐'}
        </button>
      </div>
    </section>
  )
}

// ---------- room area summary ----------

function roomKey(cx: number, cy: number): string {
  return `${Math.round(cx / 50) * 50},${Math.round(cy / 50) * 50}`
}

function RoomAreaSection({ scale }: { scale: ScaleConfig }) {
  const editor = useEditor()
  const [rooms, setRooms] = useState<{ area: number; key: string }[]>([])
  const [names, setNames] = useState(getRoomNames)

  useEffect(() => {
    const onSettings = () => setNames(getRoomNames())
    window.addEventListener('bimove:settings', onSettings)
    return () => window.removeEventListener('bimove:settings', onSettings)
  }, [])

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const walls = editor.getCurrentPageShapes()
        .filter(s => s.type === 'wall')
        .map(s => {
          const p = s.props as { x2: number; y2: number }
          return { x1: s.x, y1: s.y, x2: s.x + p.x2, y2: s.y + p.y2 }
        })
      const detected = detectRooms(walls)
      const k = scale.pxPerMm
      setRooms(detected.map(r => ({
        area: r.area / (k * k),
        key: roomKey(r.centroid.x, r.centroid.y),
      })))
    }
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor, scale])

  if (rooms.length === 0) return null

  const total = rooms.reduce((s, r) => s + r.area, 0)

  return (
    <section className="rbar-section">
      <h3>방 면적</h3>
      {rooms.map((r, i) => (
        <div key={r.key} className="rbar-row" style={{ fontSize: 11 }}>
          <span style={{ color: '#555' }}>{names[r.key] ?? `방 ${i + 1}`}</span>
          <span style={{ fontFamily: 'monospace', color: '#333' }}>{formatArea(r.area, scale.unit)}</span>
        </div>
      ))}
      <div className="rbar-row" style={{ fontWeight: 600, borderTop: '1px solid #e8e8e8', paddingTop: 5, marginTop: 2 }}>
        <span>합계</span>
        <span style={{ fontFamily: 'monospace' }}>{formatArea(total, scale.unit)}</span>
      </div>
    </section>
  )
}

// ---------- wall default thickness ----------

function WallDefaultSection({ scale }: { scale: ScaleConfig }) {
  const [thickMm, setThickMm] = useState(getDefaultWallThicknessMm)
  const dispUnit = scale.unit
  const dispVal = scale.unit === 'm' ? thickMm / 1000 : scale.unit === 'cm' ? thickMm / 10 : thickMm
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    if (draft === null) return
    const raw = parseFloat(draft)
    if (!isNaN(raw) && raw > 0) {
      const mm = scale.unit === 'm' ? raw * 1000 : scale.unit === 'cm' ? raw * 10 : raw
      setDefaultWallThicknessMm(mm)
      setThickMm(mm)
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
  const projectId = useProjectId()
  const [projectName, setProjectName] = useState('untitled')
  const [showHistory, setShowHistory] = useState(false)

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
        <button className="export-btn" onClick={() => {
          if (!editor) return
          void saveProject(editor, projectName)
          if (projectId) {
            const label = prompt('이 버전에 이름을 붙일래? (선택)') ?? undefined
            saveVersion(projectId, editor.store.getStoreSnapshot(), label || undefined)
          }
        }}>저장</button>
        <button className="export-btn" onClick={() => { if (editor) void openProject(editor) }}>열기</button>
        <button className="export-btn" onClick={() => editor && exportDxf(editor, projectName)}>DXF</button>
        <button className="export-btn" onClick={async () => {
          if (!editor) return
          try {
            const snapshot = editor.store.getStoreSnapshot()
            const url = await createShareLink(projectName, snapshot)
            const ok = await copyToClipboard(url)
            alert(ok ? '공유 링크가 클립보드에 복사됐어!' : '공유 링크:\n' + url)
          } catch (err) {
            alert('공유 링크 생성 실패: ' + String(err))
          }
        }}><span className="icon-label"><Link2 size={14} strokeWidth={1.75} /> 공유</span></button>
        <button className="export-btn" disabled={!projectId} onClick={() => setShowHistory(true)}><span className="icon-label"><History size={14} strokeWidth={1.75} /> 히스토리</span></button>
      </div>
      {showHistory && projectId && (
        <VersionHistoryPanel editor={editor} projectId={projectId} onClose={() => setShowHistory(false)} />
      )}
    </section>
  )
}

// ---------- export (menu) ----------

function ExportMenuSection() {
  const editor = useEditor()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  const run = async (fn: () => Promise<void>) => {
    setLoading(true)
    setOpen(false)
    try { await fn() } finally { setLoading(false) }
  }

  const items: { label: string; fn: () => Promise<void> }[] = editor ? [
    { label: 'PNG로 내보내기', fn: () => exportPng(editor) },
    { label: 'SVG로 내보내기', fn: () => exportSvg(editor) },
    { label: 'PDF로 인쇄', fn: () => printPdf(editor) },
  ] : []

  return (
    <section className="rbar-section" ref={menuRef} style={{ position: 'relative' }}>
      <h3>내보내기</h3>
      <button
        className="export-btn"
        disabled={loading}
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%' }}
      >
        {loading ? '내보내는 중…' : '내보내기 메뉴 ▾'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', left: 16, right: 16, marginTop: 4,
          background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 600, overflow: 'hidden',
        }}>
          {items.map(item => (
            <button
              key={item.label}
              onClick={() => run(item.fn)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 12px', border: 'none', background: 'transparent',
                cursor: 'pointer', fontSize: 12, color: '#333',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >{item.label}</button>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------- rotation input ----------

function RotationField({ value, onCommit }: { value: number; onCommit: (deg: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const normalized = ((value % 360) + 360) % 360

  const commit = () => {
    if (draft === null) return
    const raw = parseFloat(draft)
    if (!isNaN(raw)) onCommit(raw)
    setDraft(null)
  }

  const snap90 = (deg: number) => onCommit(((Math.round(deg / 90) * 90) % 360 + 360) % 360)

  return (
    <div className="rbar-row">
      <span>회전</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <input
          ref={inputRef}
          className="prop-input"
          value={draft ?? String(normalized)}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { commit(); inputRef.current?.blur() } if (e.key === 'Escape') setDraft(null) }}
        />
        <span style={{ fontSize: 11, color: '#999' }}>°</span>
        <button
          style={{ width: 22, height: 22, border: '1px solid #e0e0e0', borderRadius: 3, background: '#fff', cursor: 'pointer', fontSize: 12 }}
          title="90° 회전"
          onClick={() => snap90(normalized + 90)}
        ><RotateCw size={13} strokeWidth={1.75} /></button>
      </div>
    </div>
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
