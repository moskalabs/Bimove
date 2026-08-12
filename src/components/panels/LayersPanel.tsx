import { useState, useEffect } from 'react'
import { useEditor } from '../../context/EditorContext'
import { loadMaterialPresets } from '../../lib/materialPresets'
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

const PHASE_COLORS: Record<string, string> = {
  '구조': '#c0392b',
  '건축': '#2980b9',
  '마감': '#16a085',
  '설비': '#f39c12',
  '가구·집기': '#8e44ad',
}

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

type Tab = 'type' | 'phase' | 'material' | 'dxf'

// 투명도 3단계: 100% → 30% → 0%
type OpacityLevel = 1 | 0.3 | 0
const OPACITY_CYCLE: OpacityLevel[] = [1, 0.3, 0]
const OPACITY_ICON: Record<OpacityLevel, string> = { 1: '👁', 0.3: '🔅', 0: '🙈' }

export function LayersPanel() {
  const editor = useEditor()
  const [tab, setTab] = useState<Tab>('type')
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
  const presets = loadMaterialPresets()

  // destructure for easy access
  const { counts, phaseCounts, materialCounts, dxfLayerCounts, dxfLayerLw } = data

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
  const phaseLayers = Object.entries(phaseCounts).map(([phase, count]) => ({
    key: 'phase:' + phase, label: phase, color: PHASE_COLORS[phase] ?? '#888', count,
  }))
  const materialLayers = Object.entries(materialCounts).map(([id, count]) => {
    const m = presets.find(p => p.id === id)
    return { key: 'mat:' + id, label: m?.label ?? id, color: m?.fill ?? '#888', count, materialId: id }
  })
  const dxfLayers = Object.entries(dxfLayerCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      key: 'dxf:' + name, label: name, color: dxfLayerColor(name), count, layerName: name,
    }))

  const tabs: { id: Tab; label: string }[] = [
    { id: 'type', label: '도면층' },
    ...(hasDxfLayers ? [{ id: 'dxf' as const, label: 'DXF' }] : []),
    { id: 'phase', label: '공종' },
    { id: 'material', label: '자재' },
  ]

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">도면층 / 시각화</div>

      <div className="layer-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`layer-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="lbar-panel-body">
        {tab === 'type' && (
          typeLayers.length === 0 ? (
            <Empty msg="도면을 그리면 표시됩니다." />
          ) : (
            typeLayers.map(l => (
              <LayerRow
                key={l.type} label={l.label} color={l.color} count={counts[l.type]}
                opacity={opacityMap[l.type] ?? 1}
                onSelect={() => selectFilter(s => s.type === l.type)}
                onToggle={() => cycleOpacity(l.type, s => s.type === l.type)}
              />
            ))
          )
        )}
        {tab === 'dxf' && (
          dxfLayers.length === 0 ? (
            <Empty msg="DXF 파일을 가져오면 레이어가 표시됩니다." />
          ) : (
            <>
              <div className="dxf-grayscale-bar">
                <button
                  className={`dxf-grayscale-btn${isGrayscale ? ' on' : ''}`}
                  onClick={() => { const v = !isGrayscale; setGrayscaleMode(v); setIsGrayscale(v) }}
                >
                  {isGrayscale ? '⬛ Grayscale ON' : '🎨 Grayscale OFF'}
                </button>
              </div>
              <div className="dxf-layer-count-label">
                DXF 원본 레이어 ({dxfLayers.length}개)
              </div>
              {dxfLayers.map(l => (
                <LayerRow
                  key={l.key} label={l.label} color={l.color} count={l.count}
                  opacity={opacityMap[l.key] ?? 1}
                  lineweight={dxfLayerLw[l.layerName]}
                  onSelect={() => selectFilter(s => (s.meta as { dxfLayer?: string })?.dxfLayer === l.layerName)}
                  onToggle={() => cycleOpacity(l.key, s => (s.meta as { dxfLayer?: string })?.dxfLayer === l.layerName)}
                />
              ))}
            </>
          )
        )}
        {tab === 'phase' && (
          phaseLayers.length === 0 ? (
            <Empty msg="공종 미지정 — 속성 패널에서 객체에 공종을 설정해보세요." />
          ) : (
            phaseLayers.map(l => (
              <LayerRow
                key={l.key} label={l.label} color={l.color} count={l.count}
                opacity={opacityMap[l.key] ?? 1}
                onSelect={() => selectFilter(s => (s.meta as { phase?: string })?.phase === l.label)}
                onToggle={() => cycleOpacity(l.key, s => (s.meta as { phase?: string })?.phase === l.label)}
              />
            ))
          )
        )}
        {tab === 'material' && (
          materialLayers.length === 0 ? (
            <Empty msg="자재 미지정 — 재질 패널에서 자재를 적용해보세요." />
          ) : (
            materialLayers.map(l => (
              <LayerRow
                key={l.key} label={l.label} color={l.color} count={l.count}
                opacity={opacityMap[l.key] ?? 1}
                onSelect={() => selectFilter(s => (s.meta as { materialId?: string })?.materialId === l.materialId)}
                onToggle={() => cycleOpacity(l.key, s => (s.meta as { materialId?: string })?.materialId === l.materialId)}
              />
            ))
          )
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
