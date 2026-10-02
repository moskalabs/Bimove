/**
 * 텍스트 크기 위계 회귀 테스트
 *
 * 대형 도면은 캔버스 span 을 12000px 로 맞추려고 autoScale 로 줄인다
 * (실제 파일에서 autoScale = 0.0123). 그런데 텍스트 높이에 **절대값 4px**
 * 하한이 걸려 있어서, 스케일된 높이가 4px 미만인 글자가 전부 정확히 4px 로
 * 뭉개졌다 — 한 파일에서 448개 중 430개. 도면 제목, 실명, 치수, 주기가
 * 모두 같은 크기가 되어 위계가 통째로 사라졌다.
 *
 * 하한을 캔버스 span 에 비례시켜(12000px 기준 1px) 원래 크기 차이가
 * 하한 아래로 깔리지 않게 했다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commitCadImportV2, computeMinTextHeight } from '../../lib/dxf'
import type { PolylineData, TextData } from '../../lib/dxf-fast-worker'

describe('computeMinTextHeight', () => {
  it('span 12000px(자동 축소 상한)이면 1px', () => {
    expect(computeMinTextHeight(12000)).toBeCloseTo(1, 6)
  })

  it('작은 도면은 하한도 작다', () => {
    expect(computeMinTextHeight(6000)).toBeCloseTo(0.5, 6)
    expect(computeMinTextHeight(1200)).toBeCloseTo(0.1, 6)
  })

  it('0.1px 절대 하한을 지킨다 (toFixed(1) 에서 0 으로 반올림되면 글자가 사라진다)', () => {
    expect(computeMinTextHeight(10)).toBe(0.1)
    expect(computeMinTextHeight(0)).toBeGreaterThanOrEqual(0.1)
  })

  it('span 이 비정상이면 최대 span 으로 간주한다', () => {
    expect(computeMinTextHeight(NaN)).toBeCloseTo(1, 6)
    expect(computeMinTextHeight(-5)).toBeCloseTo(1, 6)
    expect(computeMinTextHeight(Infinity)).toBeCloseTo(1, 6)
  })

  it('예전 절대값 4px 보다 느슨하다 (이게 버그였다)', () => {
    expect(computeMinTextHeight(12000)).toBeLessThan(4)
  })
})

// ── 실제 파이프라인에서 위계가 살아 있는지 ──

let workerResult: {
  polylines: PolylineData[]; insUnits: number
  texts: TextData[]; hatches: never[]; linetypes: never[]; ltscale: number
}

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  postMessage() {
    setTimeout(() => this.onmessage?.({ data: { type: 'result', ...workerResult } }), 0)
  }
  terminate() { /* noop */ }
}

function createMockEditor() {
  const created: unknown[] = []
  return {
    getInstanceState: () => ({ meta: { unit: 'mm', pxPerMm: 1 } }),
    getViewportScreenBounds: () => ({ width: 1200, height: 800 }),
    createShapes: (shapes: unknown[]) => { created.push(...shapes) },
    getCurrentPageShapes: () => created,
    getCamera: () => ({ x: 0, y: 0, z: 1 }),
    setCamera: vi.fn(), selectAll: vi.fn(), selectNone: vi.fn(),
    getSelectedShapeIds: () => [], zoomToFit: vi.fn(),
    zoomToSelection: vi.fn(), select: vi.fn(),
    _created: () => created,
  }
}

/** 976,000 x 500,000 단위 직사각형 → autoScale ≈ 0.0123 (실제 파일과 같은 규모) */
const HUGE_RECT: PolylineData[] = [{
  vertices: [[0, 0], [976000, 0], [976000, 500000], [0, 500000], [0, 0]],
  layer: '0', colorNumber: 7,
}]

const text = (t: string, height: number): TextData => ({
  // 도면 안쪽에 몰아둔다 (bbox 필터에 걸리지 않게)
  x: 400000, y: 250000, text: t, height, layer: 'TEXT', colorNumber: 7,
})

type ShapeLike = { type: string; props: { textsJson: string } }

function heightsByText(shapes: unknown[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of shapes as ShapeLike[]) {
    if (s.type !== 'dxfgroup' || !s.props.textsJson) continue
    for (const e of JSON.parse(s.props.textsJson) as Array<{ t: string; h: number }>) {
      out.set(e.t, e.h)
    }
  }
  return out
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  workerResult = {
    polylines: HUGE_RECT, insUnits: 4,
    texts: [], hatches: [], linetypes: [], ltscale: 1,
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('대형 도면 텍스트 크기', () => {
  it('크기가 다른 글자들이 같은 높이로 뭉개지지 않는다', async () => {
    // 실제 도면의 전형적인 구성: 치수 < 본문 < 실명 < 도면 제목
    workerResult.texts = [
      text('치수', 125),
      text('본문', 250),
      text('실명', 375),
      text('제목', 500),
    ]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['0', 'TEXT']), 'big.dxf', 1000, false)

    const h = heightsByText(editor._created())
    expect(h.size).toBe(4)
    // 예전엔 125/250/375 가 전부 4px 로 뭉개져 서로 같아졌다
    expect(new Set(h.values()).size).toBe(4)
    expect(h.get('치수')!).toBeLessThan(h.get('본문')!)
    expect(h.get('본문')!).toBeLessThan(h.get('실명')!)
    expect(h.get('실명')!).toBeLessThan(h.get('제목')!)
  })

  it('원래 높이 비율을 대체로 유지한다', async () => {
    workerResult.texts = [text('작게', 200), text('두배', 400)]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['0', 'TEXT']), 'big.dxf', 1000, false)

    const h = heightsByText(editor._created())
    expect(h.get('두배')! / h.get('작게')!).toBeCloseTo(2, 1)
  })

  it('하한보다 작은 글자도 0 이 되지 않는다', async () => {
    workerResult.texts = [text('아주작게', 1)]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['0', 'TEXT']), 'big.dxf', 1000, false)

    const h = heightsByText(editor._created())
    expect(h.get('아주작게')!).toBeGreaterThan(0)
  })
})
