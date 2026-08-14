// 면적 측정 순수 계산 함수
// AreaMeasureOverlay에서 사용하는 핵심 로직

export type Pt = { x: number; y: number }

/** Shoelace formula — 다각형 면적 (좌표 단위²) */
export function shoelaceArea(pts: Pt[]): number {
  const n = pts.length
  if (n < 3) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(sum) / 2
}

/** 다각형 둘레 (좌표 단위) */
export function polygonPerimeter(pts: Pt[]): number {
  const n = pts.length
  if (n < 2) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    sum += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y)
  }
  return sum
}

/** px² → m² 변환 */
export function pxAreaToM2(areaPx2: number, pxPerMm: number): number {
  const areaMm2 = areaPx2 / (pxPerMm * pxPerMm)
  return areaMm2 / 1_000_000
}

/** px 길이 → m 변환 */
export function pxLengthToM(lengthPx: number, pxPerMm: number): number {
  const lengthMm = lengthPx / pxPerMm
  return lengthMm / 1000
}

/** 폴리곤 점들로 면적(m²)과 둘레(m) 한번에 계산 */
export function measurePolygon(
  pts: Pt[],
  pxPerMm: number,
): { areaM2: number; perimeterM: number } {
  const areaPx2 = shoelaceArea(pts)
  const perimPx = polygonPerimeter(pts)
  return {
    areaM2: +(pxAreaToM2(areaPx2, pxPerMm).toFixed(2)),
    perimeterM: +(pxLengthToM(perimPx, pxPerMm).toFixed(2)),
  }
}
