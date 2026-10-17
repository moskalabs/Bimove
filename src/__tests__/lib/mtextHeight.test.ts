/**
 * MTEXT 인라인 높이 지정 `\H…;`.
 *
 * 서식 코드를 지우면서 이걸 같이 버리고 gc 40 을 그대로 쓰고 있었다. 한의
 * 도면에서 표제란 글씨가 `{\H0.4x;11/11_최종}` + gc40=1500 이라, 600 이어야
 * 할 글자가 1500 으로 — **2.5배 크게** 나왔다. 배치 탭에서 도면틀을 덮었다.
 */
import { describe, it, expect } from 'vitest'
import { mtextHeightOverride, cleanMtextFormatting } from '../../lib/dxf-shared'

/** 한의 도면에 실제로 들어 있던 문자열 */
const REAL = '{\\H0.4x;11/11_최종}'

describe('mtextHeightOverride', () => {
  it('실제 도면의 문자열을 읽어낸다', () => {
    expect(mtextHeightOverride(REAL)).toEqual({ kind: 'factor', value: 0.4 })
  })

  it('배율 꼴 — gc 40 에 곱한다', () => {
    const o = mtextHeightOverride('{\\H0.4x;가나다}')!
    expect(o.kind).toBe('factor')
    expect(1500 * o.value).toBeCloseTo(600, 5)
  })

  it('절대 꼴 — gc 40 을 대신한다', () => {
    expect(mtextHeightOverride('{\\H600;가나다}')).toEqual({ kind: 'absolute', value: 600 })
  })

  it('지정이 없으면 null (gc 40 을 그대로 쓴다)', () => {
    expect(mtextHeightOverride('FLOOR PLAN _7F')).toBeNull()
    expect(mtextHeightOverride('{\\fArial|b0;글씨}')).toBeNull()
  })

  it('같은 지정이 여러 번이면 그 값을 쓴다', () => {
    // 문단마다 같은 배율을 다시 적는 도면이 흔하다.
    expect(mtextHeightOverride('{\\H0.4x;가}\\P{\\H0.4x;나}'))
      .toEqual({ kind: 'factor', value: 0.4 })
  })

  it('구간마다 다르면 손대지 않는다', () => {
    // 우리 모델은 엔티티당 높이가 하나뿐이다. 한 구간의 값을 문장 전체에
    // 씌우면 틀린 쪽이 더 커진다 — 그럴 땐 gc 40 이 낫다.
    expect(mtextHeightOverride('{\\H0.4x;작게}{\\H2x;크게}')).toBeNull()
    expect(mtextHeightOverride('{\\H600;절대}{\\H0.4x;배율}')).toBeNull()
  })

  it('말이 안 되는 값은 무시한다', () => {
    expect(mtextHeightOverride('{\\H0x;가}')).toBeNull()
    expect(mtextHeightOverride('{\\H0;가}')).toBeNull()
  })

  it('소수·정수·대소문자를 다 받는다', () => {
    expect(mtextHeightOverride('{\\H1.5000x;가}')).toEqual({ kind: 'factor', value: 1.5 })
    expect(mtextHeightOverride('{\\H2x;가}')).toEqual({ kind: 'factor', value: 2 })
    expect(mtextHeightOverride('{\\h0.5X;가}')).toEqual({ kind: 'factor', value: 0.5 })
  })

  it('cleanMtextFormatting 은 여전히 글자만 남긴다', () => {
    // 이 둘은 짝이다. 읽기는 지우기 **전에** 일어나야 한다.
    expect(cleanMtextFormatting(REAL)).toBe('11/11_최종')
  })
})
