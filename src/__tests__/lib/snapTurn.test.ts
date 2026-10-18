/**
 * 앞 구간 기준 **직각 꺾기**.
 *
 * 15° 직교 스냅(`snapAngle`)은 **화면 축**을 기준으로 돈다. 앞 벽이 축에
 * 나란하면 90° 가 15 의 배수라 저절로 맞지만, 앞 벽이 37° 로 비스듬하면
 * 아무리 조심해도 직각이 안 나온다. 평면도에서 벽은 거의 다 직각으로 꺾이므로
 * 그게 그대로 손해다.
 *
 * 여기서 보는 건 두 가지다.
 *   1. 가까우면 **정확히** 직각으로 붙는가 (대충이 아니라)
 *   2. 멀면 **안 건드리는가** — 비스듬한 벽을 그리려는 사람을 막으면 안 된다
 */
import { describe, it, expect } from 'vitest'
import { snapToTurn } from '../../lib/snap'

const S = { x: 100, y: 100 }

/** 시작점에서 `deg` 방향 `len` 만큼 간 점 (화면 좌표: y 가 아래로) */
function at(deg: number, len = 50) {
  const r = (deg * Math.PI) / 180
  return { x: S.x + Math.cos(r) * len, y: S.y + Math.sin(r) * len }
}

/** 시작점 기준 방향각(도), (-180, 180] */
function dirOf(p: { x: number; y: number }) {
  return (Math.atan2(p.y - S.y, p.x - S.x) * 180) / Math.PI
}

describe('snapToTurn', () => {
  const east = { x: 10, y: 0 }

  it('직각에 가까우면 **정확히** 직각으로 붙는다', () => {
    // 87° 로 꺾으려던 걸 90° 로. 0.1° 만 어긋나도 평면도에서는 틀린 것이다.
    const r = snapToTurn(S, at(87), east)
    expect(r).not.toBeNull()
    expect(dirOf(r!)).toBeCloseTo(90, 6)
    expect(r!.snapType).toBe('turn')
  })

  it('길이는 커서가 간 만큼 그대로 둔다 — 각만 바로잡는다', () => {
    const r = snapToTurn(S, at(87, 123.4), east)!
    expect(Math.hypot(r.x - S.x, r.y - S.y)).toBeCloseTo(123.4, 6)
  })

  it('**앞 구간이 비스듬해도** 직각이 나온다', () => {
    // 이게 15° 직교로는 안 되는 경우다. 앞 벽 37°, 거기서 직각이면 127°.
    const prev = { x: Math.cos(0.6458), y: Math.sin(0.6458) }   // ≈37°
    const prevDeg = (Math.atan2(prev.y, prev.x) * 180) / Math.PI
    const r = snapToTurn(S, at(prevDeg + 86), prev)
    expect(r).not.toBeNull()
    expect(dirOf(r!)).toBeCloseTo(prevDeg + 90, 6)
  })

  it('멀면 건드리지 않는다 — 비스듬한 벽도 그릴 수 있어야 한다', () => {
    // 45° 는 직각에서 45° 떨어져 있다. 여기까지 당기면 사선 벽을 못 그린다.
    expect(snapToTurn(S, at(45), east)).toBeNull()
    expect(snapToTurn(S, at(70), east)).toBeNull()
  })

  it('울타리 바로 안팎이 갈린다', () => {
    expect(snapToTurn(S, at(81), east, 10)).not.toBeNull()   // 9° 어긋남
    expect(snapToTurn(S, at(79), east, 10)).toBeNull()       // 11° 어긋남
  })

  it('0°·180°·270° 도 직각의 배수다', () => {
    // 되돌아오기(180°)와 곧게 잇기(0°)도 "쫙" 붙어야 한다.
    expect(dirOf(snapToTurn(S, at(3), east)!)).toBeCloseTo(0, 6)
    expect(Math.abs(dirOf(snapToTurn(S, at(177), east)!))).toBeCloseTo(180, 6)
    expect(dirOf(snapToTurn(S, at(-87), east)!)).toBeCloseTo(-90, 6)
  })

  it('경계를 돌아도 맞는다 (-180/180 이 만나는 자리)', () => {
    // 각을 접는 걸 빠뜨리면 여기서 엉뚱한 배수로 간다.
    const r = snapToTurn(S, at(-179), east)
    expect(r).not.toBeNull()
    expect(Math.abs(dirOf(r!))).toBeCloseTo(180, 6)
  })

  it('길이가 없으면 방향이 없다 — null', () => {
    // 0 으로 나누면 NaN 이 번져서 벽이 화면에서 사라진다.
    expect(snapToTurn(S, { x: S.x, y: S.y }, east)).toBeNull()
    expect(snapToTurn(S, at(90), { x: 0, y: 0 })).toBeNull()
  })

  it('돌려준 점에 NaN 이 없다', () => {
    for (const deg of [0, 89, 90, 91, 179, -179, -90]) {
      const r = snapToTurn(S, at(deg), east)
      if (r) expect(Number.isFinite(r.x) && Number.isFinite(r.y)).toBe(true)
    }
  })
})
