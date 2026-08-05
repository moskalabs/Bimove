// 물량표 카테고리 템플릿 (천정/벽/바닥/몰딩)
import type { BOQTemplateId, BOQItem, CalcMethod } from './purchaseOrder'
import { uid } from './purchaseOrder'

export type BOQTemplate = {
  id: BOQTemplateId
  label: string
  icon: string
  description: string
  /** 기본 산출방식 */
  defaultCalcMethod: CalcMethod
  defaultItem: Omit<BOQItem, 'id'>
}

/** 카테고리 (상위 그룹) */
export type BOQCategory = {
  key: string
  label: string
  icon: string
  templates: BOQTemplate[]
}

// ── 천정 ──
const CEILING_TEMPLATES: BOQTemplate[] = [
  {
    id: 'ceil-gypsum', label: '석고보드', icon: '⬜', description: '천정 석고보드 시공',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '석고보드', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 900, itemLengthMm: 1800, lossRate: 0.05, unitPrice: 0, unit: '장',
    },
  },
  {
    id: 'ceil-paint', label: '도장', icon: '🎨', description: '천정 도장',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '천정 도장', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 0, itemLengthMm: 0, lossRate: 0.05, unitPrice: 0, unit: 'm²',
    },
  },
  {
    id: 'ceil-tex', label: '텍스', icon: '🔳', description: '천정 텍스(텍스타일)',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '텍스', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 600, itemLengthMm: 600, lossRate: 0.05, unitPrice: 0, unit: '장',
    },
  },
]

// ── 벽 ──
const WALL_TEMPLATES: BOQTemplate[] = [
  {
    id: 'wall-wallpaper', label: '도배', icon: '🧱', description: '벽면 도배 시공',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '도배', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 2400, exclusions: [],
      itemWidthMm: 530, itemLengthMm: 15600, lossRate: 0.10, unitPrice: 35000, unit: '롤',
    },
  },
  {
    id: 'wall-paint', label: '도장', icon: '🎨', description: '벽면 도장',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '벽 도장', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 2400, exclusions: [],
      itemWidthMm: 0, itemLengthMm: 0, lossRate: 0.05, unitPrice: 0, unit: 'm²',
    },
  },
  {
    id: 'wall-film', label: '필름', icon: '📜', description: '벽면 필름/시트',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '필름', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 2400, exclusions: [],
      itemWidthMm: 1220, itemLengthMm: 50000, lossRate: 0.05, unitPrice: 0, unit: '롤',
    },
  },
  {
    id: 'wall-tile', label: '타일', icon: '🔲', description: '벽면 타일',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '벽 타일', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 2400, exclusions: [],
      itemWidthMm: 300, itemLengthMm: 600, lossRate: 0.08, unitPrice: 0, unit: '장',
    },
  },
  {
    id: 'wall-louver', label: '루버', icon: '▤', description: '벽면 루버',
    defaultCalcMethod: 'length',
    defaultItem: {
      name: '루버', material: '', calcMethod: 'length',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 0, itemLengthMm: 0, lossRate: 0.05, unitPrice: 0, unit: 'm',
    },
  },
  {
    id: 'wall-panel', label: '판넬', icon: '▦', description: '벽면 판넬',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '판넬', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 2400, exclusions: [],
      itemWidthMm: 1200, itemLengthMm: 2400, lossRate: 0.05, unitPrice: 0, unit: '장',
    },
  },
]

// ── 바닥 ──
const FLOOR_TEMPLATES: BOQTemplate[] = [
  {
    id: 'floor-wood', label: '마루', icon: '🪵', description: '바닥 마루',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '마루', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 1200, itemLengthMm: 190, lossRate: 0.08, unitPrice: 0, unit: '장',
    },
  },
  {
    id: 'floor-tile', label: '타일', icon: '🔲', description: '바닥 타일',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '바닥 타일', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 600, itemLengthMm: 600, lossRate: 0.08, unitPrice: 0, unit: '장',
    },
  },
  {
    id: 'floor-deco', label: '데코타일', icon: '🔳', description: '바닥 데코타일',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '데코타일', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 457, itemLengthMm: 457, lossRate: 0.05, unitPrice: 0, unit: '장',
    },
  },
  {
    id: 'floor-vinyl', label: '장판', icon: '📋', description: '바닥 장판(비닐)',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '장판', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 1830, itemLengthMm: 30000, lossRate: 0.05, unitPrice: 0, unit: '롤',
    },
  },
  {
    id: 'floor-paint', label: '도장', icon: '🎨', description: '바닥 도장(에폭시 등)',
    defaultCalcMethod: 'area',
    defaultItem: {
      name: '바닥 도장', material: '', calcMethod: 'area',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 0, itemLengthMm: 0, lossRate: 0.05, unitPrice: 0, unit: 'm²',
    },
  },
]

// ── 몰딩 ──
const MOLDING_TEMPLATES: BOQTemplate[] = [
  {
    id: 'mold-ceiling', label: '천정몰딩', icon: '📏', description: '천정 몰딩/코너',
    defaultCalcMethod: 'length',
    defaultItem: {
      name: '천정몰딩', material: '', calcMethod: 'length',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 0, itemLengthMm: 0, lossRate: 0.05, unitPrice: 0, unit: 'm',
    },
  },
  {
    id: 'mold-baseboard', label: '걸레받이', icon: '📏', description: '걸레받이/바닥 몰딩',
    defaultCalcMethod: 'length',
    defaultItem: {
      name: '걸레받이', material: '', calcMethod: 'length',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 0, itemLengthMm: 0, lossRate: 0.05, unitPrice: 0, unit: 'm',
    },
  },
  {
    id: 'mold-finish', label: '마감몰딩', icon: '📏', description: '마감/코너 몰딩',
    defaultCalcMethod: 'length',
    defaultItem: {
      name: '마감몰딩', material: '', calcMethod: 'length',
      widthMm: 0, heightMm: 0, exclusions: [],
      itemWidthMm: 0, itemLengthMm: 0, lossRate: 0.05, unitPrice: 0, unit: 'm',
    },
  },
]

// ── 카테고리 그룹 ──
export const BOQ_CATEGORIES: BOQCategory[] = [
  { key: 'ceiling', label: '천정', icon: '⬆', templates: CEILING_TEMPLATES },
  { key: 'wall', label: '벽', icon: '🧱', templates: WALL_TEMPLATES },
  { key: 'floor', label: '바닥', icon: '⬇', templates: FLOOR_TEMPLATES },
  { key: 'molding', label: '몰딩', icon: '📏', templates: MOLDING_TEMPLATES },
]

/** 전체 템플릿 리스트 (flat) - 하위 호환 */
export const BOQ_TEMPLATES: BOQTemplate[] = BOQ_CATEGORIES.flatMap(c => c.templates)

// ── 레거시 ID 매핑 (기존 5개 → 새 ID 호환) ──
const LEGACY_MAP: Record<string, BOQTemplateId> = {
  wallpaper: 'wall-wallpaper',
  tile: 'floor-tile',
  paint: 'wall-paint',
  flooring: 'floor-wood',
  film: 'wall-film',
}

/** 템플릿에서 새 BOQItem 생성 */
export function createItemFromTemplate(template: BOQTemplate): BOQItem {
  return { ...template.defaultItem, id: uid() }
}

/** 템플릿 ID로 찾기 (레거시 ID 호환) */
export function getTemplate(id: BOQTemplateId): BOQTemplate | undefined {
  return BOQ_TEMPLATES.find(t => t.id === id)
    ?? BOQ_TEMPLATES.find(t => t.id === LEGACY_MAP[id])
}
