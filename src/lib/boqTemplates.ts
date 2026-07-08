// 물량표 카테고리 템플릿 (벽지/타일/도장/마루/필름)
import type { BOQTemplateId, BOQItem } from './purchaseOrder'
import { uid } from './purchaseOrder'

export type BOQTemplate = {
  id: BOQTemplateId
  label: string
  icon: string
  description: string
  defaultItem: Omit<BOQItem, 'id'>
}

export const BOQ_TEMPLATES: BOQTemplate[] = [
  {
    id: 'wallpaper',
    label: '벽지',
    icon: '🧱',
    description: '벽면 벽지 시공 물량',
    defaultItem: {
      name: '벽지',
      material: '',
      widthMm: 0,
      heightMm: 2400,
      exclusions: [],
      itemWidthMm: 530,
      itemLengthMm: 15600,
      lossRate: 0.10,
      unitPrice: 35000,
      unit: '롤',
    },
  },
  {
    id: 'tile',
    label: '타일',
    icon: '🔲',
    description: '바닥/벽 타일 시공 물량',
    defaultItem: {
      name: '타일',
      material: '',
      widthMm: 0,
      heightMm: 0,
      exclusions: [],
      itemWidthMm: 600,
      itemLengthMm: 600,
      lossRate: 0.08,
      unitPrice: 0,
      unit: '장',
    },
  },
  {
    id: 'paint',
    label: '도장',
    icon: '🎨',
    description: '벽면/천장 도장 물량',
    defaultItem: {
      name: '도장',
      material: '',
      widthMm: 0,
      heightMm: 2400,
      exclusions: [],
      itemWidthMm: 0,
      itemLengthMm: 0,
      lossRate: 0.05,
      unitPrice: 0,
      unit: 'm²',
    },
  },
  {
    id: 'flooring',
    label: '마루',
    icon: '🪵',
    description: '바닥 마루 시공 물량',
    defaultItem: {
      name: '마루',
      material: '',
      widthMm: 0,
      heightMm: 0,
      exclusions: [],
      itemWidthMm: 1200,
      itemLengthMm: 190,
      lossRate: 0.08,
      unitPrice: 0,
      unit: '장',
    },
  },
  {
    id: 'film',
    label: '필름',
    icon: '📜',
    description: '시트/필름 시공 물량',
    defaultItem: {
      name: '필름',
      material: '',
      widthMm: 0,
      heightMm: 0,
      exclusions: [],
      itemWidthMm: 1220,
      itemLengthMm: 50000,
      lossRate: 0.05,
      unitPrice: 0,
      unit: '롤',
    },
  },
]

/** 템플릿에서 새 BOQItem 생성 */
export function createItemFromTemplate(template: BOQTemplate): BOQItem {
  return { ...template.defaultItem, id: uid() }
}

/** 템플릿 ID로 찾기 */
export function getTemplate(id: BOQTemplateId): BOQTemplate | undefined {
  return BOQ_TEMPLATES.find(t => t.id === id)
}
