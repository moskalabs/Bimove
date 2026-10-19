/**
 * 코너의 **각도 호**.
 *
 * 한이 "각도 부분 파란색으로 각도 원 느낌으로 어느 정도인지 파악되게 가이드"
 * 라고 했다. 숫자만 있으면 "60.0°" 가 얼마나 벌어진 건지 머리로 그려야 한다.
 *
 * 여기서 보는 건 셋이다 — 늘 **짧은 쪽**으로 도는가, 숫자를 호 바깥에 놓는가,
 * 그릴 게 없을 때 null 을 주는가.
 */
import { describe, it, expect } from 'vitest'
import { angleArc } from '../../lib/angleArc'

const R = 34
/** `A rx ry rot large sweep x y` 에서 large/sweep 만 뽑는다. */
function flags(d: string): { large: string; sweep: string } {
  const m = /A[\d. ]+ 0 (\d) (\d) /.exec(d)
  if (!m) throw new Error(`호를 못 읽었다: ${d}`)
  return { large: m[1], sweep: m[2] }
}

describe('angleArc', () => {
  it('90° 꺾임 — 호를 그리고 **긴 쪽으로 안 돈다**', () => {
    // 앞 벽은 왼쪽으로 뻗어 있고(기준), 지금은 아래로 긋는다.
    const a = angleArc(100, 100, -1, 0, 0, 1, R)!
    expect(a).not.toBeNull()
    expect(flags(a.d).large).toBe('0')     // 270° 로 돌면 안 된다
  })

  it('도는 쪽이 꺾은 쪽을 따라간다', () => {
    // 화면 좌표는 y 가 아래로 가므로 각이 커지는 방향이 sweep=1 이다.
    expect(flags(angleArc(0, 0, 1, 0, 0, 1, R)!.d).sweep).toBe('1')   // +90°
    expect(flags(angleArc(0, 0, 1, 0, 0, -1, R)!.d).sweep).toBe('0')  // −90°
  })

  it('완전히 되접히면 null — 점으로 뭉갠 쐐기는 쓸모가 없다', () => {
    // 내각 0° = 왔던 길 위로 되돌아간다.
    expect(angleArc(0, 0, 1, 0, 1, 0.01, R)).toBeNull()
  })

  it('한 바퀴 넘겨도 짧은 쪽으로 접는다', () => {
    // 270° 를 그대로 쓰면 거의 원이 그려진다. 접으면 −90° 다.
    const r = (270 * Math.PI) / 180
    const a = angleArc(0, 0, 1, 0, Math.cos(r), Math.sin(r), R)!
    expect(flags(a.d).large).toBe('0')
    expect(flags(a.d).sweep).toBe('0')
  })

  it('숫자는 호 **바깥 한가운데**에 놓는다', () => {
    // 오른쪽(0°)에서 아래(90°)로 꺾으면 가운데는 45° 다.
    const a = angleArc(0, 0, 1, 0, 0, 1, R)!
    const d = Math.hypot(a.labelX, a.labelY)
    expect(d).toBeCloseTo(R + 16, 6)       // 쐐기보다 바깥
    expect(a.labelX).toBeCloseTo(a.labelY, 6)  // 45° 방향
  })

  it('**채워지는 부채꼴**이다 — 코너에서 시작해 닫힌다', () => {
    // 가는 호가 아니라 면이어야 한다. Rayon 도 옅게 칠한 쐐기다.
    const a = angleArc(50, 60, -1, 0, 0, 1, R)!
    expect(a.d.startsWith('M50.00 60.00 L')).toBe(true)  // 코너에서 출발
    expect(a.d.endsWith('Z')).toBe(true)                  // 닫는다 (= 채울 수 있다)
  })

  it('곧게 이어가면 null — 반원을 칠하면 안 된다', () => {
    // 내각 180° 는 "안 꺾었다" 는 뜻이다. 그려 봐야 화면 절반이 파래진다.
    expect(angleArc(0, 0, -1, 0, 1, 0.01, R)).toBeNull()
  })

  it('반지름이 0 이거나 방향이 없으면 null (0 으로 나누지 않는다)', () => {
    expect(angleArc(0, 0, 1, 0, 0, 1, 0)).toBeNull()
    expect(angleArc(0, 0, 0, 0, 0, 1, R)).toBeNull()
    expect(angleArc(0, 0, 1, 0, 0, 0, R)).toBeNull()
  })

  it('어느 각이든 좌표에 NaN 이 없다', () => {
    for (let deg = 2; deg < 358; deg += 5) {
      const r = (deg * Math.PI) / 180
      const a = angleArc(50, 50, 1, 0, Math.cos(r), Math.sin(r), R)
      if (!a) continue
      expect(a.d).not.toMatch(/NaN/)
      expect(Number.isFinite(a.labelX) && Number.isFinite(a.labelY)).toBe(true)
    }
  })
})
