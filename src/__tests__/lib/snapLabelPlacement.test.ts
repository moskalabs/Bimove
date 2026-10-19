/**
 * 그리는 중인 구간의 **라벨 자리**.
 *
 * 전엔 길이를 중점 바로 위에 **가로로** 얹었다. 선 위에 글자가 올라타서,
 * 세로 벽에서는 글자가 선을 가로지르고 가로 벽에서는 벽을 덮는다. 한이 보낸
 * Rayon 화면은 글자를 **벽을 따라 돌리고 옆으로 비켜** 놓는다 — 그래야 선도
 * 글자도 다 보인다. 그 자리를 여기서 잰다.
 *
 * 화면(viewport) 좌표라 **y 가 아래로** 간다. 그 좌표계에서 진행 방향의
 * 왼쪽은 `(dy, -dx)` 다 — 부호를 뒤집으면 라벨이 선 반대쪽으로 넘어간다.
 */
import { describe, it, expect } from 'vitest'
import { labelPlacement } from '../../lib/snap'

const O = { x: 0, y: 0 }

describe('labelPlacement', () => {
  it('오른쪽으로 긋는 중이면 라벨은 **위**로 비킨다', () => {
    // 화면 좌표에서 진행 방향(+x)의 왼쪽은 −y, 즉 위쪽이다.
    const r = labelPlacement({ x: 50, y: 0 }, O, { x: 100, y: 0 }, 18)
    expect(r.x).toBeCloseTo(50, 9)
    expect(r.y).toBeCloseTo(-18, 9)
    expect(r.deg).toBeCloseTo(0, 9)
  })

  it('아래로 긋는 중이면 **오른쪽**으로 비키고 글자가 선을 따라 선다', () => {
    const r = labelPlacement({ x: 0, y: 50 }, O, { x: 0, y: 100 }, 18)
    expect(r.x).toBeCloseTo(18, 9)
    expect(r.y).toBeCloseTo(50, 9)
    expect(r.deg).toBeCloseTo(90, 9)
  })

  it('왼쪽으로 긋어도 글자가 **거꾸로 서지 않는다**', () => {
    // 180° 그대로 쓰면 글자가 뒤집힌다. 반 바퀴 접어 0 으로 만든다.
    const r = labelPlacement({ x: -50, y: 0 }, O, { x: -100, y: 0 }, 18)
    expect(r.deg).toBeCloseTo(0, 9)
  })

  it('접어도 **놓는 자리는 안 바뀐다** — 선 반대쪽으로 넘어가면 안 된다', () => {
    // 왼쪽으로 긋는 중의 왼쪽은 아래(+y)다. 글자만 돌리고 자리는 그대로.
    const r = labelPlacement({ x: -50, y: 0 }, O, { x: -100, y: 0 }, 18)
    expect(r.y).toBeCloseTo(18, 9)
  })

  it('비스듬해도 선과 나란하다', () => {
    const r = labelPlacement({ x: 50, y: 50 }, O, { x: 100, y: 100 }, 0)
    expect(r.deg).toBeCloseTo(45, 9)
  })

  it('글자 각은 늘 (-90, 90] — 어느 방향이든 읽을 수 있다', () => {
    for (let d = 0; d < 360; d += 7) {
      const r = (d * Math.PI) / 180
      const end = { x: Math.cos(r) * 100, y: Math.sin(r) * 100 }
      const p = labelPlacement({ x: end.x / 2, y: end.y / 2 }, O, end, 18)
      expect(p.deg).toBeGreaterThan(-90.000001)
      expect(p.deg).toBeLessThanOrEqual(90.000001)
    }
  })

  it('떨어뜨린 거리가 정확히 offsetPx 다', () => {
    for (const d of [0, 37, 90, 211, 300]) {
      const r = (d * Math.PI) / 180
      const end = { x: Math.cos(r) * 100, y: Math.sin(r) * 100 }
      const mid = { x: end.x / 2, y: end.y / 2 }
      const p = labelPlacement(mid, O, end, 18)
      expect(Math.hypot(p.x - mid.x, p.y - mid.y)).toBeCloseTo(18, 6)
    }
  })

  it('길이가 0 이면 그 자리에 그대로 (0 으로 나누지 않는다)', () => {
    const r = labelPlacement({ x: 7, y: 9 }, O, O, 18)
    expect(r).toEqual({ x: 7, y: 9, deg: 0 })
  })
})
