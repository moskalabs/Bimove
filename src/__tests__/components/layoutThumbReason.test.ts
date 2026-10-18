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

describe('generateThumbForPage', () => {
  it('멀쩡하면 그림을 준다 — 이유는 없다', async () => {
    const r = await generateThumbForPage(fakeEditor({ shapes: 10, svg: SVG }), PAGE)
    expect(r.svg).toContain('width="100%"')
    expect(r.why).toBeNull()
  })

  it('**정말 비었을 때만** 이유가 없다 (= "빈 페이지" 로 보인다)', async () => {
    const r = await generateThumbForPage(fakeEditor({ shapes: 0 }), PAGE)
    expect(r.svg).toBeNull()
    expect(r.why).toBeNull()
  })

  it('도형이 한도를 넘으면 **개수를 말한다**', async () => {
    // 여기가 "빈 페이지" 로 나오면 도면이 날아간 줄 안다.
    const r = await generateThumbForPage(fakeEditor({ shapes: 20001, svg: SVG }), PAGE)
    expect(r.svg).toBeNull()
    expect(r.why).toContain('20,001')
    expect(r.why).not.toContain('빈')
  })

  it('옛 한도(2000)는 이제 안 걸린다', async () => {
    // 2000 이 왜 2000 인지는 아무도 몰랐고, 넘으면 조용히 빈 페이지가 됐다.
    const r = await generateThumbForPage(fakeEditor({ shapes: 2500, svg: SVG }), PAGE)
    expect(r.svg).not.toBeNull()
    expect(r.why).toBeNull()
  })

  it('SVG 가 너무 크면 **버리고 크기를 말한다**', async () => {
    // 수 MB 를 DOM 에 넣으면 패널이 멈춘다. 버리되 조용히 버리지 않는다.
    const huge = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="${'L1 1'.repeat(900_000)}"/></svg>`
    const r = await generateThumbForPage(fakeEditor({ shapes: 10, svg: huge }), PAGE)
    expect(r.svg).toBeNull()
    expect(r.why).toContain('MB')
  })

  it('SVG 를 못 받으면 실패라고 말한다', async () => {
    const r = await generateThumbForPage(fakeEditor({ shapes: 10, svg: null }), PAGE)
    expect(r.svg).toBeNull()
    expect(r.why).toContain('실패')
  })

  it('그리다 터져도 이유가 남는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await generateThumbForPage(fakeEditor({ shapes: 10, throws: true }), PAGE)
    expect(r.svg).toBeNull()
    expect(r.why).toContain('캔버스가 없다')
  })

  it('에디터가 아직 없으면 조용히 넘어간다', async () => {
    const r = await generateThumbForPage(null as never, PAGE)
    expect(r.svg).toBeNull()
    expect(r.why).toBeNull()
  })
})
