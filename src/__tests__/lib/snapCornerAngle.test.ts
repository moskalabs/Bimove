/**
 * 코너에 띄우는 **내각**.
 *
 * 전엔 "꺾임 각" 을 띄웠다 — 곧게 이어가면 0, 직각이면 90 이 되는 값이다.
 * 직각에서는 내각과 같아서 차이가 안 보였는데, 한이 Rayon 의 **부채꼴
 * 가이드**를 보내면서 갈렸다. 가이드는 두 벽 **사이**를 칠하므로 그 각은
 * 내각이다. 120° 를 칠해 놓고 "60°" 라고 적으면 둘 다 못 믿게 된다.
 *
 * 그래서 숫자도 내각으로 바꿨다. 직각 90, 곧게 이어가기 180, 되접기 0.
 */
import { describe, it, expect } from 'vitest'
import { cornerAngleDeg } from '../../lib/snap'

/** 둘 다 **코너에서 바깥으로** 향하는 방향이다. */
const LEFT = { x: -10, y: 0 }

describe('cornerAngleDeg', () => {
  it('직각이면 90 — 어느 쪽으로 꺾든 같다', () => {
    expect(cornerAngleDeg(LEFT, { x: 0, y: 7 })).toBeCloseTo(90, 9)
    expect(cornerAngleDeg(LEFT, { x: 0, y: -7 })).toBeCloseTo(90, 9)
  })

  it('곧게 이어가면 180 — 안 꺾었다는 뜻이다', () => {
    // 앞 벽은 왼쪽으로 뻗고 지금은 오른쪽으로 긋는다 = 일직선.
    expect(cornerAngleDeg(LEFT, { x: 5, y: 0 })).toBeCloseTo(180, 9)
  })

  it('왔던 길 위로 되접으면 0', () => {
    expect(cornerAngleDeg(LEFT, { x: -3, y: 0 })).toBeCloseTo(0, 6)
  })

  it('옛 "꺾임 각" 과 **더해서 180** 이 된다 (같은 코너의 두 표현)', () => {
    // 예전 숫자가 60 이던 자리는 이제 120 이다. 한이 보던 화면이 그렇게 바뀐다.
    const a = (deg: number) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) })
    // 앞 벽이 들어온 방향 = 0°, 따라서 바깥으로는 180°.
    const inner = cornerAngleDeg(a(180), a(60))
    expect(inner).toBeCloseTo(120, 6)
  })

  it('앞 벽이 비스듬해도 **그 벽 기준**이다 — 절대 각이 아니다', () => {
    // 37° 로 누운 벽에서 직각으로 꺾으면 화면 축 기준으론 127° 지만 내각은 90 이다.
    const a = (deg: number) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) })
    expect(cornerAngleDeg(a(37 + 180), a(127))).toBeCloseTo(90, 6)
  })

  it('길이는 안 본다 — 방향만 쓴다', () => {
    expect(cornerAngleDeg({ x: -1000, y: 0 }, { x: 0, y: 0.001 })).toBeCloseTo(90, 6)
  })

  it('방향이 없으면 0 (0 으로 나누지 않는다)', () => {
    expect(cornerAngleDeg({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0)
    expect(cornerAngleDeg({ x: 1, y: 0 }, { x: 0, y: 0 })).toBe(0)
  })

  it('나란한 벡터에서 NaN 이 안 나온다 (acos 의 |x|>1)', () => {
    // 정규화 오차로 내적이 1.0000000000000002 가 되면 acos 가 NaN 이다.
    const v = { x: 0.1 + 0.2, y: 0.3 }   // 부동소수로 딱 안 떨어지는 값
    expect(Number.isNaN(cornerAngleDeg(v, v))).toBe(false)
    // ±1 근처에서 acos 는 입력 오차를 √ 로 키운다 (10⁻¹⁶ → 10⁻⁸ rad).
    // 그래서 0.000001° 쯤은 남는다 — 화면에 소수 한 자리로 찍는 값이라 무해하다.
    expect(cornerAngleDeg(v, v)).toBeCloseTo(0, 4)
    expect(cornerAngleDeg(v, { x: -v.x, y: -v.y })).toBeCloseTo(180, 4)
  })

  it('결과는 늘 0..180', () => {
    const a = (deg: number) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) })
    for (let d = -400; d <= 400; d += 7) {
      const v = cornerAngleDeg(a(13), a(d))
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(180.000001)
    }
  })
})
