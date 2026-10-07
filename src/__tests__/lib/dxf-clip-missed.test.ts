/**
 * clip 이 도형을 하나도 못 잡았을 때 commitCadImportV2 가 **던지는지**.
 *
 * 예전엔 clip 을 버리고 모델공간 전체를 복사했다. 그러면 오토캐드에서 탭으로
 * 나뉘어 있던 게 한 페이지에 다 쏟아져서, "모형" 페이지의 복제본이 생긴다.
 * 1908_흑석동 도면의 "천정도" 가 정확히 이 모양이었다 — DWG→DXF 변환에서
 * 뷰포트 → 모델공간 매핑이 날아간 파일이다.
 *
 * 0 을 돌려주지 않고 던지는 게 핵심이다. 0 은 "선택한 레이어에 도형이 없음"
 * 과 구분되지 않는다.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'
import { commitCadImportV2, ViewportClipMissedError } from '../../lib/dxf'
import { createMockEditor } from '../helpers/mockEditor'

// runFastWorker 의 `new Worker(new URL('./dxf-fast-worker.ts', ...))` 대체
class InlineWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  constructor(_url: URL, _opts?: unknown) { /* noop */ }
  postMessage(data: unknown) {
    void (async () => {
      await import('../../lib/dxf-fast-worker')
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
beforeAll(() => {
  ;(globalThis as unknown as { Worker: unknown }).Worker = InlineWorker
})

afterEach(() => { vi.restoreAllMocks() })

const gc = (code: number, value: string | number) => `${code}\n${value}\n`

/** 원점 근처에 네모 하나. 모델공간 좌표 0~100. */
function makeDxf(): string {
  let s = gc(0, 'SECTION') + gc(2, 'HEADER') + gc(9, '$INSUNITS') + gc(70, 4) + gc(0, 'ENDSEC')
  s += gc(0, 'SECTION') + gc(2, 'ENTITIES')
  const pts: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]
  for (let i = 0; i < pts.length - 1; i++) {
    s += gc(0, 'LINE') + gc(8, '0') +
      gc(10, pts[i][0]) + gc(20, pts[i][1]) + gc(30, 0) +
      gc(11, pts[i + 1][0]) + gc(21, pts[i + 1][1]) + gc(31, 0)
  }
  return s + gc(0, 'ENDSEC') + gc(0, 'EOF')
}

function run(clip: { minX: number; minY: number; maxX: number; maxY: number } | null) {
  const editor = createMockEditor({
    instanceMeta: { unit: 'mm', pxPerMm: 1 },
    viewport: { width: 1920, height: 1080 },
  }) as never
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return commitCadImportV2(editor, makeDxf(), new Set(['0']), 'a.dxf', 1234, false, undefined, clip)
}

describe('뷰포트 clip 이 빗나갔을 때', () => {
  it('clip 밖에 도형이 전부 있으면 던진다 — 0 을 돌려주지 않는다', async () => {
    // 도형은 0~100, clip 은 10000~20000. 교차하는 세그먼트가 없다.
    await expect(run({ minX: 10_000, minY: 10_000, maxX: 20_000, maxY: 20_000 }))
      .rejects.toThrow(ViewportClipMissedError)
  })

  it('clip 이 도형을 잡으면 평소대로 임포트한다', async () => {
    await expect(run({ minX: -50, minY: -50, maxX: 200, maxY: 200 }))
      .resolves.toBeGreaterThan(0)
  })

  it('clip 이 없으면(레이아웃 없는 파일) 던지지 않는다', async () => {
    await expect(run(null)).resolves.toBeGreaterThan(0)
  })
})
