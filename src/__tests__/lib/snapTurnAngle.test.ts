/**
 * 코너에 띄우는 **꺾임 각**.
 *
 * 한이 화면을 보내왔는데 파란 알약 두 개가 같이 떠 있었다 — "180.0°" 와
 * "90.0°". 둘 다 맞는 값이었다. 하나는 화면 축 기준 **절대** 방향(왼쪽으로
 * 그었으니 180°)이고 하나는 앞 벽 기준 **꺾임**(직각이니 90°)이다. 나란히
 * 놓으면 어느 게 직각인지 알 수가 없어서 절대 각은 첫 구간에만 띄우기로 했다.
 *
 * 여기서는 남는 쪽, 그러니까 꺾임 각 계산을 묶는다. 곧게 = 0, 직각 = 90,
 * 되돌아가기 = 180 이다.
 */
import { describe, it, expect } from 'vitest'
import { turnMagnitudeDeg } from '../../lib/snap'

const RIGHT = { x: 10, y: 0 }

describe('turnMagnitudeDeg', () => {
  it('곧게 이어가면 0', () => {
    expect(turnMagnitudeDeg(RIGHT, { x: 5, y: 0 })).toBeCloseTo(0, 9)
  })

  it('직각이면 90 — 어느 쪽으로 꺾든 같다', () => {
    // 부호를 안 붙인다. 좌/우는 화면에서 바로 보이고, "-90도" 는 또 설명해야 한다.
    expect(turnMagnitudeDeg(RIGHT, { x: 0, y: 7 })).toBeCloseTo(90, 9)
    expect(turnMagnitudeDeg(RIGHT, { x: 0, y: -7 })).toBeCloseTo(90, 9)
  })

  it('왔던 길로 되돌아가면 180', () => {
    expect(turnMagnitudeDeg(RIGHT, { x: -3, y: 0 })).toBeCloseTo(180, 9)
  })

  it('350° 를 "10도 꺾임" 으로 본다 (접지 않으면 350 이 뜬다)', () => {
    const a = (deg: number) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) })
    expect(turnMagnitudeDeg(a(0), a(350))).toBeCloseTo(10, 6)
    expect(turnMagnitudeDeg(a(350), a(0))).toBeCloseTo(10, 6)
  })

  it('앞 벽이 비스듬해도 **그 벽 기준**이다 — 절대 각이 아니다', () => {
    // 이게 절대 각과 갈리는 지점이다. 37° 로 누운 벽에서 직각으로 꺾으면
    // 화면 축 기준으론 127° 지만, 우리가 보고 싶은 건 90 이다.
    const a = (deg: number) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) })
    expect(turnMagnitudeDeg(a(37), a(127))).toBeCloseTo(90, 6)
  })

  it('한 바퀴를 넘겨도 접힌다', () => {
    const a = (deg: number) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) })
    for (const d of [-720, -365, 365, 725]) {
      expect(turnMagnitudeDeg(a(0), a(d))).toBeLessThanOrEqual(180.000001)
      expect(turnMagnitudeDeg(a(0), a(d))).toBeGreaterThanOrEqual(0)
    }
  })

  it('결과는 늘 0..180', () => {
    const a = (deg: number) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) })
    for (let d = -400; d <= 400; d += 7) {
      const v = turnMagnitudeDeg(a(13), a(d))
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(180.000001)
    }
  })
})
