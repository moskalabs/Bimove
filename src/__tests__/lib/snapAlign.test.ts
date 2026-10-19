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

/**
 * 보조선이 **벽 끝을 화면 밖으로 날리지 않는가.**
 *
 * 보조선은 커서에서 8px 안에 있을 때만 잡힌다. 그러니 제대로 된 교점도 커서
 * 근처여야 맞다. 그런데 방향이 보조선과 거의 나란하면 1/denom 이 폭발해서,
 * 8px 짜리 어긋남이 수천 단위 이동이 된다 — 세로로 긋는 중에 세로 보조선이
 * 살짝 스치기만 해도 끝점이 날아간다.
 *
 * 나란함을 각으로만 막으면 한계각 바로 안쪽에서 여전히 멀리 간다. 그래서
 * **결과가 커서에서 얼마나 떨어지는지**를 직접 막는다.
 */
describe('slideAlongTo — 끌려가는 거리 제한', () => {
  it('거의 나란한 보조선은 **거절한다**', () => {
    // 거의 세로(+y)로 긋는 중인데 세로 보조선(x=…)이 8 만큼 떨어져 있다.
    // ux 가 0.01 이라 교점은 800 만큼 떨어진 곳에 생긴다.
    const dir = { x: 1, y: 100 }
    const guides: AlignGuide[] = [{ axis: 'x', at: 8, through: { x: 8, y: 0 } }]
    expect(slideAlongTo(S, dir, guides, 32)).toBeNull()
  })

  it('한도를 안 주면 예전처럼 다 간다 (기존 호출부 보호)', () => {
    const dir = { x: 1, y: 100 }
    const guides: AlignGuide[] = [{ axis: 'x', at: 8, through: { x: 8, y: 0 } }]
    expect(slideAlongTo(S, dir, guides)).not.toBeNull()
  })

  it('비스듬해도 한도 안이면 쓴다', () => {
    // 45° 로 긋는 중, x 보조선이 조금 앞에 있다 — 살짝만 늘어난다.
    const dir = { x: 100, y: 100 }
    const r = slideAlongTo(S, dir, [guideX(110)], 32)!
    expect(r.point.x).toBeCloseTo(110, 9)
    expect(r.point.y).toBeCloseTo(110, 9)
  })

  it('한도를 넘기면 **더 가까운 보조선**이 있어도 그쪽만 쓴다', () => {
    const dir = { x: 1, y: 100 }
    const far: AlignGuide = { axis: 'x', at: 8, through: { x: 8, y: 0 } }   // 800 이동
    const near: AlignGuide = { axis: 'y', at: 110, through: { x: 0, y: 110 } } // 10 남짓
    const r = slideAlongTo(S, dir, [far, near], 32)!
    expect(r.used.axis).toBe('y')
  })
})
