/**
 * Automatic wall extraction from a raster floor-plan image using OpenCV.js.
 * OpenCV (~9 MB WASM) is loaded lazily the first time this runs.
 */

type Line = { x1: number; y1: number; x2: number; y2: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cvPromise: Promise<any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadCv(): Promise<any> {
  if (cvPromise) return cvPromise
  cvPromise = import('@techstark/opencv-js').then(async (mod) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cvModule: any = mod.default ?? mod
    if (cvModule instanceof Promise) return cvModule
    if (cvModule.Mat) return cvModule
    await new Promise<void>((resolve) => { cvModule.onRuntimeInitialized = () => resolve() })
    return cvModule
  })
  return cvPromise
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** Merge fragmented near-collinear segments into single lines. */
function mergeLines(lines: Line[]): Line[] {
  type Bucket = { lines: Line[] }
  const buckets = new Map<string, Bucket>()
  for (const ln of lines) {
    const dx = ln.x2 - ln.x1, dy = ln.y2 - ln.y1
    const len = Math.hypot(dx, dy)
    if (len < 1) continue
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI
    if (ang < 0) ang += 180
    if (ang >= 180) ang -= 180
    // perpendicular distance from origin to the line
    const nx = -dy / len, ny = dx / len
    const perp = nx * ln.x1 + ny * ln.y1
    const key = `${Math.round(ang / 6)}|${Math.round(perp / 14)}`
    let b = buckets.get(key)
    if (!b) { b = { lines: [] }; buckets.set(key, b) }
    b.lines.push(ln)
  }

  const out: Line[] = []
  for (const b of buckets.values()) {
    // direction from the first line in the bucket
    const first = b.lines[0]
    const dx = first.x2 - first.x1, dy = first.y2 - first.y1
    const len = Math.hypot(dx, dy)
    const ux = dx / len, uy = dy / len
    let lo = Infinity, hi = -Infinity
    let ax = 0, ay = 0, n = 0
    for (const ln of b.lines) {
      for (const [px, py] of [[ln.x1, ln.y1], [ln.x2, ln.y2]] as const) {
        const t = (px - first.x1) * ux + (py - first.y1) * uy
        lo = Math.min(lo, t); hi = Math.max(hi, t)
        ax += px; ay += py; n++
      }
    }
    // anchor on the bucket centroid projected onto the line
    const cxp = ax / n, cyp = ay / n
    const tc = (cxp - first.x1) * ux + (cyp - first.y1) * uy
    const baseX = first.x1 + (tc) * ux - 0   // not used directly
    void baseX
    const sx = first.x1 + lo * ux, sy = first.y1 + lo * uy
    const ex = first.x1 + hi * ux, ey = first.y1 + hi * uy
    if (Math.hypot(ex - sx, ey - sy) >= 8) out.push({ x1: sx, y1: sy, x2: ex, y2: ey })
  }
  return out
}

export type DetectOptions = {
  cannyLow?: number
  cannyHigh?: number
  houghThreshold?: number
  minLineLength?: number
  maxLineGap?: number
  /** 거의 수평/수직(±deg)인 선을 정확히 0°/90°로 보정. 0이면 비활성. */
  snapAngleDeg?: number
  /** 최소 선 길이 (px). 이보다 짧은 선 제외. */
  minLineLenPx?: number
}

export type DetectedOpening = {
  /** 벽 라인의 인덱스 */
  wallIndex: number
  /** 갭 시작/끝 t (0~1 따라 wall 방향) */
  startT: number
  endT: number
  /** 추정 폭 (px) */
  widthPx: number
}

/** 벽 라인을 검사해서 도면 안 갭(문/창)을 추정.
 *  벽 사이 좁은 끊김(gap) → opening.
 *  실제로는 이미지 분석이 더 정확하지만, 일단 벽 끊김 기반으로 휴리스틱. */
export function detectOpenings(_lines: Line[]): DetectedOpening[] {
  // 시작 단계 placeholder — 추후 OpenCV로 벽 사이 빈 픽셀 검사 등으로 개선
  return []
}

/**
 * Detect wall-like line segments in the image. Returns segments in the image's
 * own pixel coordinate space (origin top-left), plus the natural pixel size.
 */
export async function detectWalls(
  dataUrl: string,
  opts: DetectOptions = {},
): Promise<{ lines: Line[]; width: number; height: number }> {
  const cv = await loadCv()
  const img = await loadImage(dataUrl)
  const w = img.naturalWidth, h = img.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.drawImage(img, 0, 0)

  const src = cv.imread(canvas)
  const gray = new cv.Mat()
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)
  const edges = new cv.Mat()
  cv.Canny(gray, edges, opts.cannyLow ?? 50, opts.cannyHigh ?? 150, 3, false)
  const linesMat = new cv.Mat()
  const minLen = opts.minLineLength ?? Math.max(30, Math.min(w, h) * 0.05)
  cv.HoughLinesP(
    edges, linesMat, 1, Math.PI / 180,
    opts.houghThreshold ?? 80, minLen, opts.maxLineGap ?? 12,
  )

  const raw: Line[] = []
  for (let i = 0; i < linesMat.rows; i++) {
    const o = i * 4
    raw.push({
      x1: linesMat.data32S[o], y1: linesMat.data32S[o + 1],
      x2: linesMat.data32S[o + 2], y2: linesMat.data32S[o + 3],
    })
  }
  src.delete(); gray.delete(); edges.delete(); linesMat.delete()

  let merged = mergeLines(raw)

  // 후처리: 직각 정렬
  const snapDeg = opts.snapAngleDeg ?? 5
  if (snapDeg > 0) {
    merged = merged.map(ln => {
      const dx = ln.x2 - ln.x1, dy = ln.y2 - ln.y1
      const angDeg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 180
      const horiz = Math.min(angDeg, 180 - angDeg)
      const vert = Math.abs(angDeg - 90)
      if (horiz <= snapDeg) {
        const cy = (ln.y1 + ln.y2) / 2
        return { x1: ln.x1, y1: cy, x2: ln.x2, y2: cy }
      }
      if (vert <= snapDeg) {
        const cx = (ln.x1 + ln.x2) / 2
        return { x1: cx, y1: ln.y1, x2: cx, y2: ln.y2 }
      }
      return ln
    })
  }

  // 짧은 선 필터
  const minLenPx = opts.minLineLenPx ?? 0
  if (minLenPx > 0) {
    merged = merged.filter(ln => Math.hypot(ln.x2 - ln.x1, ln.y2 - ln.y1) >= minLenPx)
  }

  return { lines: merged, width: w, height: h }
}
