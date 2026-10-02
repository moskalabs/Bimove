/**
 * 텍스트 컬링 회귀 테스트
 *
 * 두 가지 버그가 겹쳐서 도면 글자가 전부 사라졌다.
 *
 * 1) 래치: store.listen 이 `scope: 'document'` 였는데 tldraw 카메라는
 *    session scope 다 (@tldraw/tlschema TLCamera: scope "session").
 *    줌 변화가 리스너에 안 들어오니, 축소한 상태에서 도형을 하나 건드리면
 *    그 줌 기준으로 전 텍스트가 hidden 으로 박히고 **다시 확대해도 안 풀렸다.**
 *    → cullTextElements 는 줌이 올라가면 반드시 visibility 를 되돌려야 한다.
 *
 * 2) 임계값: 3 CSS px 미만을 숨겼다. 하지만 실제 도면은 autoScale 때문에
 *    텍스트가 대부분 4px 라서 z < 0.75 구간 전체에서 글자가 하나도 안 보였다.
 *    1px 미만(서브픽셀)만 숨겨야 한다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { cullTextElements } from '../../shapes/DxfGroupShape'

/** 높이들로 `[data-dxf-h]` text 엘리먼트를 만든다 */
function mount(heights: number[]): SVGTextElement[] {
  document.body.innerHTML = ''
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const els = heights.map(h => {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    t.setAttribute('data-dxf-h', String(h))
    svg.appendChild(t)
    return t
  })
  document.body.appendChild(svg)
  return els
}

const isHidden = (el: Element) => el.getAttribute('visibility') === 'hidden'

beforeEach(() => { document.body.innerHTML = '' })

describe('cullTextElements', () => {
  it('확대하면 숨겼던 텍스트가 다시 보인다 (래치 회귀)', () => {
    // 이게 한의 증상이었다 — 한 번 사라진 글자가 확대해도 안 돌아왔다
    const [el] = mount([4])

    cullTextElements(document, 0.14)   // zoomToFit 직후 줌
    expect(isHidden(el)).toBe(true)

    cullTextElements(document, 1)      // 확대
    expect(isHidden(el)).toBe(false)
    expect(el.hasAttribute('visibility')).toBe(false)
  })

  it('4px 텍스트는 z=0.5 에서 보인다 (예전 3px 기준이면 숨겨졌다)', () => {
    // 실제 도면 텍스트 448개 중 430개가 정확히 4px.
    // 예전 기준 minH = 3/0.5 = 6 → 4 < 6 → 전부 hidden 이었다.
    const [el] = mount([4])

    cullTextElements(document, 0.5)    // 화면상 2px
    expect(isHidden(el)).toBe(false)
  })

  it('서브픽셀(1px 미만)만 숨긴다', () => {
    const els = mount([4, 36.5])

    // z=0.2 → 0.8px / 7.3px
    cullTextElements(document, 0.2)
    expect(isHidden(els[0])).toBe(true)
    expect(isHidden(els[1])).toBe(false)   // 도면 제목은 살아남는다

    // z=0.25 → 정확히 1px / 9.1px
    cullTextElements(document, 0.25)
    expect(isHidden(els[0])).toBe(false)
  })

  it('숨긴/보인 개수를 돌려준다', () => {
    mount([0.5, 4, 36.5])

    expect(cullTextElements(document, 0.2)).toEqual({ hidden: 2, shown: 1 })
    expect(cullTextElements(document, 10)).toEqual({ hidden: 0, shown: 3 })
  })

  it('줌이 0 이거나 음수여도 터지지 않는다', () => {
    const els = mount([4])

    expect(() => cullTextElements(document, 0)).not.toThrow()
    expect(isHidden(els[0])).toBe(true)     // 줌 0 → 무한히 작음 → 숨김
    expect(() => cullTextElements(document, -1)).not.toThrow()
  })

  it('data-dxf-h 없는 엘리먼트는 건드리지 않는다', () => {
    mount([4])
    const other = document.createElement('div')
    other.setAttribute('visibility', 'hidden')
    document.body.appendChild(other)

    cullTextElements(document, 10)
    expect(other.getAttribute('visibility')).toBe('hidden')   // 그대로
  })
})

describe('컬링 리스너 등록', () => {
  it("store.listen 이 scope 'document' 가 아니다 (카메라는 session scope)", async () => {
    // 카메라 레코드가 session scope 이므로 'document' 로 받으면 줌 변화가
    // 리스너에 들어오지 않는다 → 위의 래치가 다시 생긴다.
    const src = await import('../../shapes/DxfGroupShape?raw').then(m => m.default as string)

    expect(src).toMatch(/_cullUnsub = editor\.store\.listen\(/)
    expect(src).not.toMatch(/scope: 'document'/)
    expect(src).toMatch(/scope: 'all'/)
  })
})
