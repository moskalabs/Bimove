/**
 * dxfFingerprint + 레이어 이름 분류.
 *
 * ── 2026-10-19: 파서 테스트와 DXF 픽스처를 걷어냈다 ──
 *
 * `parseDxfSegments` 테스트와 `DxfParser compatibility` 블록이 여기 있었다.
 * 앞쪽은 아무도 안 부르는 죽은 함수를 봤고(원문이 아니라 이미 파싱된 엔티티
 * 객체를 받던 함수다 — 그 입력을 만들어 주던 경로가 먼저 지워졌다), 뒤쪽은
 * **우리 코드가 아니라 dxf-parser(npm) 라이브러리**를 검증하고 있었다.
 * 그 패키지는 이제 프로덕션에서 안 쓰므로 의존성에서도 뺐다.
 *
 * 같이 있던 DXF 원문 픽스처 세 개(약 280줄)도 쓰는 데가 없어서 지웠다.
 */
import { describe, it, expect } from 'vitest'
import { dxfFingerprint } from '../../lib/dxf'

describe('dxfFingerprint', () => {
  it('returns consistent fingerprint', () => {
    expect(dxfFingerprint('test.dxf', 1234, 7)).toBe('dxf:test.dxf:1234:7')
  })

  it('different inputs produce different fingerprints', () => {
    const a = dxfFingerprint('a.dxf', 100, 5)
    const b = dxfFingerprint('b.dxf', 100, 5)
    expect(a).not.toBe(b)
  })
})


describe('STRUCTURAL_KEYWORDS matching', () => {
  // 내부 정규식 테스트를 위해 동일 패턴 사용
  const STRUCTURAL_KEYWORDS = /wall|window|win(?!ter)|door|stair|column|beam|slab|elev|건축|벽|창문|문/i

  it('matches wall-related layers', () => {
    expect(STRUCTURAL_KEYWORDS.test('E-WALL-1')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('CO-WALL')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('F_WALL')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('WALL')).toBe(true)
  })

  it('matches window layers', () => {
    expect(STRUCTURAL_KEYWORDS.test('E-WIN')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('CO-WIN')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('WINDOW')).toBe(true)
  })

  it('matches door layers', () => {
    expect(STRUCTURAL_KEYWORDS.test('C-DOOR')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('E-DOOR')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('F-DOOR')).toBe(true)
  })

  it('does NOT match furniture/text/dimension layers', () => {
    expect(STRUCTURAL_KEYWORDS.test('E-FUR-k')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('E-FUR-1')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('F-TEXT')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('C-DIM')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('DEFPOINTS')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('TB-FORM')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('E-HAT')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('F-SYM')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('C-LIGHT')).toBe(false)
  })

  it('does NOT match D-STONE, D-STEEL (was matching via "str")', () => {
    expect(STRUCTURAL_KEYWORDS.test('D-STONE')).toBe(false)
    expect(STRUCTURAL_KEYWORDS.test('D-STEEL')).toBe(false)
  })

  it('matches stair/column/beam/slab layers', () => {
    expect(STRUCTURAL_KEYWORDS.test('F-STAIR')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('S-COLUMN')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('S-BEAM')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('F-SLAB')).toBe(true)
  })

  it('matches Korean structural keywords', () => {
    expect(STRUCTURAL_KEYWORDS.test('건축-벽')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('창문레이어')).toBe(true)
    expect(STRUCTURAL_KEYWORDS.test('문-1')).toBe(true)
  })
})

