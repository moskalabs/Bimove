/**
 * 큰 레이어의 선택 단위 회귀 테스트
 *
 * clusterConnectedSegs 가 O(n²) 이던 시절, 세그먼트 800개가 넘는 레이어는
 * 통째로 한 클러스터(= shape 하나)로 묶였다. 지금은 격자 해싱 + union-find 라
 * O(n) 인데 상한만 남아 있었고, 그 결과 실무 도면에서 선 하나를 클릭하면
 * 레이아웃 절반이 통째로 잡혔다 (1908_흑석동 아파트 리모델링 도면).
 *
 * 떨어져 있는 두 덩어리는 **한 shape 에 같이 들어가면 안 된다**.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { commitCadImportV2 } from '../../lib/dxf'
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

const gc = (code: number, value: string | number) => `${code}\n${value}\n`

/** (bx, 0) 에서 출발하는 결정론적 랜덤워크 한 덩어리.
 *
 * 각도를 흩뿌리는 게 중요하다 — 격자나 지그재그로 만들면 mergeDxfSegments 가
 * 동일선상 세그먼트를 합치면서 수가 확 줄고(900→361) 체인도 끊어져서,
 * 정작 검사하려는 "큰 레이어" 경로(800개 초과)를 안 타게 된다.
 */
function blob(bx: number, n: number, seed: number): string {
  let s = ''
  let rnd = seed
  const next = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  let x = bx + 200, y = 200
  for (let i = 0; i < n; i++) {
    const a = next() * Math.PI * 2
    let x2 = x + Math.cos(a) * 15, y2 = y + Math.sin(a) * 15
    // 덩어리가 400x400 안을 벗어나지 않게 되접는다
    if (x2 < bx) x2 = bx + (bx - x2)
    if (x2 > bx + 400) x2 = bx + 800 - x2
    if (y2 < 0) y2 = -y2
    if (y2 > 400) y2 = 800 - y2
    s += gc(0, 'LINE') + gc(8, 'A') + gc(10, x.toFixed(2)) + gc(20, y.toFixed(2)) + gc(30, 0) +
      gc(11, x2.toFixed(2)) + gc(21, y2.toFixed(2)) + gc(31, 0)
    x = x2; y = y2
  }
  return s
}

/** 떨어진 두 덩어리 (합 1200 세그먼트 — 예전 상한 800 을 넘긴다) */
function makeDxf(): string {
  let s = gc(0, 'SECTION') + gc(2, 'HEADER') + gc(9, '$INSUNITS') + gc(70, 4) + gc(0, 'ENDSEC')
  s += gc(0, 'SECTION') + gc(2, 'ENTITIES')
  s += blob(0, 600, 7)       // X 0~400
  s += blob(1000, 600, 99)   // X 1000~1400
  return s + gc(0, 'ENDSEC') + gc(0, 'EOF')
}

type Shape = { type: string; x: number; y: number; props: { w: number; h: number } }

describe('큰 레이어 선택 단위', () => {
  it('떨어진 두 덩어리를 한 shape 로 묶지 않는다', async () => {
    const created: Shape[] = []
    const editor = createMockEditor({
      created,
      instanceMeta: { unit: 'mm', pxPerMm: 1 },
      viewport: { width: 1920, height: 1080 },
    }) as never

    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await commitCadImportV2(editor, makeDxf(), new Set(['A']), 'two-blobs.dxf', 1234, false)
    vi.restoreAllMocks()

    const groups = created.filter(s => s.type === 'dxfgroup')
    expect(groups.length).toBeGreaterThanOrEqual(2)

    // 어떤 shape 도 두 덩어리를 한꺼번에 덮으면 안 된다.
    // 전체 가로폭(1900) 의 70% 를 넘는 shape 가 있으면 그게 예전 버그다.
    const totalW = Math.max(...groups.map(s => s.x + s.props.w)) - Math.min(...groups.map(s => s.x))
    const widest = Math.max(...groups.map(s => s.props.w))
    expect(widest).toBeLessThan(totalW * 0.7)
  })
})
