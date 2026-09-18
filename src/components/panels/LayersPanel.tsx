import { useState, useEffect } from 'react'
import { useEditor } from '../../context/EditorContext'
import { getGrayscaleMode, setGrayscaleMode } from '../../lib/settings'

type LayerDef = {
  type: string
  label: string
  color: string
}

const LAYER_DEFS: LayerDef[] = [
  { type: 'wall',   label: '벽',   color: '#555' },
  { type: 'door',   label: '문',   color: '#1a73e8' },
  { type: 'window', label: '창문', color: '#0097a7' },
  { type: 'block',  label: '블록', color: '#7b1fa2' },
  { type: 'text',   label: '텍스트', color: '#e65100' },
  { type: 'image',  label: '이미지', color: '#388e3c' },
]

const DXF_LAYER_COLORS: Record<string, string> = {
  '0': '#888',
  'WALL': '#555',
  'DOOR': '#1a73e8',
  'WINDOW': '#0097a7',
  'TEXT': '#e65100',
  'DIMENSION': '#9c27b0',
}

function dxfLayerColor(name: string): string {
  const upper = name.toUpperCase()
  for (const [key, color] of Object.entries(DXF_LAYER_COLORS)) {
    if (upper.includes(key)) return color
  }
  // 해시 기반 색상
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const hue = ((hash % 360) + 360) % 360
  return `hsl(${hue}, 55%, 45%)`
}

// 투명도 3단계: 100% → 30% → 0%
type OpacityLevel = 1 | 0.3 | 0
const OPACITY_CYCLE: OpacityLevel[] = [1, 0.3, 0]
const OPACITY_ICON: Record<OpacityLevel, string> = { 1: '👁', 0.3: '🔅', 0: '🙈' }

export function LayersPanel() {
  const editor = useEditor()
  // 단일 state 객체로 통합 (8개 setState → 1개, re-render 1회)
  type LayerData = {
    counts: Record<string, number>
    phaseCounts: Record<string, number>
    materialCounts: Record<string, number>
    dxfLayerCounts: Record<string, number>
    dxfLayerLw: Record<string, number>
  }
  const [data, setData] = useState<LayerData>({
    counts: {}, phaseCounts: {}, materialCounts: {}, dxfLayerCounts: {}, dxfLayerLw: {},
  })
  const [_hidden, setHidden] = useState<Set<string>>(new Set())
  const [opacityMap, setOpacityMap] = useState<Record<string, OpacityLevel>>({})
  const [isGrayscale, setIsGrayscale] = useState(getGrayscaleMode)

  // destructure for easy access
  const { counts, dxfLayerCounts, dxfLayerLw } = data

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const c: Record<string, number> = {}
      const pc: Record<string, number> = {}
      const mc: Record<string, number> = {}
      const dc: Record<string, number> = {}
      const dlw: Record<string, number> = {}
      const initOpacity: Record<string, OpacityLevel> = {}
      for (const s of editor.getCurrentPageShapes()) {
        c[s.type] = (c[s.type] ?? 0) + 1
        const meta = s.meta as { phase?: string; materialId?: string; dxfLayer?: string; dxfLineweight?: number }
        if (meta.phase) pc[meta.phase] = (pc[meta.phase] ?? 0) + 1
        if (meta.materialId) mc[meta.materialId] = (mc[meta.materialId] ?? 0) + 1
        if (meta.dxfLayer) {
          dc[meta.dxfLayer] = (dc[meta.dxfLayer] ?? 0) + 1
          if (meta.dxfLineweight && meta.dxfLineweight > 0) dlw[meta.dxfLayer] = meta.dxfLineweight
        }
        // shape opacity에서 투명도 상태 복원 (BUG 10: 패널 리마운트 시 동기화)
        const op = s.opacity as number
        if (op < 1) {
          const level: OpacityLevel = op <= 0 ? 0 : 0.3
          if (!initOpacity[s.type]) initOpacity[s.type] = level
          if (meta.dxfLayer) {
            const dk = 'dxf:' + meta.dxfLayer
            if (!initOpacity[dk]) initOpacity[dk] = level
          }
        }
      }
      // 단일 setState로 re-render 1회만 트리거
      setData({ counts: c, phaseCounts: pc, materialCounts: mc, dxfLayerCounts: dc, dxfLayerLw: dlw })
      setOpacityMap(prev => Object.keys(prev).length === 0 ? initOpacity : prev)
      const h = new Set<string>()
      for (const [k, v] of Object.entries(initOpacity)) { if (v === 0) h.add(k) }
      setHidden(prev => prev.size === 0 && h.size > 0 ? h : prev)
    }
    update()
    let timer = 0
    const unsub = editor.store.listen(() => {
      clearTimeout(timer)
      timer = window.setTimeout(update, 200)
    })
    return () => { unsub(); clearTimeout(timer) }
  }, [editor])

  const hasDxfLayers = Object.keys(dxfLayerCounts).length > 0

  // ---- 공통 visibility helper (3단계 순환: 100% → 30% → 0%) ----
  const cycleOpacity = (key: string, filter: (s: { type: string; meta: unknown }) => boolean) => {
    if (!editor) return
    const shapes = editor.getCurrentPageShapes().filter(filter)
    const cur = opacityMap[key] ?? 1
    const idx = OPACITY_CYCLE.indexOf(cur)
    const next = OPACITY_CYCLE[(idx + 1) % OPACITY_CYCLE.length]
    for (const s of shapes) editor.updateShape({ id: s.id, type: s.type as never, opacity: next })
    setOpacityMap(prev => ({ ...prev, [key]: next }))
    if (next === 0) setHidden(prev => new Set([...prev, key]))
    else setHidden(prev => { const n = new Set(prev); n.delete(key); return n })
  }

  const selectFilter = (filter: (s: { type: string; meta: unknown }) => boolean) => {
    if (!editor) return
    const ids = editor.getCurrentPageShapes().filter(filter).map(s => s.id)
    if (ids.length) editor.setSelectedShapes(ids)
  }

  // ---- 데이터 ----
  const typeLayers = LAYER_DEFS.filter(l => (counts[l.type] ?? 0) > 0)
  const dxfLayers = Object.entries(dxfLayerCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      key: 'dxf:' + name, label: name, color: dxfLayerColor(name), count, layerName: name,
    }))

  // 모든 레이어를 하나의 플랫 리스트로 통합
  const allLayers: { key: string; label: string; color: string; count: number; opacity: OpacityLevel; lineweight?: number; onSelect: () => void; onToggle: () => void }[] = []

  // 도면층 (타입별)
  for (const l of typeLayers) {
    allLayers.push({
      key: l.type, label: l.label, color: l.color, count: counts[l.type],
      opacity: opacityMap[l.type] ?? 1,
      onSelect: () => selectFilter(s => s.type === l.type),
      onToggle: () => cycleOpacity(l.type, s => s.type === l.type),
    })
  }

  // DXF 레이어
  for (const l of dxfLayers) {
    allLayers.push({
      key: l.key, label: l.label, color: l.color, count: l.count,
      opacity: opacityMap[l.key] ?? 1,
      lineweight: dxfLayerLw[l.layerName],
      onSelect: () => selectFilter(s => (s.meta as { dxfLayer?: string })?.dxfLayer === l.layerName),
      onToggle: () => cycleOpacity(l.key, s => (s.meta as { dxfLayer?: string })?.dxfLayer === l.layerName),
    })
  }

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">레이어</div>

      {hasDxfLayers && (
        <div className="dxf-grayscale-bar">
          <button
            className={`dxf-grayscale-btn${isGrayscale ? ' on' : ''}`}
            onClick={() => { const v = !isGrayscale; setGrayscaleMode(v); setIsGrayscale(v) }}
          >
            {isGrayscale ? '⬛ Grayscale ON' : '🎨 Grayscale OFF'}
          </button>
        </div>
      )}

      <div className="lbar-panel-body">
        {allLayers.length === 0 ? (
          <Empty msg="도면을 그리면 레이어가 표시됩니다." />
        ) : (
          allLayers.map(l => (
            <LayerRow
              key={l.key} label={l.label} color={l.color} count={l.count}
              opacity={l.opacity} lineweight={l.lineweight}
              onSelect={l.onSelect} onToggle={l.onToggle}
            />
          ))
        )}
      </div>
    </div>
  )
}

function LayerRow({ label, color, count, opacity = 1, lineweight, onSelect, onToggle }: {
  label: string; color: string; count: number; opacity?: OpacityLevel
  lineweight?: number; onSelect: () => void; onToggle: () => void
}) {
  const dim = opacity < 1
  return (
    <div className="layer-row" onClick={onSelect}>
      <span className="layer-dot" style={{ background: color, opacity: dim ? 0.3 : 1 }} />
      <span className={`layer-label${dim ? ' dim' : ''}`}>{label}</span>
      {lineweight != null && lineweight > 0 && (
        <span className="layer-lw" title="선가중치">
          {(lineweight / 100).toFixed(2)}mm
        </span>
      )}
      <span className="layer-count">{count}</span>
      <button
        className="layer-vis-btn"
        onClick={e => { e.stopPropagation(); onToggle() }}
        title={`투명도: ${Math.round(opacity * 100)}%`}
      >
        {OPACITY_ICON[opacity]}
      </button>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="layer-empty">{msg}</div>
}
