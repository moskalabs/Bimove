// 단가 DB — 자재별 견적 계산 기반. localStorage에 저장.
// 사용자가 편집 가능. 기본값은 한국 일반 시세 어림.

export type PriceConfig = {
  // 길이 단가 (₩/m)
  wallPerM: number          // 벽체 시공
  // 개당 단가 (₩/개)
  doorPerEa: number         // 문 (자재+시공)
  windowPerEa: number       // 창문
  // 면적 단가 (₩/m²)
  floorPerM2: number        // 바닥 마감
  ceilingPerM2: number      // 천장 마감
  // 블록 (가구/집기) — blockId별
  blocks: Record<string, number>
}

const DEFAULTS: PriceConfig = {
  wallPerM: 50000,
  doorPerEa: 300000,
  windowPerEa: 200000,
  floorPerM2: 80000,
  ceilingPerM2: 60000,
  blocks: {
    // 일부 기본 — 사용자가 패널에서 추가/편집
    desk: 200000,
    chair: 100000,
    bed: 500000,
  },
}

import { scopedGet, scopedSet, scopedRemove } from './scopedStorage'

const KEY = 'bimova_price_config_v1'

export function loadPriceConfig(): PriceConfig {
  try {
    const raw = scopedGet(KEY)
    if (!raw) return { ...DEFAULTS, blocks: { ...DEFAULTS.blocks } }
    const parsed = JSON.parse(raw) as Partial<PriceConfig>
    return {
      wallPerM: parsed.wallPerM ?? DEFAULTS.wallPerM,
      doorPerEa: parsed.doorPerEa ?? DEFAULTS.doorPerEa,
      windowPerEa: parsed.windowPerEa ?? DEFAULTS.windowPerEa,
      floorPerM2: parsed.floorPerM2 ?? DEFAULTS.floorPerM2,
      ceilingPerM2: parsed.ceilingPerM2 ?? DEFAULTS.ceilingPerM2,
      blocks: { ...DEFAULTS.blocks, ...(parsed.blocks ?? {}) },
    }
  } catch {
    return { ...DEFAULTS, blocks: { ...DEFAULTS.blocks } }
  }
}

export function savePriceConfig(config: PriceConfig) {
  try { scopedSet(KEY, JSON.stringify(config)) } catch { /* full */ }
}

export function resetPriceConfig(): PriceConfig {
  scopedRemove(KEY)
  return { ...DEFAULTS, blocks: { ...DEFAULTS.blocks } }
}

/** 견적 라인 — BOQ 한 항목의 비용 */
export type CostLine = {
  category: string
  name: string
  qty: number
  unit: string
  unitPrice: number
  amount: number
}

/** BOQ 데이터 + 단가 → 견적 라인들 + 합계.
 *  wallsByMaterial: 자재별 벽 길이 (mm). 있으면 자재 단가 사용, 없으면 기본 wallPerM.
 */
export function computeQuote(
  boq: {
    wallTotalLenMm: number
    doorCount: number
    windowCount: number
    rooms: { area: number; unit: string }[]
    blockCounts: { name: string; count: number; blockId?: string }[]
    wallsByMaterial?: { materialId: string; materialLabel: string; lenMm: number; pricePerM?: number }[]
  },
  config: PriceConfig,
): { lines: CostLine[]; total: number } {
  const lines: CostLine[] = []
  // 벽 — 자재별 분리 가능
  if (boq.wallsByMaterial && boq.wallsByMaterial.length > 0) {
    for (const w of boq.wallsByMaterial) {
      const lenM = w.lenMm / 1000
      const unitPrice = w.pricePerM ?? config.wallPerM
      lines.push({ category: '구조체', name: `벽체 (${w.materialLabel})`, qty: lenM, unit: 'm', unitPrice, amount: lenM * unitPrice })
    }
  } else {
    const wallM = boq.wallTotalLenMm / 1000
    if (wallM > 0) {
      lines.push({ category: '구조체', name: '벽체', qty: wallM, unit: 'm', unitPrice: config.wallPerM, amount: wallM * config.wallPerM })
    }
  }
  if (boq.doorCount > 0) {
    lines.push({ category: '구조체', name: '문', qty: boq.doorCount, unit: '개', unitPrice: config.doorPerEa, amount: boq.doorCount * config.doorPerEa })
  }
  if (boq.windowCount > 0) {
    lines.push({ category: '구조체', name: '창문', qty: boq.windowCount, unit: '개', unitPrice: config.windowPerEa, amount: boq.windowCount * config.windowPerEa })
  }
  const totalAreaM2 = boq.rooms.reduce((a, r) => a + r.area, 0)
  if (totalAreaM2 > 0) {
    lines.push({ category: '마감', name: '바닥 마감', qty: totalAreaM2, unit: 'm²', unitPrice: config.floorPerM2, amount: totalAreaM2 * config.floorPerM2 })
    lines.push({ category: '마감', name: '천장 마감', qty: totalAreaM2, unit: 'm²', unitPrice: config.ceilingPerM2, amount: totalAreaM2 * config.ceilingPerM2 })
  }
  for (const b of boq.blockCounts) {
    const key = b.blockId ?? b.name
    const price = config.blocks[key] ?? 0
    lines.push({ category: '가구·집기', name: b.name, qty: b.count, unit: '개', unitPrice: price, amount: b.count * price })
  }
  const total = lines.reduce((a, l) => a + l.amount, 0)
  return { lines, total }
}

// fmtKRW는 purchaseOrder.ts로 통합됨 — 기존 import 호환용 re-export
export { fmtKRW } from './purchaseOrder'
