/**
 * 폴리라인 → tldraw line shape 좌표 변환 테스트.
 *
 * tldraw 의 line 은 점을 **딕셔너리**로 들고 순서는 각 점의 `index` 로 정해진다.
 * shape 의 x/y 는 첫 점에 두고 나머지는 거기서의 상대 좌표여야 한다. 하나라도
 * 어긋나면 선이 엉뚱한 자리에 그려지거나 점 순서가 뒤집힌다.
 */
import { describe, it, expect } from 'vitest'
import { lineShapeFromPoints } from '../../lib/polylineShape'

describe('lineShapeFromPoints', () => {
  it('점이 둘 미만이면 만들지 않는다', () => {
    // 점 하나짜리 line 은 tldraw 에서 보이지도 집히지도 않는다.
    expect(lineShapeFromPoints([])).toBeNull()
    expect(lineShapeFromPoints([{ x: 10, y: 20 }])).toBeNull()
  })

  it('shape 원점은 첫 점이고 나머지는 상대 좌표다', () => {
    const geo = lineShapeFromPoints([
      { x: 100, y: 200 },
      { x: 150, y: 200 },
      { x: 150, y: 260 },
    ])!
    expect(geo.x).toBe(100)
    expect(geo.y).toBe(200)

    const inOrder = Object.values(geo.points).sort((a, b) => (a.index < b.index ? -1 : 1))
    expect(inOrder.map(p => [p.x, p.y])).toEqual([[0, 0], [50, 0], [50, 60]])
  })

  it('index 순서가 찍은 순서와 같다', () => {
    // 분수 인덱스는 사전순으로 비교한다. 여기가 어긋나면 선이 지그재그가 된다.
    const pts = Array.from({ length: 6 }, (_, i) => ({ x: i * 10, y: i * i }))
    const geo = lineShapeFromPoints(pts)!
    const inOrder = Object.values(geo.points).sort((a, b) => (a.index < b.index ? -1 : 1))
    expect(inOrder.map(p => p.x)).toEqual([0, 10, 20, 30, 40, 50])
    expect(inOrder.map(p => p.y)).toEqual([0, 1, 4, 9, 16, 25])
  })

  it('딕셔너리 키와 점의 id/index 가 서로 같다', () => {
    // tldraw 가 키로 찾고 index 로 정렬하므로 셋이 어긋나면 안 된다.
    const geo = lineShapeFromPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }])!
    for (const [key, p] of Object.entries(geo.points)) {
      expect(p.id).toBe(key)
      expect(p.index).toBe(key)
    }
  })

  it('점 개수만큼 들어간다 (같은 자리를 두 번 찍어도)', () => {
    const geo = lineShapeFromPoints([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 },
    ])!
    expect(Object.keys(geo.points)).toHaveLength(4)
  })
})
