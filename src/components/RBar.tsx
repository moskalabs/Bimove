import React, { useEffect, useRef, useState } from 'react'
import { type TLShapeId, createShapeId } from 'tldraw'
import {
  Lock, Unlock, FlipHorizontal2, RotateCw, Check, Wand2,
  History, Play, User, MoreHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  ChevronUp, ChevronDown,
} from 'lucide-react'
import { useEditor } from '../context/EditorContext'
import { detectWalls } from '../lib/detectWalls'
import {
  getScaleConfig,
  setScaleConfig,
  type ScaleUnit,
  type ScaleConfig,
} from '../lib/scaleConfig'
import { createShareLink, copyToClipboard } from '../lib/shareLink'
import { useProjectId } from '../context/ProjectContext'
import { useToast } from '../context/ToastContext'
import { VersionHistoryPanel } from './VersionHistoryPanel'
import {
  getDefaultWallThicknessMm, setDefaultWallThicknessMm,
  getWallHeightMm, setWallHeightMm,
  getSnapEnabled, setSnapEnabled,
  getDarkMode, setDarkMode as persistDarkMode,
} from '../lib/settings'
import { drawingState } from '../lib/drawingState'

type SelInfo = {
  id: TLShapeId
  type: string
  props: Record<string, unknown>
} | null

/* ── R bar 메인 ── */
export function RBar() {
  const editor = useEditor()
  const { toast } = useToast()
  const [sel, setSel] = useState<SelInfo>(null)
  const [scale, setScaleState] = useState<ScaleConfig>({ unit: 'mm', pxPerMm: 1 })
  const [currentToolId, setCurrentToolId] = useState<string>('select')

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
      setCurrentToolId(editor.getCurrentToolId())
    })
    return unsub
  }, [editor])

  const showWallProps = currentToolId === 'wall' || sel?.type === 'wall'
  const selectedShapes = editor?.getSelectedShapes() ?? []

  return (
    <aside className="rbar">
      {/* ── 섹션 1: 프로젝트 작업 (상단 액션바) ── */}
      <TopActionBar />

      {/* ── 섹션 2: 프로젝트 정보 ── */}
      <ProjectInfoSection />

      {/* ── 섹션 3: 모델 페이지 (현재 페이지 속성) ── */}
      <ModelPageSection scale={scale} />

      {/* spacer */}
      <div style={{ flex: 1 }} />

      {/* ── 선택 상태에 따른 속성 패널 ── */}
      {showWallProps && <WallDefaultSection scale={scale} />}
      {showWallProps && <WallHeightSection />}
      {selectedShapes.length > 1 && <AlignPanel />}
      {sel && <PropsPanel sel={sel} scale={scale} />}

      {/* ── 섹션 4: 화면 보기 (하단 고정) ── */}
      <ViewSection toolId={currentToolId} scale={scale} />
    </aside>
  )
}

/* ── 상단 액션바: 사용자 아이콘 · 히스토리 · 미리보기 · 공유하기 ── */
function TopActionBar() {
  const editor = useEditor()
  const projectId = useProjectId()
  const [showHistory, setShowHistory] = useState(false)

  return (
    <>
      {/* 탭 네비게이션 */}
      <div className="rbar-tabs">
        <button className="rbar-tab" title="사용자"><User size={14} strokeWidth={1.75} /></button>
        <button className="rbar-tab" title="히스토리" onClick={() => setShowHistory(true)}>
          <History size={14} strokeWidth={1.75} />
        </button>
        <button className="rbar-tab" title="미리보기"><Play size={14} strokeWidth={1.75} /></button>
        <button className="rbar-tab" title="공유하기" onClick={async () => {
          if (!editor) return
          try {
            const snapshot = editor.store.getStoreSnapshot()
            const url = await createShareLink('Drawing', snapshot)
            const ok = await copyToClipboard(url)
            toast(ok ? '공유 링크가 클립보드에 복사되었습니다.' : '클립보드 복사 실패. 링크: ' + url, ok ? 'success' : 'info')
          } catch (err) {
            toast('공유 링크 생성에 실패했습니다: ' + String(err), 'error')
          }
        }}>공유하기</button>
      </div>

      {/* 액션 버튼 행 */}
      <div className="rbar-action-row">
        <div className="rbar-avatar">B</div>
        <button className="rbar-action-btn" title="새로고침" onClick={() => window.location.reload()}>
          <RotateCw size={16} strokeWidth={1.75} />
        </button>
        <button className="rbar-action-btn" title="미리보기">
          <Play size={16} strokeWidth={1.75} />
        </button>
        <button className="rbar-share-btn" onClick={async () => {
          if (!editor) return
          try {
            const snapshot = editor.store.getStoreSnapshot()
            const url = await createShareLink('Drawing', snapshot)
            const ok = await copyToClipboard(url)
            toast(ok ? '공유 링크가 클립보드에 복사되었습니다.' : '클립보드 복사 실패. 링크: ' + url, ok ? 'success' : 'info')
          } catch (err) {
            toast('공유 링크 생성에 실패했습니다: ' + String(err), 'error')
          }
        }}>Share</button>
      </div>

      {showHistory && projectId && (
        <VersionHistoryPanel editor={editor} projectId={projectId} onClose={() => setShowHistory(false)} />
      )}
    </>
  )
}

/* ── 프로젝트 정보: 파일명, 프로필 ── */
function ProjectInfoSection() {
  const [projectName, setProjectName] = useState('Drawing 1')

  return (
    <section className="rbar-section">
      <div className="rbar-section-title">▾ 프로젝트</div>
      <div className="rbar-prop-row">
        <span className="rbar-prop-label">파일명</span>
        <input
          className="rbar-prop-input"
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
        />
      </div>
      <div className="rbar-prop-row">
        <span className="rbar-prop-label">프로필</span>
        <span className="rbar-prop-value">BuildAI</span>
      </div>
    </section>
  )
}

/* ── 모델 페이지 속성: 도면층, 스타일, 그리드, 단위 ── */
function ModelPageSection({ scale }: { scale: ScaleConfig }) {
  const editor = useEditor()
  const [gridOn, setGridOn] = useState(false)
  const [darkMode, setDarkModeLocal] = useState(getDarkMode)
  const [layer, setLayer] = useState('CO-1')

  useEffect(() => {
    if (!editor) return
    const unsub = editor.store.listen(() => {
      const state = editor.getInstanceState()
      setGridOn(!!(state as { isGridMode?: boolean }).isGridMode)
    })
    return unsub
  }, [editor])

  const toggleGrid = () => {
    if (!editor) return
    const next = !gridOn
    editor.updateInstanceState({ isGridMode: next } as never)
    setGridOn(next)
  }

  const handleUnit = (unit: ScaleUnit) => { if (editor) setScaleConfig(editor, { unit }) }

  const UNIT_OPTIONS: { value: ScaleUnit; label: string }[] = [
    { value: 'mm', label: 'Millimeters' },
    { value: 'cm', label: 'Centimeters' },
    { value: 'm', label: 'Meters' },
  ]

  return (
    <section className="rbar-section">
      <div className="rbar-section-title">▾ 모델 페이지</div>

      {/* 도면층 */}
      <div className="rbar-prop-row">
        <span className="rbar-prop-label">도면층</span>
        <div className="rbar-layer-select">
          <span className="rbar-layer-dot" style={{ background: '#ea4335' }} />
          <select
            className="rbar-select"
            value={layer}
            onChange={e => setLayer(e.target.value)}
          >
            <option value="CO-1">CO-1</option>
            <option value="Default">Default</option>
            <option value="A-Wall">A-Wall</option>
            <option value="A-Door">A-Door</option>
          </select>
        </div>
      </div>

      {/* 스타일 */}
      <div className="rbar-prop-row">
        <span className="rbar-prop-label">스타일</span>
        <div className="rbar-toggle-group">
          <button
            className={`rbar-toggle-btn${!darkMode ? ' active' : ''}`}
            onClick={() => { persistDarkMode(false); setDarkModeLocal(false) }}
          >Light</button>
          <button
            className={`rbar-toggle-btn${darkMode ? ' active' : ''}`}
            onClick={() => { persistDarkMode(true); setDarkModeLocal(true) }}
          >Dark</button>
        </div>
      </div>

      {/* 그리드 */}
      <div className="rbar-prop-row">
        <span className="rbar-prop-label">그리드</span>
        <div className="rbar-toggle-group">
          <button
            className={`rbar-toggle-btn${gridOn ? ' active' : ''}`}
            onClick={() => { if (!gridOn) toggleGrid() }}
          >Show</button>
          <button
            className={`rbar-toggle-btn${!gridOn ? ' active' : ''}`}
            onClick={() => { if (gridOn) toggleGrid() }}
          >Hide</button>
        </div>
      </div>

      {/* 단위 */}
      <div className="rbar-prop-row">
        <span className="rbar-prop-label">단 위</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          <select
            className="rbar-select"
            style={{ flex: 1 }}
            value={scale.unit}
            onChange={e => handleUnit(e.target.value as ScaleUnit)}
          >
            {UNIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="rbar-more-btn" title="단위 상세 설정">
            <MoreHorizontal size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </section>
  )
}

/* ── 화면 보기 (하단): 거리 표시 + 스냅 ── */
function ViewSection({ toolId: _toolId, scale }: { toolId: string; scale: ScaleConfig }) {
  const editor = useEditor()
  const [snapEnd, setSnapEnd] = useState(true)
  const [snapMid, setSnapMid] = useState(true)
  const [snapOrtho, setSnapOrtho] = useState(getSnapEnabled)
  const [distText, setDistText] = useState<string | null>(null)
  const [zoom, setZoom] = useState(100)

  useEffect(() => {
    if (!editor) return
    const update = () => {
      setZoom(Math.round(editor.getZoomLevel() * 100))

      const currentToolId = editor.getCurrentToolId()
      if (currentToolId !== 'wall') { setDistText(null); return }
      const drawingId = drawingState.drawingId
      const shape = drawingId ? editor.getShape(drawingId as never) : undefined
      if (!shape) { setDistText(null); return }
      const p = shape.props as { x2: number; y2: number }
      const lenPx = Math.hypot(p.x2, p.y2)
      if (lenPx <= 5) { setDistText(null); return }
      const lenMm = lenPx / scale.pxPerMm
      const formatted = scale.unit === 'm'
        ? `${(lenMm / 1000).toFixed(2)} m`
        : scale.unit === 'cm'
        ? `${(lenMm / 10).toFixed(1)} cm`
        : `${Math.round(lenMm)} mm`
      setDistText(formatted)
    }
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor, scale])

  const zoomIn = () => { if (editor) editor.zoomIn() }
  const zoomOut = () => { if (editor) editor.zoomOut() }

  const toggleSnap = (kind: 'end' | 'mid' | 'ortho') => {
    if (kind === 'end') setSnapEnd(!snapEnd)
    else if (kind === 'mid') setSnapMid(!snapMid)
    else {
      const next = !snapOrtho
      setSnapOrtho(next)
      setSnapEnabled(next)
    }
  }

  return (
    <div className="rbar-view-section">
      {/* 거리 표시 바 */}
      <div className="rbar-distance-bar">
        <div className="rbar-distance-icon">
          <RotateCw size={16} strokeWidth={1.75} />
        </div>
        <button className="rbar-zoom-btn" onClick={zoomOut} title="축소">
          <ChevronDown size={14} strokeWidth={2} />
        </button>
        <div className="rbar-distance-value">
          {distText ?? `${zoom}%`}
        </div>
        <button className="rbar-zoom-btn" onClick={zoomIn} title="확대">
          <ChevronUp size={14} strokeWidth={2} />
        </button>
      </div>

      {/* 스냅 옵션 */}
      <div className="rbar-snap-options">
        <label className="rbar-snap-item">
          <input type="checkbox" checked={snapEnd} onChange={() => toggleSnap('end')} />
          <span className="rbar-snap-icon">✓ ↗</span>
          <span>끝점</span>
        </label>
        <label className="rbar-snap-item">
          <input type="checkbox" checked={snapMid} onChange={() => toggleSnap('mid')} />
          <span className="rbar-snap-icon">✓ ↗</span>
          <span>중간점</span>
        </label>
        <label className="rbar-snap-item">
          <input type="checkbox" checked={snapOrtho} onChange={() => toggleSnap('ortho')} />
          <span className="rbar-snap-icon">✓ ↳</span>
          <span>직교</span>
        </label>
      </div>
    </div>
  )
}

/* ── 선택 속성 패널 (기존 유지) ── */
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

/* ── 정렬 패널 ── */
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

/* ── 이미지 → 벽 자동 인식 ── */
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
    setMsg('OpenCV 로딩 및 분석 중…')
    try {
      const { lines, width, height } = await detectWalls(src)
      if (lines.length === 0) { setMsg('선분을 찾지 못했습니다.'); return }
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

/* ── 벽 기본 두께 ── */
function WallDefaultSection({ scale }: { scale: ScaleConfig }) {
  const editor = useEditor()
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

      // 기존 벽들도 두께 업데이트
      if (editor) {
        const thickPx = mm * scale.pxPerMm
        const walls = editor.getCurrentPageShapes().filter(s => s.type === 'wall')
        walls.forEach(w => {
          editor.updateShape({
            id: w.id,
            type: 'wall' as never,
            props: { thickness: thickPx },
          })
        })
      }
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

/* ── 벽 높이 (3D) ── */
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

/* ── 회전 입력 ── */
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

/* ── 숫자 입력 필드 ── */
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
