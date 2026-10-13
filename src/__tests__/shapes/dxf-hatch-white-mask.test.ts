/**
 * 흰색 단색(SOLID) 해치는 CAD 의 마스킹(가리개) 관용구다 — 종이색과 같아서
 * 원본에서는 안 보이고, 뒤에 깔린 선만 가린다. 그걸 그대로 칠하면 안 된다.
 *
 * 리닝 도면(26.08.07_리닝.dwg) 의 F-1 레이어가 바로 이 경우였다:
 * 솔리드 해치 48개가 전부 pat=SOLID, 거의 전부 col=#ffffff — 화분/사람/싱크
 * 블록 안의 가리개. darkenForLightBg('#ffffff') 가 #737373 을 돌려주고
 * opacity 0.85 로 깔려서, 평면도 위에 반투명 회색 원반/꽃잎이 생겼다.
 */
import { describe, it, expect } from 'vitest'
import { isMaskHatch } from '../../shapes/DxfGroupShape'

type H = Parameters<typeof isMaskHatch>[0]
const hatch = (o: Partial<H>): H => ({ d: 'M0,0L10,0L10,10Z', p: 'SOLID', s: 1, a: 0, ...o })

describe('흰색 마스킹 해치', () => {
  it('흰색 단색 해치는 마스킹으로 본다', () => {
    expect(isMaskHatch(hatch({ p: 'SOLID', f: 1, c: '#ffffff' }))).toBe(true)
  })

  it('거의 흰색도 마스킹이다 (#f0f0f0)', () => {
    expect(isMaskHatch(hatch({ p: 'SOLID', f: 1, c: '#f0f0f0' }))).toBe(true)
  })

  it('패턴명이 "SOLID,_O" 인 변종도 잡는다', () => {
    expect(isMaskHatch(hatch({ p: 'SOLID,_O', c: '#ffffff' }))).toBe(true)
  })

  it('회색/어두운 단색 해치는 그대로 칠한다', () => {
    expect(isMaskHatch(hatch({ p: 'SOLID', f: 1, c: '#808080' }))).toBe(false)
    expect(isMaskHatch(hatch({ p: 'SOLID', f: 1, c: '#333333' }))).toBe(false)
    expect(isMaskHatch(hatch({ p: 'SOLID', f: 1, c: '#7fcc66' }))).toBe(false)
  })

  it('색이 없는 단색 해치는 건드리지 않는다 (기본색 #666 로 보이는 게 현재 동작)', () => {
    expect(isMaskHatch(hatch({ p: 'SOLID', f: 1 }))).toBe(false)
  })

  it('흰색이어도 패턴 해치는 마스킹이 아니다 — 패턴선은 어둡게 보정해서 보여준다', () => {
    expect(isMaskHatch(hatch({ p: 'ANSI31', f: 0, c: '#ffffff' }))).toBe(false)
  })
})
