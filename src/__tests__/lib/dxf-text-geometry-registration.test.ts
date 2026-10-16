/**
 * 그림과 글자가 같은 좌표계를 쓰는지 보는 회귀 테스트.
 *
 * DxfGroup 한 덩어리 안에서 선·글자·해치는 전부 **shape 원점 기준 로컬 좌표**로
 * 저장된다. 원점을 서로 다르게 잡으면 도면 전체가 그만큼 어긋난다.
 *
 * 실제로 그랬다. shape 원점은 클러스터 bbox 에서 2px 물러선 자리인데, 그
 * 물러서기를 **글자·해치를 모은 뒤에** 했다. 그래서 선은 물러선 원점을,
 * 글자·해치는 물러서기 전 원점을 기준으로 로컬 좌표를 잡았다 — 글자가 그림에서
 * 2px 밀려 있었다.
 *
 * 여기서 보는 건 절대 좌표가 아니라 **관계**다. 같은 DXF 좌표에 있는 선 끝점과
 * 글자는 같은 로컬 좌표를 가져야 한다. 스케일·Y 뒤집기·오프셋이 뭐로 잡히든
 * 이 관계는 성립해야 한다.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { commitCadImportV2, unpackTextsJson } from '../../lib/dxf'
import { createMockEditor } from '../helpers/mockEditor'

const gc = (code: number, value: string | number) => `${code}\n${value}\n`

/**
 * 글자를 붙여둔 지점. 가로선 하나의 오른쪽 끝점이 정확히 같은 자리에 있다.
 *
 * 선 끝점과 겹쳐 두는 게 핵심이다 — 그래야 "같은 DXF 좌표 → 같은 로컬 좌표"
 * 를 shape 안에서 직접 비교할 수 있다.
 */
const ANCHOR = { x: 1000, y: 600 }

/**
 * 한 붓으로 이어진 빗살 모양 선 121개 + 그중 한 꼭짓점에 놓인 글자.
 *
 * 선을 100개 넘게 까는 건 DxfGroup 경로를 타게 하려는 것이다 — 그 아래로는
 * 선마다 wall shape 를 만드는 다른 경로로 빠져서 이 관계를 볼 수 없다.
 *
 * **끝점을 물려 잇는 게 중요하다.** 떨어진 가로선만 깔면 클러스터가 선마다
 * 쪼개져서, 글자가 제 자리 선이 아니라 20px 안에 있는 옆 선의 덩어리에 붙는다.
 *
 * 전부 한 레이어에 둔다 — 레이어가 다르면 글자가 그 덩어리에 안 붙고 고립
 * 텍스트로 따로 빠진다.
 */
function makeDxf(): string {
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    gc(0, 'LINE') + gc(8, 'A') + gc(10, x1) + gc(20, y1) + gc(30, 0) +
    gc(11, x2) + gc(21, y2) + gc(31, 0)

  let s = gc(0, 'SECTION') + gc(2, 'HEADER') + gc(9, '$INSUNITS') + gc(70, 4) + gc(0, 'ENDSEC')
  s += gc(0, 'SECTION') + gc(2, 'ENTITIES')
  // 연결선은 좌우로 번갈아 놓는다. 한쪽에 몰면 같은 직선 위에서 맞닿아
  // **하나로 병합되고**, 세그먼트가 100개 밑으로 떨어져 다른 경로로 빠진다.
  for (let i = 0; i <= 60; i++) {
    s += line(0, i * 20, 1000, i * 20)                             // 가로살
    if (i < 60) {
      const x = i % 2 === 0 ? 1000 : 0
      s += line(x, i * 20, x, (i + 1) * 20)                        // 좌우 교대 이음
    }
  }
  // 정렬 코드 없는 글자 — 기준점이 10/20 그대로다
  s += gc(0, 'TEXT') + gc(8, 'A') +
    gc(10, ANCHOR.x) + gc(20, ANCHOR.y) + gc(30, 0) + gc(40, 30) + gc(1, '기준점')
  return s + gc(0, 'ENDSEC') + gc(0, 'EOF')
}

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

type Shape = {
  type: string
  x: number; y: number
  props: { textsJson: string; pathData: string; w: number; h: number }
  meta: { dxfLayer?: string }
}

/** pathData 의 모든 M 지점 (로컬 좌표) */
function moveToPoints(pathData: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  const re = /M([\d.e+-]+),([\d.e+-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pathData)) !== null) out.push({ x: +m[1], y: +m[2] })
  return out
}

beforeAll(() => {
  ;(globalThis as unknown as { Worker: unknown }).Worker = InlineWorker
})

afterEach(() => vi.restoreAllMocks())

describe('그림과 글자의 좌표 기준', () => {
  it('같은 DXF 좌표의 선 끝점과 글자는 shape 안에서 같은 로컬 좌표다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const created: Shape[] = []
    await commitCadImportV2(
      createMockEditor({ created, instanceMeta: {}, viewport: { width: 1920, height: 1080 } }) as never,
      makeDxf(), new Set(['A']), 'test.dxf', 1234, false, undefined, null,
    )

    const withText = created.filter(s => s.props?.textsJson)
    expect(withText).toHaveLength(1)
    const shape = withText[0]

    const texts = unpackTextsJson(shape.props.textsJson) as Array<{ t: string; x: number; y: number }>
    const anchorText = texts.find(t => t.t === '기준점')
    expect(anchorText).toBeDefined()

    // 글자와 같은 자리에서 시작하는 선분이 이 shape 의 pathData 안에 있어야 한다.
    // 저장할 때 0.1px 로 반올림하므로 그만큼 여유를 둔다.
    const pts = moveToPoints(shape.props.pathData)
    const hit = pts.find(p =>
      Math.abs(p.x - anchorText!.x) <= 0.1 && Math.abs(p.y - anchorText!.y) <= 0.1)

    expect(
      hit,
      `글자(${anchorText!.x}, ${anchorText!.y}) 와 같은 자리의 선 끝점이 없다. ` +
      `가장 가까운 끝점: ${JSON.stringify(
        pts.reduce((best, p) =>
          Math.hypot(p.x - anchorText!.x, p.y - anchorText!.y) <
          Math.hypot(best.x - anchorText!.x, best.y - anchorText!.y) ? p : best, pts[0]))}`,
    ).toBeDefined()
  })

  it('덩어리 안에 있는 글자는 shape 경계 안에 들어온다', async () => {
    // ANCHOR 는 클러스터 bbox 안이므로 로컬 좌표가 음수일 이유가 없다.
    // (bbox 밖 20px 까지는 글자를 끌어오므로, 일반적으로는 음수가 정상이다.)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const created: Shape[] = []
    await commitCadImportV2(
      createMockEditor({ created, instanceMeta: {}, viewport: { width: 1920, height: 1080 } }) as never,
      makeDxf(), new Set(['A']), 'test.dxf', 1234, false, undefined, null,
    )
    const shape = created.find(s => s.props?.textsJson)!
    const texts = unpackTextsJson(shape.props.textsJson) as Array<{ x: number; y: number }>
    for (const t of texts) {
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.y).toBeGreaterThanOrEqual(0)
      expect(t.x).toBeLessThanOrEqual(shape.props.w)
      expect(t.y).toBeLessThanOrEqual(shape.props.h)
    }
  })
})
