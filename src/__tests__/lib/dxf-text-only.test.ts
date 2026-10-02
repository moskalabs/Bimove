/**
 * 선이 하나도 없는 DXF 회귀 테스트
 *
 * 범례 시트, 주기(note) 시트, 표제란만 있는 파일은 폴리라인이 0개다.
 * commitCadImportV2 는 세그먼트 0개를 보면 텍스트 변환에 손도 대지 않고
 * 바로 return 0 했다 — 글자가 수백 개 있어도 캔버스는 비어 있었고,
 * 호출한 쪽은 "선택한 레이어에 표시할 도형이 없습니다" 를 띄웠다.
 *
 * 이제 텍스트/해치 좌표에서 bbox 를 뽑아 그대로 파이프라인을 태운다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commitCadImportV2, unpackTextsJson } from '../../lib/dxf'
import type { PolylineData, TextData, HatchData } from '../../lib/dxf-fast-worker'

type WorkerResult = {
  polylines: PolylineData[]
  insUnits: number
  texts: TextData[]
  hatches: HatchData[]
  linetypes: never[]
  ltscale: number
}

let workerResult: WorkerResult

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

const text = (x: number, y: number, t: string, height = 200): TextData => ({
  x, y, text: t, height, layer: 'TEXT', colorNumber: 7,
})

const hatch = (cx: number, cy: number, layer = 'HATCH'): HatchData => ({
  pathData: `M${cx - 100},${cy - 100}L${cx + 100},${cy - 100}L${cx + 100},${cy + 100}Z`,
  patternName: 'ANSI31', patternScale: 1, patternAngle: 0, layer, cx, cy,
})

type ShapeLike = {
  type: string
  x: number
  y: number
  props: { textsJson?: string; hatchesJson?: string }
}

function textsIn(shapes: unknown[]): string[] {
  return (shapes as ShapeLike[])
    .filter(s => s.type === 'dxfgroup' && s.props.textsJson)
    .flatMap(s => (unpackTextsJson(s.props.textsJson!) as Array<{ t: string }>).map(e => e.t))
}

function hatchCount(shapes: unknown[]): number {
  return (shapes as ShapeLike[])
    .filter(s => s.type === 'dxfgroup' && s.props.hatchesJson)
    .reduce((n, s) => n + (JSON.parse(s.props.hatchesJson!) as unknown[]).length, 0)
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  workerResult = { polylines: [], insUnits: 4, texts: [], hatches: [], linetypes: [], ltscale: 1 }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('commitCadImportV2 — 선이 없는 도면', () => {
  // ── 이게 버그였다 ──
  it('텍스트만 있는 DXF 를 불러온다', async () => {
    workerResult.texts = [
      text(0, 0, '범례'),
      text(0, -500, '■ 신설 벽체'),
      text(0, -1000, '□ 철거 벽체'),
    ]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['TEXT']), 'legend.dxf', 100, false)

    expect(textsIn(editor._created()).sort()).toEqual(['■ 신설 벽체', '□ 철거 벽체', '범례'])
  })

  it('반환값이 0 이 아니다 (0 이면 호출한 쪽이 실패로 알린다)', async () => {
    workerResult.texts = [text(0, 0, '범례'), text(0, -500, '주기')]
    const editor = createMockEditor()
    const count = await commitCadImportV2(editor as never, 'dummy', new Set(['TEXT']), 'legend.dxf', 100, false)

    expect(count).toBeGreaterThan(0)
  })

  it('해치만 있는 DXF 를 불러온다', async () => {
    workerResult.hatches = [hatch(0, 0), hatch(1000, 0), hatch(2000, 0)]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['HATCH']), 'swatch.dxf', 100, false)

    expect(hatchCount(editor._created())).toBe(3)
  })

  it('텍스트와 해치가 섞여 있어도 둘 다 올린다', async () => {
    workerResult.texts = [text(0, 0, '마감재')]
    workerResult.hatches = [hatch(500, -500)]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['TEXT', 'HATCH']), 'm.dxf', 100, false)

    expect(textsIn(editor._created())).toEqual(['마감재'])
    expect(hatchCount(editor._created())).toBe(1)
  })

  it('좌표가 NaN 으로 번지지 않는다 (bbox 가 빈 세그먼트에서 나오면 전부 NaN)', async () => {
    workerResult.texts = [text(0, 0, '가'), text(3000, -2000, '나')]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['TEXT']), 'legend.dxf', 100, false)

    const created = editor._created() as ShapeLike[]
    expect(created.length).toBeGreaterThan(0)
    for (const s of created) {
      expect(Number.isFinite(s.x)).toBe(true)
      expect(Number.isFinite(s.y)).toBe(true)
    }
    for (const s of created) {
      if (!s.props.textsJson) continue
      for (const e of unpackTextsJson(s.props.textsJson!) as Array<{ x: number; y: number; h: number }>) {
        expect(Number.isFinite(e.x)).toBe(true)
        expect(Number.isFinite(e.y)).toBe(true)
        expect(e.h).toBeGreaterThan(0)
      }
    }
  })

  it('글자가 bbox 필터에 스스로 걸러지지 않는다 (bbox 를 글자에서 뽑았으므로)', async () => {
    // 가장자리에 놓인 글자 — 패딩이 0 이어도 경계값으로 통과해야 한다
    workerResult.texts = [text(0, 0, '좌상'), text(10000, -8000, '우하')]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['TEXT']), 'legend.dxf', 100, false)

    expect(textsIn(editor._created()).sort()).toEqual(['우하', '좌상'])
  })

  it('텍스트 하나뿐이어도 올린다 (span 0 → 0 나누기)', async () => {
    workerResult.texts = [text(1234, -5678, '표제란')]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['TEXT']), 'title.dxf', 100, false)

    expect(textsIn(editor._created())).toEqual(['표제란'])
  })

  it('DEFPOINTS 해치만 있으면 올리지 않는다', async () => {
    workerResult.hatches = [hatch(0, 0, 'DEFPOINTS'), hatch(100, 0, 'defpoints')]
    const editor = createMockEditor()
    const count = await commitCadImportV2(editor as never, 'dummy', new Set(['DEFPOINTS']), 'd.dxf', 100, false)

    expect(count).toBe(0)
    expect(hatchCount(editor._created())).toBe(0)
  })

  it('전부 비어 있으면 0 을 돌려준다 (기존 동작)', async () => {
    const editor = createMockEditor()
    const count = await commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'empty.dxf', 100, false)

    expect(count).toBe(0)
    expect(editor._created()).toHaveLength(0)
  })

  it('좌표가 터무니없이 크면 걸러낸다 (COORD_LIMIT)', async () => {
    workerResult.texts = [text(1e9, 1e9, '쓰레기'), text(0, 0, '정상')]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['TEXT']), 'junk.dxf', 100, false)

    expect(textsIn(editor._created())).toEqual(['정상'])
  })
})
