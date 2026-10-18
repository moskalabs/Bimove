/**
 * 보조선 — "위 벽이랑 끝 맞추기".
 *
 * 평면도에서 제일 많이 하는 일이 그건데, 끝점 스냅은 그 점에 **붙을 때**만
 * 걸린다. 맞추고 싶은 건 대개 멀리 떨어진 채로 x 나 y 만 같은 자리다.
 *
 * 핵심은 **각을 안 깨는 것**이다. 좌표 하나를 억지로 맞추면 방금 맞춘 직각이
 * 틀어진다. 그래서 방향은 그대로 두고 **그 방향 위에서** 보조선과 만나는 점을
 * 찾는다 — 각은 유지되고 길이만 달라진다.
 */
import { describe, it, expect } from 'vitest'
import { slideAlongTo, type AlignGuide } from '../../lib/snap'

const S = { x: 0, y: 0 }
const guideX = (at: number): AlignGuide => ({ axis: 'x', at, through: { x: at, y: -999 } })
const guideY = (at: number): AlignGuide => ({ axis: 'y', at, through: { x: -999, y: at } })

describe('slideAlongTo', () => {
  it('방향을 지킨 채 세로 보조선까지 간다', () => {
    // 오른쪽으로 긋는 중, x=160 에 맞출 자리가 있다.
    const r = slideAlongTo(S, { x: 100, y: 0 }, [guideX(160)])
    expect(r).not.toBeNull()
    expect(r!.point).toEqual({ x: 160, y: 0 })
  })

  it('비스듬한 방향도 각이 그대로다', () => {
    // 45° 로 긋는 중 x=50 에 맞추면 y 도 50 이어야 한다 (각이 유지됐다는 뜻).
    const r = slideAlongTo(S, { x: 1, y: 1 }, [guideX(50)])!
    expect(r.point.x).toBeCloseTo(50, 9)
    expect(r.point.y).toBeCloseTo(50, 9)
  })

  it('방향과 나란한 보조선은 **안 쓴다**', () => {
    // 가로로 긋는데 가로 보조선(y=…)은 아무리 가도 안 만난다.
    expect(slideAlongTo(S, { x: 100, y: 0 }, [guideY(80)])).toBeNull()
    expect(slideAlongTo(S, { x: 0, y: 100 }, [guideX(80)])).toBeNull()
  })

  it('뒤로 가는 건 안 쓴다 — 벽이 뒤집힌다', () => {
    // 오른쪽으로 긋는데 맞출 자리가 왼쪽이면, 거기로 끌면 벽이 반대로 뻗는다.
    expect(slideAlongTo(S, { x: 100, y: 0 }, [guideX(-50)])).toBeNull()
  })

  it('둘 다 만나면 **가까운 쪽**으로 간다', () => {
    const r = slideAlongTo(S, { x: 1, y: 1 }, [guideX(200), guideY(50)])!
    expect(r.point.x).toBeCloseTo(50, 9)
    expect(r.used.axis).toBe('y')
  })

  it('어느 쪽에 맞췄는지 알려준다 — 그걸 그려야 한다', () => {
    const r = slideAlongTo(S, { x: 100, y: 0 }, [guideX(160)])!
    expect(r.used).toEqual(guideX(160))
  })

  it('길이가 없는 방향이면 null (0 으로 나누지 않는다)', () => {
    expect(slideAlongTo(S, { x: 0, y: 0 }, [guideX(10)])).toBeNull()
  })

  it('보조선이 없으면 null', () => {
    expect(slideAlongTo(S, { x: 1, y: 0 }, [])).toBeNull()
  })

  it('시작점이 이미 보조선 위면 안 움직인다 (t = 0 은 안 쓴다)', () => {
    // t=0 을 받아들이면 벽 길이가 0 이 되어 도형이 사라진다.
    expect(slideAlongTo({ x: 50, y: 0 }, { x: 1, y: 0 }, [guideX(50)])).toBeNull()
  })

  it('결과에 NaN 이 없다', () => {
    for (const dir of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 3, y: -7 }, { x: -2, y: 5 }]) {
      const r = slideAlongTo(S, dir, [guideX(30), guideY(40)])
      if (r) expect(Number.isFinite(r.point.x) && Number.isFinite(r.point.y)).toBe(true)
    }
  })
})
