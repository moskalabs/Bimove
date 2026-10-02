/**
 * 터치패드 가로 스와이프 → 브라우저 뒤로가기 회귀 테스트
 *
 * 크롬/엣지는 가로 스크롤이 스크롤러 끝에 닿으면 overscroll navigation
 * (뒤로/앞으로 가기) 제스처를 발동한다. 루트가 overflow:hidden 이라 가로는
 * 항상 "끝"이므로, 캔버스에서 왼쪽으로 이동하려고 두 손가락을 밀 때마다
 * 페이지가 뒤로 가버렸다.
 *
 * 캔버스에서 wheel 을 preventDefault 해도 안 막힌다 — 이 제스처는 wheel
 * 이벤트보다 앞단에서 결정된다. 끄는 방법은 스크롤러에 overscroll-behavior
 * 를 거는 것뿐이다.
 *
 * jsdom 은 외부 CSS 를 적용하지 않고 vitest 는 `?raw` 로 가져온 CSS 마저
 * 빈 문자열로 스텁한다. 그래서 파일을 직접 읽어 선언이 살아 있는지 본다.
 * (실제 적용은 Chromium 에서 html/body/#root 전부 'none' 으로 확인했다.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// vitest 는 프로젝트 루트에서 돈다 (여기선 import.meta.url 이 file: 스킴이 아니라 못 쓴다)
const css = readFileSync('src/index.css', 'utf-8').replace(/\r\n/g, '\n')

/** `html, body, #root { ... }` 블록의 본문 */
function rootScrollerRule(src: string): string {
  const i = src.indexOf('html,\nbody,\n#root {')
  if (i < 0) throw new Error('루트 스크롤러 규칙(html, body, #root)을 찾지 못했다')
  const open = src.indexOf('{', i)
  const close = src.indexOf('\n}', open)
  return src.slice(open + 1, close)
}

describe('루트 스크롤러', () => {
  it('overscroll-behavior 로 스와이프 내비게이션을 끈다', () => {
    expect(rootScrollerRule(css)).toMatch(/overscroll-behavior(-x)?:\s*(none|contain)\s*;/)
  })

  it('가로를 auto 로 되돌리지 않는다', () => {
    // overscroll-behavior-x: auto 가 뒤에 오면 위 선언이 무효가 된다
    expect(css).not.toMatch(/overscroll-behavior(-x)?:\s*auto/)
  })

  it('루트는 여전히 overflow:hidden 인 전체 화면이다 (전제 조건)', () => {
    // 이 전제가 깨지면 overscroll-behavior 를 여기 걸 이유도 사라진다
    const rule = rootScrollerRule(css)
    expect(rule).toMatch(/overflow:\s*hidden\s*;/)
    expect(rule).toMatch(/height:\s*100%\s*;/)
  })
})
