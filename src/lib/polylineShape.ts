// 폴리라인 점들 → tldraw line shape 의 좌표/props.
//
// tldraw 의 line 은 점을 **딕셔너리**로 들고, 순서는 키가 아니라 각 점의
// `index`(분수 인덱스)로 정해진다. 그냥 배열을 넣으면 안 되고, shape 의 x/y 는
// 첫 점에 두고 나머지를 거기서의 상대 좌표로 넣어야 한다.

import { getIndices, type IndexKey } from 'tldraw'

export type LinePoint = { id: string; index: IndexKey; x: number; y: number }
export type LinePoints = Record<string, LinePoint>

export type LineShapeGeometry = {
  /** shape 원점 (page 좌표) = 첫 점 */
  x: number
  y: number
  /** 원점 기준 상대 좌표의 점 딕셔너리 */
  points: LinePoints
}

/**
 * 점 목록을 line shape 의 좌표계로 옮긴다.
 *
 * 점이 둘 미만이면 선이 아니므로 null. 호출부가 shape 을 만들지 말지
 * 여기서 가른다 — 점 하나짜리 line 은 tldraw 에서 보이지도 집히지도 않는다.
 */
export function lineShapeFromPoints(pts: Array<{ x: number; y: number }>): LineShapeGeometry | null {
  if (pts.length < 2) return null
  const origin = pts[0]
  const keys = getIndices(pts.length)
  const points: LinePoints = {}
  pts.forEach((p, i) => {
    points[keys[i]] = {
      id: keys[i],
      index: keys[i],
      x: p.x - origin.x,
      y: p.y - origin.y,
    }
  })
  return { x: origin.x, y: origin.y, points }
}
