/**
 * 작은 도면에서 텍스트/해치가 통째로 사라지던 회귀 테스트
 *
 * commitCadImportV2 는 세그먼트 수로 두 갈래로 갈린다.
 *  - 100개 이상 → DxfGroup 모드. 텍스트/해치를 클러스터에 붙이고,
 *                 남은 건 buildOrphanTextShapes 로 독립 shape 로 만든다.
 *  - 100개 미만 → 개별 wall shape. 예전엔 이 분기가 pxTexts/pxHatches 를
 *                 쳐다보지도 않았다 — 작은 평면도나 상세도를 불러오면
 *                 글자와 해치가 전부 없어졌고, 로그에도 흔적이 없었다.
 *
 * 이제 100개 미만 분기도 전부를 "고립" 취급해서 독립 shape 로 만든다.
 *
 * Worker 는 jsdom 에 없으니 미리 정해둔 결과를 돌려주는 가짜로 바꿔 끼운다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commitCadImportV2, unpackTextsJson } from '../../lib/dxf'
import type { PolylineData, TextData, HatchData } from '../../lib/dxf-fast-worker'
import { createMockEditor } from '../helpers/mockEditor'

type WorkerResult = {
  polylines: PolylineData[]
  insUnits: number
  texts: TextData[]
  hatches: HatchData[]
  linetypes: never[]
  ltscale: number
}

let workerResult: WorkerResult

/** runFastWorker 가 쓰는 Worker 를 가로채 정해둔 결과를 바로 돌려준다 */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  postMessage() {
    setTimeout(() => this.onmessage?.({ data: { type: 'result', ...workerResult } }), 0)
  }
  terminate() { /* noop */ }
}


/** 10m x 8m 직사각형 = 4 세그먼트 (100개 미만 분기) */
const RECT: PolylineData[] = [{
  vertices: [[0, 0], [10000, 0], [10000, 8000], [0, 8000], [0, 0]],
  layer: '0',
  colorNumber: 7,
}]

const text = (x: number, y: number, t: string): TextData => ({
  x, y, text: t, height: 200, layer: 'TEXT', colorNumber: 7,
})

const hatch = (cx: number, cy: number): HatchData => ({
  pathData: `M${cx - 100},${cy - 100}L${cx + 100},${cy - 100}L${cx + 100},${cy + 100}Z`,
  patternName: 'ANSI31', patternScale: 1, patternAngle: 0,
  layer: 'HATCH', cx, cy,
})

type ShapeLike = { type: string; props: { textsJson: string; hatchesJson: string } }

function textsIn(shapes: unknown[]): string[] {
  return (shapes as ShapeLike[])
    .filter(s => s.type === 'dxfgroup' && s.props.textsJson)
    .flatMap(s => (unpackTextsJson(s.props.textsJson) as Array<{ t: string }>).map(e => e.t))
}

function hatchCount(shapes: unknown[]): number {
  return (shapes as ShapeLike[])
    .filter(s => s.type === 'dxfgroup' && s.props.hatchesJson)
    .reduce((n, s) => n + (JSON.parse(s.props.hatchesJson) as unknown[]).length, 0)
}

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  workerResult = { polylines: RECT, insUnits: 4, texts: [], hatches: [], linetypes: [], ltscale: 1 }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('commitCadImportV2 — 세그먼트 100개 미만 도면', () => {
  it('벽은 개별 wall shape 로 만든다 (기존 동작)', async () => {
    const editor = createMockEditor()
    const count = await commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false)

    expect(count).toBe(4)
    const walls = (editor._created() as ShapeLike[]).filter(s => s.type === 'wall')
    expect(walls).toHaveLength(4)
  })

  // ── 이게 버그였다 ──
  it('텍스트를 버리지 않는다', async () => {
    workerResult.texts = [
      text(2000, 2000, '거실'),
      text(6000, 2000, '주방'),
      text(4000, 6000, '화장실'),
    ]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['0', 'TEXT']), 'a.dxf', 100, false)

    expect(textsIn(editor._created()).sort()).toEqual(['거실', '주방', '화장실'])
  })

  it('해치를 버리지 않는다', async () => {
    workerResult.hatches = [hatch(2000, 2000), hatch(6000, 4000)]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['0', 'HATCH']), 'a.dxf', 100, false)

    expect(hatchCount(editor._created())).toBe(2)
  })

  it('반환값은 여전히 세그먼트 수다 (텍스트 shape 를 세지 않는다)', async () => {
    workerResult.texts = [text(2000, 2000, '거실'), text(6000, 2000, '주방')]
    const editor = createMockEditor()
    const count = await commitCadImportV2(editor as never, 'dummy', new Set(['0', 'TEXT']), 'a.dxf', 100, false)

    expect(count).toBe(4)
  })

  it('텍스트도 해치도 없으면 wall shape 만 만든다', async () => {
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false)

    expect((editor._created() as ShapeLike[]).every(s => s.type === 'wall')).toBe(true)
  })

  it('텍스트 shape 도 지오메트리와 같은 fingerprint 를 쓴다 (레이어 토글/삭제가 같이 동작하도록)', async () => {
    workerResult.texts = [text(2000, 2000, '거실')]
    const editor = createMockEditor()
    await commitCadImportV2(editor as never, 'dummy', new Set(['0', 'TEXT']), 'a.dxf', 100, false)

    const created = editor._created() as Array<{ meta: { dxfFingerprint: string } }>
    const fps = new Set(created.map(s => s.meta.dxfFingerprint))
    expect(fps.size).toBe(1)
  })
})
