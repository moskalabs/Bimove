/**
 * 배치 썸네일을 **못 만들었을 때 이유를 말하는가.**
 *
 * 전엔 못 만들면 무조건 "빈 페이지" 라고 썼다. 그런데 못 만드는 이유가 넷이다 —
 * 정말 비었거나, 도형이 한도를 넘었거나, SVG 가 너무 커서 버렸거나, 그리다
 * 터졌거나. 넷을 같은 말로 덮으면 **내용이 있는 페이지가 빈 것처럼 보인다.**
 *
 * 한이 "배치 2번 그림 안 나옴" 으로 집어낸 게 이거다. 도면은 멀쩡히 캔버스에
 * 있는데 패널만 "빈 페이지" 라고 했다 — 도면이 날아간 줄 알 수 있는 모양이다.
 */
import { describe, it, expect, vi } from 'vitest'
import { generateThumbForPage } from '../../components/panels/LayoutPanel'
import type { TLPageId } from 'tldraw'

const PAGE = 'page:x' as TLPageId

/** `generateThumbForPage` 가 쓰는 것만 흉내낸다. */
function fakeEditor(opts: {
  shapes: number
  svg?: string | null
  throws?: boolean
}) {
  return {
    getPageShapeIds: () => new Set(Array.from({ length: opts.shapes }, (_, i) => `shape:${i}`)),
    getSvgString: async () => {
      if (opts.throws) throw new Error('캔버스가 없다')
      return opts.svg == null ? undefined : { svg: opts.svg }
    },
  } as unknown as Parameters<typeof generateThumbForPage>[0]
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><path d="M0 0L9 9"/></svg>'

/**
 * 굽는 흉내. jsdom 에는 canvas 가 없어서 진짜 `rasterizeSvg` 는 못 돈다.
 *
 * 실제 코드는 SVG 를 **작은 PNG 로 구워서** 넣는다 — 썸네일인데 원본 정밀도
 * SVG 를 통째로 DOM 에 꽂고 있었고, 그래서 큰 페이지는 아예 포기했다.
 */
const bake = async (svg: string) => (svg ? 'data:image/png;base64,AAA' : null)
/** 굽다 실패하는 경우 (SVG 를 이미지로 못 읽는다). */
const bakeFails = async () => null

describe('generateThumbForPage', () => {
  it('멀쩡하면 그림을 준다 — 이유는 없다', async () => {
    const r = await generateThumbForPage(fakeEditor({ shapes: 10, svg: SVG }), PAGE, bake)
    // SVG 가 아니라 **구워진 PNG** 가 나와야 한다
    expect(r.svg).toMatch(/^data:image\/png/)
    expect(r.why).toBeNull()
  })

  it('**정말 비었을 때만** 이유가 없다 (= "빈 페이지" 로 보인다)', async () => {
    const r = await generateThumbForPage(fakeEditor({ shapes: 0 }), PAGE, bake)
    expect(r.svg).toBeNull()
    expect(r.why).toBeNull()
  })

  it('도형이 한도를 넘으면 **개수를 말한다**', async () => {
    // 여기가 "빈 페이지" 로 나오면 도면이 날아간 줄 안다.
    const r = await generateThumbForPage(fakeEditor({ shapes: 20001, svg: SVG }), PAGE, bake)
    expect(r.svg).toBeNull()
    expect(r.why).toContain('20,001')
    expect(r.why).not.toContain('빈')
  })

  it('옛 한도(2000)는 이제 안 걸린다', async () => {
    // 2000 이 왜 2000 인지는 아무도 몰랐고, 넘으면 조용히 빈 페이지가 됐다.
    const r = await generateThumbForPage(fakeEditor({ shapes: 2500, svg: SVG }), PAGE, bake)
    expect(r.svg).not.toBeNull()
    expect(r.why).toBeNull()
  })

  it('수 MB 짜리도 **이제는 구워서 낸다**', async () => {
    // 전엔 2MB 넘으면 포기했다. SVG 를 그대로 DOM 에 넣었기 때문인데,
    // 이제 작은 PNG 로 구우므로 그림이 복잡해도 결과 크기가 고정이다.
    const big = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="${'L1 1'.repeat(900_000)}"/></svg>`
    const r = await generateThumbForPage(fakeEditor({ shapes: 10, svg: big }), PAGE, bake)
    expect(r.svg).toMatch(/^data:image\/png/)
    expect(r.why).toBeNull()
  })

  it('그래도 말이 안 되게 크면 버린다 (문자열 만드는 메모리)', async () => {
    const absurd = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="${'L1 1'.repeat(9_000_000)}"/></svg>`
    const r = await generateThumbForPage(fakeEditor({ shapes: 10, svg: absurd }), PAGE, bake)
    expect(r.svg).toBeNull()
    expect(r.why).toContain('MB')
  })

  it('굽다 실패하면 그렇다고 말한다', async () => {
    const r = await generateThumbForPage(fakeEditor({ shapes: 10, svg: SVG }), PAGE, bakeFails)
    expect(r.svg).toBeNull()
    expect(r.why).toContain('못 구웠다')
  })

  it('SVG 를 못 받으면 실패라고 말한다', async () => {
    const r = await generateThumbForPage(fakeEditor({ shapes: 10, svg: null }), PAGE, bake)
    expect(r.svg).toBeNull()
    expect(r.why).toContain('실패')
  })

  it('그리다 터져도 이유가 남는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await generateThumbForPage(fakeEditor({ shapes: 10, throws: true }), PAGE, bake)
    expect(r.svg).toBeNull()
    expect(r.why).toContain('캔버스가 없다')
  })

  it('에디터가 아직 없으면 조용히 넘어간다', async () => {
    const r = await generateThumbForPage(null as never, PAGE, bake)
    expect(r.svg).toBeNull()
    expect(r.why).toBeNull()
  })
})
