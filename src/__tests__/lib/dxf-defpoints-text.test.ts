/**
 * DEFPOINTS 레이어 텍스트 보존 회귀 테스트
 *
 * AutoCAD 의 DEFPOINTS 는 "출력 안 함" 레이어지 "숨김" 레이어가 아니다 —
 * 화면에는 그대로 보인다. 그래서 실무 도면은 도면 제목을 여기에 올려놓는 일이
 * 흔하다. 실제 사례(26.08.07_리닝.dwg)에서 도면 전체에서 가장 큰 글자
 * '평 면 (1/60)'(h=2970), 'COVER'(h=1980) 가 전부 DEFPOINTS 에 있었다.
 *
 * 예전 transformWorkerTexts 는 DEFPOINTS 텍스트를 통째로 걸러냈고 로그도
 * 남기지 않았다 → 도면에서 제목만 쏙 사라지고 흔적이 없었다.
 * 지오메트리(치수 정의점)는 계속 걸러내는 게 맞다.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { commitCadImportV2, unpackTextsJson } from '../../lib/dxf'

// ── 테스트용 DXF 조립 ──
const gc = (code: number, value: string | number) => `${code}\n${value}\n`

/** 세그먼트 N개 + 지정한 텍스트들로 된 최소 DXF (단위 mm) */
function makeDxf(texts: Array<{ layer: string; text: string; h: number; x: number; y: number }>): string {
  let s = gc(0, 'SECTION') + gc(2, 'HEADER') + gc(9, '$INSUNITS') + gc(70, 4) + gc(0, 'ENDSEC')
  s += gc(0, 'SECTION') + gc(2, 'ENTITIES')
  // DxfGroup 모드(100개 이상)로 들어가도록 가로선 120개
  for (let i = 0; i < 120; i++) {
    s += gc(0, 'LINE') + gc(8, 'A') +
      gc(10, 0) + gc(20, i * 10) + gc(30, 0) +
      gc(11, 1000) + gc(21, i * 10) + gc(31, 0)
  }
  for (const t of texts) {
    s += gc(0, 'TEXT') + gc(8, t.layer) +
      gc(10, t.x) + gc(20, t.y) + gc(30, 0) + gc(40, t.h) + gc(1, t.text)
  }
  return s + gc(0, 'ENDSEC') + gc(0, 'EOF')
}

// ── runFastWorker 의 `new Worker(new URL('./dxf-fast-worker.ts', ...))` 대체 ──
class InlineWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  constructor(_url: URL, _opts?: unknown) { /* noop */ }
  postMessage(data: unknown) {
    void (async () => {
      await import('../../lib/dxf-fast-worker')   // self.onmessage 설치 (side effect)
      const origPost = self.postMessage
      self.postMessage = (msg: unknown) => {
        this.onmessage?.(new MessageEvent('message', { data: msg }))
      }
      try {
        ;(self.onmessage as (e: MessageEvent) => void)(new MessageEvent('message', { data }))
      } finally {
        self.postMessage = origPost
      }
    })()
  }
  terminate() { /* noop */ }
}

type Shape = {
  type: string
  props: { textsJson: string }
  meta: { dxfLayer?: string }
}

/** commitCadImportV2 가 필요로 하는 최소 Editor */
function fakeEditor(created: Shape[]) {
  return {
    getInstanceState: () => ({ meta: {} }),
    getCamera: () => ({ x: 0, y: 0, z: 1 }),
    getViewportScreenBounds: () => ({ width: 1920, height: 1080 }),
    createShapes: (arr: Shape[]) => { created.push(...arr) },
    selectAll: () => {}, selectNone: () => {},
    zoomToFit: () => {},
  } as never
}

/** 임포트 후 모든 shape 에 들어간 텍스트 (문자열, 레이어) */
async function importTexts(
  texts: Array<{ layer: string; text: string; h: number; x: number; y: number }>,
): Promise<Array<{ t: string; h: number; layer: string }>> {
  const created: Shape[] = []
  const layers = new Set(['A', 'DEFPOINTS', ...texts.map(t => t.layer)])
  await commitCadImportV2(
    fakeEditor(created), makeDxf(texts), layers, 'test.dxf', 1234, false, undefined, null,
  )
  const out: Array<{ t: string; h: number; layer: string }> = []
  for (const sh of created) {
    if (!sh.props?.textsJson) continue
    for (const t of unpackTextsJson(sh.props.textsJson) as Array<{ t: string; h: number }>) {
      out.push({ t: t.t, h: t.h, layer: sh.meta.dxfLayer || '0' })
    }
  }
  return out
}

beforeAll(() => {
  ;(globalThis as unknown as { Worker: unknown }).Worker = InlineWorker
})

afterEach(() => vi.restoreAllMocks())

describe('DEFPOINTS 텍스트', () => {
  it('DEFPOINTS 에 있는 도면 제목을 버리지 않는다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const got = await importTexts([
      { layer: 'DEFPOINTS', text: '평 면 (1/60)', h: 100, x: 500, y: 600 },
      { layer: 'DEFPOINTS', text: 'COVER', h: 80, x: 500, y: 400 },
      { layer: 'A', text: '거실', h: 50, x: 300, y: 300 },
    ])

    expect(got.map(g => g.t).sort()).toEqual(['COVER', '거실', '평 면 (1/60)'])
  })

  it('높이가 뭉개지지 않고 그대로 넘어간다 (제목이 제목 크기로)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const got = await importTexts([
      { layer: 'DEFPOINTS', text: '평  면', h: 200, x: 500, y: 600 },
    ])

    expect(got).toHaveLength(1)
    expect(got[0].h).toBe(200)
  })

  it('DEFPOINTS 지오메트리는 계속 걸러낸다 (치수 정의점)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const created: Shape[] = []
    // 'A' 120개 + DEFPOINTS 세로선 40개
    let dxf = makeDxf([])
    const extra = Array.from({ length: 40 }, (_, i) =>
      `0\nLINE\n8\nDEFPOINTS\n10\n${i * 10}\n20\n0\n30\n0\n11\n${i * 10}\n21\n1000\n31\n0\n`,
    ).join('')
    dxf = dxf.replace('0\nENDSEC\n0\nEOF\n', extra + '0\nENDSEC\n0\nEOF\n')

    await commitCadImportV2(
      fakeEditor(created), dxf, new Set(['A', 'DEFPOINTS']), 'test.dxf', 1234, false, undefined, null,
    )

    const layersUsed = new Set(created.map(s => s.meta.dxfLayer))
    expect(layersUsed.has('A')).toBe(true)
    expect(layersUsed.has('DEFPOINTS')).toBe(false)
  })
})
