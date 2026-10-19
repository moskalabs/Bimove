/**
 * 꺾인 코너가 **맞물리는가.**
 *
 * 한이 Rayon 화면을 보내면서 "꺾을 때도 이렇게 나온다" 고 했다. 거기 코너는
 * 외곽선이 끊김 없이 이어지고, 코너를 가로지르는 선도 삐져나온 꼬다리도 없다.
 *
 * 우리 건 둘 다 있었다.
 *
 *   1. `miterExtension` 은 **스칼라 하나**를 내놓고 그걸 양쪽 옆면에 똑같이
 *      더한다. 바깥쪽은 맞지만 안쪽은 **당겨야** 한다. 90° 코너면 안쪽 옆면이
 *      두께만큼 삐져나와 꼬다리가 된다 — 채움이 진회색일 땐 안 보였고, 흰색으로
 *      바꾸자 드러났다.
 *   2. 벽마다 닫힌 사각형을 통째로 stroke 했다. 붙은 끝을 막는 선이 코너를
 *      가로지른다.
 *
 * 여기서는 1번(`miterOffset`)을 재고, 2번은 `capStart/capEnd` 로 외곽선에서
 * 뺀다 (그건 렌더라 여기서 못 잰다 — 계산 쪽만 고정한다).
 */
import { describe, it, expect } from 'vitest'
import { miterOffset, miterExtension } from '../../shapes/WallShape'

const H = 10 // 반두께

describe('miterOffset — 옆면끼리 교차', () => {
  it('90° 코너: 바깥은 뻗고 **안쪽은 당긴다**', () => {
    // 내 벽은 접점에서 +x 로, 상대는 +y 로 나간다.
    const a: [number, number] = [1, 0]
    const b: [number, number] = [0, 1]

    // perp(a) = (0,1) 쪽. 상대 벽(+y)이 그쪽에 있으므로 여기가 **안쪽**이다.
    const inner = miterOffset(a[0], a[1], b[0], b[1], H, H, 1)!
    // 반대쪽이 바깥.
    const outer = miterOffset(a[0], a[1], b[0], b[1], H, H, -1)!

    // 바깥 모서리는 두 바깥면의 교점 — 접점에서 (−H, −H).
    expect(outer.x).toBeCloseTo(-H, 9)
    expect(outer.y).toBeCloseTo(-H, 9)
    // 안쪽 모서리는 (+H, +H). 둘 다 **벽 안쪽으로 들어온다** — 스칼라 ext 로는
    // x 가 −H 가 되어 반대로 삐져나왔다.
    expect(inner.x).toBeCloseTo(H, 9)
    expect(inner.y).toBeCloseTo(H, 9)
  })

  it('예전 방식과 **반대 부호**가 나오는 쪽이 있다 (그게 꼬다리였다)', () => {
    // 스칼라 ext 는 양쪽 다 바깥으로 민다.
    const ext = miterExtension(1, 0, 0, 1, H)
    expect(ext).toBeCloseTo(H, 9)
    const inner = miterOffset(1, 0, 0, 1, H, H, 1)!
    // a 방향(+x) 성분이 ext 쪽은 −H, 제대로 된 쪽은 +H.
    expect(inner.x).toBeCloseTo(H, 9)
    expect(-ext).toBeCloseTo(-H, 9)
  })

  it('나란히 이어지면 null — 꺾인 게 아니다', () => {
    // 일직선으로 계속 가는 벽. 벌릴 코너가 없다.
    expect(miterOffset(1, 0, -1, 0, H, H, 1)).toBeNull()
    expect(miterOffset(1, 0, -1, 0, H, H, -1)).toBeNull()
    // 겹쳐 되돌아가는 경우도 마찬가지.
    expect(miterOffset(1, 0, 1, 0, H, H, 1)).toBeNull()
  })

  it('두께가 다르면 **상대 두께**를 따라 교점이 옮겨간다', () => {
    const thin = miterOffset(1, 0, 0, 1, H, 5, -1)!
    const thick = miterOffset(1, 0, 0, 1, H, 20, -1)!
    // 상대가 두꺼울수록 내 옆면은 더 멀리까지 가서 만난다.
    expect(thick.x).toBeLessThan(thin.x)
    expect(thin.y).toBeCloseTo(-H, 9)
    expect(thick.y).toBeCloseTo(-H, 9)
  })

  it('아주 뾰족한 각에서 창처럼 뻗지 않는다', () => {
    // 거의 되돌아오는 각(177°). 진짜 교점은 수십 배 멀리 있다.
    const sharp = miterOffset(1, 0, -0.9986, 0.0523, H, H, -1)!
    expect(Math.hypot(sharp.x, sharp.y)).toBeLessThanOrEqual(H * 8 + H + 1e-6)
  })

  it('제 miter 보다 짧은 벽에서 **끝을 지나치지 않는다**', () => {
    // 한이 그린 게 이거다 — 두께 100mm 짜리 벽의 36mm 토막. 당겨지는 쪽이
    // 반대쪽 끝을 지나가면 도형이 뒤집혀서 나비넥타이가 된다.
    const LEN = 36
    const inner = miterOffset(1, 0, 0, 1, 50, 50, 1, LEN)!
    // a(+x) 성분이 벽 길이 안에 있어야 한다.
    expect(inner.x).toBeLessThanOrEqual(LEN)
    expect(inner.x).toBeCloseTo(LEN, 9) // 한도에 걸렸다

    // 바깥쪽은 안 막는다 — 뻗어도 뒤집히지 않는다.
    const outer = miterOffset(1, 0, 0, 1, 50, 50, -1, LEN)!
    expect(outer.x).toBeCloseTo(-50, 9)
  })

  it('한도를 안 주면 예전처럼 다 간다', () => {
    const free = miterOffset(1, 0, 0, 1, 50, 50, 1)!
    expect(free.x).toBeCloseTo(50, 9)
  })

  it('결과에 NaN 이 없다', () => {
    for (let deg = 5; deg < 356; deg += 7) {
      const r = (deg * Math.PI) / 180
      for (const side of [1, -1] as const) {
        const o = miterOffset(1, 0, Math.cos(r), Math.sin(r), H, H, side)
        if (o) expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true)
      }
    }
  })
})
