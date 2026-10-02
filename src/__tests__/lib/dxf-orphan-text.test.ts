/**
 * 고립 텍스트 보존 회귀 테스트
 *
 * 텍스트는 **같은 레이어의** 지오메트리 클러스터에만 붙는다. 그런데 도면은
 * 보통 문자를 전용 레이어(TEXT, 문자 …)에 몰아넣으므로 사실상 모든 텍스트가
 * "고립" 으로 분류된다. 예전 코드는 고립 텍스트가 2000개를 넘으면
 * `return []` 로 통째로 버렸고 로그도 없었다 — 도면에서 글자가 전부 사라져도
 * 아무 흔적이 안 남는다. 텍스트는 한 글자도 버리지 않아야 한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildOrphanTextShapes } from '../../lib/dxf'

type ShapeLike = { props: { textsJson: string; w: number; h: number } }
type TextEntry = { t: string }

function makeTexts(n: number): Array<{ x: number; y: number; text: string; height: number; layer: string }> {
  // 100 x N 격자로 흩뿌린다 (한 덩어리로 뭉치지 않도록 간격을 크게)
  return Array.from({ length: n }, (_, i) => ({
    x: (i % 100) * 1000,
    y: Math.floor(i / 100) * 1000,
    text: `T${i}`,
    height: 10,
    layer: 'TEXT',
  }))
}

/** 생성된 shape 들에 들어 있는 텍스트 전부 */
function textsIn(shapes: unknown[]): string[] {
  return (shapes as ShapeLike[]).flatMap(
    sh => (JSON.parse(sh.props.textsJson) as TextEntry[]).map(t => t.t),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('buildOrphanTextShapes', () => {
  it('고립 텍스트가 2000개를 넘어도 한 개도 버리지 않는다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const texts = makeTexts(5000)
    const shapes = buildOrphanTextShapes(texts, new Set(), 0, 0, 'fp')

    const kept = textsIn(shapes)
    expect(kept).toHaveLength(5000)
    expect(new Set(kept).size).toBe(5000)        // 중복 없이 전부
  })

  it('shape 수는 상한 안에 묶인다 (격자 재묶음)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const shapes = buildOrphanTextShapes(makeTexts(5000), new Set(), 0, 0, 'fp')

    expect(shapes.length).toBeGreaterThan(0)
    expect(shapes.length).toBeLessThanOrEqual(1500)
  })

  it('적은 수는 기존 근접 그룹핑 그대로', () => {
    const texts = makeTexts(12)
    const shapes = buildOrphanTextShapes(texts, new Set(), 0, 0, 'fp')

    expect(textsIn(shapes).sort()).toEqual(texts.map(t => t.text).sort())
    expect(shapes.length).toBeLessThanOrEqual(12)
  })

  it('이미 배정된 텍스트는 제외한다', () => {
    const texts = makeTexts(10)
    const assigned = new Set([0, 1, 2])
    const shapes = buildOrphanTextShapes(texts, assigned, 0, 0, 'fp')

    const kept = textsIn(shapes).sort()
    expect(kept).toEqual(['T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'].sort())
  })

  it('고립 텍스트가 없으면 shape 도 없다', () => {
    expect(buildOrphanTextShapes([], new Set(), 0, 0, 'fp')).toEqual([])

    const texts = makeTexts(3)
    expect(buildOrphanTextShapes(texts, new Set([0, 1, 2]), 0, 0, 'fp')).toEqual([])
  })

  it('shape 의 w/h 는 양수 (격자 재묶음 경로에서도)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const shapes = buildOrphanTextShapes(makeTexts(5000), new Set(), 0, 0, 'fp') as ShapeLike[]

    expect(shapes.every(sh => sh.props.w > 0 && sh.props.h > 0)).toBe(true)
  })
})
