// 재질 프리셋 — 색상 + SVG 패턴 + 단가. PropertiesPanel/MaterialsPanel/Library 공유.

export type PatternId = 'none' | 'concrete' | 'brick' | 'wood' | 'glass' | 'tile'

export type MaterialPreset = {
  id: string                  // 고유 키 (단가 매핑용)
  label: string
  fill: string                // 기본 색
  stroke: string
  pattern?: PatternId         // 'none' 또는 패턴
  /** 벽 (₩/m) — 없으면 PriceConfig.wallPerM 사용 */
  pricePerM?: number
  /** 마감 (₩/m²) — 바닥/천장 적용용 */
  pricePerM2?: number
}

export const DEFAULT_MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'default', label: '기본', fill: '#555', stroke: '#222', pattern: 'none' },
  { id: 'concrete', label: '콘크리트', fill: '#8a8a8a', stroke: '#555', pattern: 'concrete', pricePerM: 60000, pricePerM2: 50000 },
  { id: 'brick', label: '벽돌', fill: '#b5651d', stroke: '#7a3e0a', pattern: 'brick', pricePerM: 80000 },
  { id: 'wood', label: '나무', fill: '#c8a96e', stroke: '#8b6327', pattern: 'wood', pricePerM: 70000, pricePerM2: 95000 },
  { id: 'glass', label: '유리', fill: '#a8d8ea', stroke: '#4fa3c8', pattern: 'glass', pricePerM: 120000 },
  { id: 'whitewall', label: '흰 벽', fill: '#f0f0f0', stroke: '#999', pattern: 'none', pricePerM: 45000 },
  { id: 'tile_floor', label: '타일 (바닥)', fill: '#d8d3cf', stroke: '#9a948e', pattern: 'tile', pricePerM2: 110000 },
]

import { scopedGet, scopedSet, scopedRemove } from './scopedStorage'

const KEY = 'bimova_materials_v2'

export function loadMaterialPresets(): MaterialPreset[] {
  try {
    const raw = scopedGet(KEY)
    if (!raw) return DEFAULT_MATERIAL_PRESETS
    const arr = JSON.parse(raw) as MaterialPreset[]
    if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_MATERIAL_PRESETS
    // 마이그레이션: id 없으면 label로 채움
    return arr.map(m => ({ ...m, id: m.id ?? slug(m.label) }))
  } catch {
    return DEFAULT_MATERIAL_PRESETS
  }
}

export function saveMaterialPresets(list: MaterialPreset[]) {
  try { scopedSet(KEY, JSON.stringify(list)) } catch { /* full */ }
}

export function resetMaterialPresets(): MaterialPreset[] {
  scopedRemove(KEY)
  return DEFAULT_MATERIAL_PRESETS
}

export function findMaterialById(id: string | undefined): MaterialPreset | undefined {
  if (!id) return undefined
  return loadMaterialPresets().find(m => m.id === id)
}

export function findMaterialByFill(fill: string | undefined): MaterialPreset | undefined {
  if (!fill) return undefined
  return loadMaterialPresets().find(m => m.fill.toLowerCase() === fill.toLowerCase())
}

function slug(s: string): string {
  return s.replace(/\s+/g, '_').toLowerCase().slice(0, 40)
}

// ─── SVG 패턴 정의 (재사용) ─────────────────────────────────────────────

export function getPatternSvgDef(p: PatternId, color: string): string {
  switch (p) {
    case 'concrete':
      // 도트
      return `<pattern id="pat-${p}" patternUnits="userSpaceOnUse" width="10" height="10">
        <circle cx="2" cy="2" r="0.8" fill="${color}" opacity="0.45"/>
        <circle cx="7" cy="6" r="0.6" fill="${color}" opacity="0.30"/>
      </pattern>`
    case 'brick':
      // 십자 해치 (벽돌 줄)
      return `<pattern id="pat-${p}" patternUnits="userSpaceOnUse" width="14" height="8">
        <line x1="0" y1="0" x2="14" y2="0" stroke="${color}" stroke-width="0.5" opacity="0.55"/>
        <line x1="7" y1="0" x2="7" y2="4" stroke="${color}" stroke-width="0.5" opacity="0.55"/>
        <line x1="0" y1="4" x2="14" y2="4" stroke="${color}" stroke-width="0.5" opacity="0.55"/>
        <line x1="0" y1="4" x2="0" y2="8" stroke="${color}" stroke-width="0.5" opacity="0.55"/>
        <line x1="14" y1="4" x2="14" y2="8" stroke="${color}" stroke-width="0.5" opacity="0.55"/>
      </pattern>`
    case 'wood':
      // 결선
      return `<pattern id="pat-${p}" patternUnits="userSpaceOnUse" width="6" height="20">
        <path d="M0 0 Q3 5 0 10 Q-3 15 0 20" fill="none" stroke="${color}" stroke-width="0.4" opacity="0.5"/>
      </pattern>`
    case 'glass':
      // 사선 hatch
      return `<pattern id="pat-${p}" patternUnits="userSpaceOnUse" width="6" height="6">
        <line x1="0" y1="6" x2="6" y2="0" stroke="${color}" stroke-width="0.4" opacity="0.5"/>
      </pattern>`
    case 'tile':
      // 격자
      return `<pattern id="pat-${p}" patternUnits="userSpaceOnUse" width="10" height="10">
        <rect x="0" y="0" width="10" height="10" fill="none" stroke="${color}" stroke-width="0.4" opacity="0.5"/>
      </pattern>`
    default:
      return ''
  }
}
