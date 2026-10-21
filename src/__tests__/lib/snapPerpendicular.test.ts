/**
 * 직교(수직) 스냅 — 시작점에서 벽에 내린 **수선의 발**.
 *
 * 한이 "직교점 활성화. 제대로 작동하는지 확인" 이라고 했다. 둘 다 문제가 있었다.
 *
 *   1. 기본값이 꺼짐이었다. 토글을 찾아 켜기 전까지는 "직교가 안 먹는다" 다.
 *   2. 켜도 **거의 안 걸렸다.** 커서가 *수선의 발* 근처(12px)에 있어야 했는데,
 *      그 발이 어디 생기는지는 화면에 아무 표시가 없다. 찍어야 할 자리를 모른 채
 *      더듬어야 했다는 뜻이다.
 *
 * 그래서 조건을 CAD 의 PER 오스냅과 같게 바꿨다 — **직교로 붙이고 싶은 벽을
 * 가리키면** 걸린다. 발은 늘 선분 위에 있으므로 새 조건이 옛 조건을 포함한다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../lib/settings', async (orig) => ({
  ...(await orig<typeof import('../../lib/settings')>()),
  getSnapMode: (m: string) => m === 'perpendicular',
  getSnapEnabled: () => false,
}))

const { snapToPerpendicular, _resetSnapCache } = await import('../../lib/snap')
const { Mat } = await import('tldraw')
type Editor = import('tldraw').Editor

/** 회전·그룹 없는 벽 하나. (x,y) 에서 (x+x2, y+y2) 로 간다. */
type W = { id: string; x: number; y: number; x2: number; y2: number }

function fakeEditor(walls: W[]) {
  const shapes = walls.map(w => ({
    id: w.id, type: 'wall', props: { x2: w.x2, y2: w.y2, thickness: 100 }, _w: w,
  }))
  return {
    getCurrentPageShapes: () => shapes,
    getShapePageTransform: (s: { _w?: W }) => Mat.Translate(s._w?.x ?? 0, s._w?.y ?? 0),
    getZoomLevel: () => 1,   // 스냅 반경 = 12 page 단위
  } as unknown as Editor
}

/** (0,100) → (200,100) 가로 벽. */
const H: W = { id: 'w1', x: 0, y: 100, x2: 200, y2: 0 }

beforeEach(() => _resetSnapCache())

describe('snapToPerpendicular', () => {
  it('**벽을 가리키면** 수선의 발로 간다', () => {
    // 시작점 (50, 0). 가로 벽에 내린 발은 (50, 100).
    // 커서는 벽 위 **엉뚱한 자리**(160,100) — 전엔 여기서 안 걸렸다.
    const r = snapToPerpendicular(fakeEditor([H]), { x: 50, y: 0 }, { x: 160, y: 100 })!
    expect(r).not.toBeNull()
    expect(r.x).toBeCloseTo(50, 9)
    expect(r.y).toBeCloseTo(100, 9)
    expect(r.snapType).toBe('perpendicular')
  })

  it('발 근처에 있어도 걸린다 — 되던 건 그대로 된다', () => {
    const r = snapToPerpendicular(fakeEditor([H]), { x: 50, y: 0 }, { x: 52, y: 103 })!
    expect(r.x).toBeCloseTo(50, 9)
    expect(r.y).toBeCloseTo(100, 9)
  })

  it('벽에서 멀면 안 걸린다', () => {
    // 커서가 벽에서 40 떨어져 있다 (반경 12 밖).
    expect(snapToPerpendicular(fakeEditor([H]), { x: 50, y: 0 }, { x: 50, y: 140 })).toBeNull()
  })

  it('발이 선분 밖이면 **가까운 끝으로** 당긴다', () => {
    // 시작점 x=300 → 발은 x=300 인데 벽은 x∈[0,200]. 끝(200,100) 으로.
    const r = snapToPerpendicular(fakeEditor([H]), { x: 300, y: 0 }, { x: 195, y: 100 })!
    expect(r.x).toBeCloseTo(200, 9)
    expect(r.y).toBeCloseTo(100, 9)
  })

  it('시작점이 **그 벽 위**면 안 건다 — 길이 0 짜리 벽이 된다', () => {
    const r = snapToPerpendicular(fakeEditor([H]), { x: 50, y: 100 }, { x: 60, y: 100 })
    expect(r).toBeNull()
  })

  it('겹쳐 있으면 **커서가 가리킨 벽**이 이긴다', () => {
    // 두 가로 벽. 커서는 아래쪽(y=300) 위에 있다.
    const low: W = { id: 'w2', x: 0, y: 300, x2: 200, y2: 0 }
    const r = snapToPerpendicular(fakeEditor([H, low]), { x: 50, y: 0 }, { x: 120, y: 300 })!
    expect(r.sourceId).toBe('w2')
    expect(r.y).toBeCloseTo(300, 9)
  })

  it('지금 그리는 미리보기는 건너뛴다', () => {
    expect(snapToPerpendicular(fakeEditor([H]), { x: 50, y: 0 }, { x: 160, y: 100 }, 'w1')).toBeNull()
  })

  it('비스듬한 벽에서도 수선의 발이 맞다', () => {
    // (0,0) → (100,100) 45° 벽. 시작점 (100,0) 에서 내린 발은 (50,50).
    const diag: W = { id: 'd', x: 0, y: 0, x2: 100, y2: 100 }
    const r = snapToPerpendicular(fakeEditor([diag]), { x: 100, y: 0 }, { x: 80, y: 80 })!
    expect(r.x).toBeCloseTo(50, 6)
    expect(r.y).toBeCloseTo(50, 6)
  })
})

/**
 * DXF 밑그림은 직교 대상이 아니다.
 *
 * `getWallLines` 에는 DXF 선분이 **수만 개** 들어 있다. 그걸 다 대상으로 두면
 * 밑그림 위에 그리는 동안 커서가 아무 선이나 스칠 때마다 멀리 있는 수선의
 * 발로 끌려간다 — 끝점·교차점과 달리 결과가 커서에서 먼 자리라 더 그렇다.
 *
 * 직교는 "기존 **벽**에 직각으로 붙인다" 는 동작이다.
 */
describe('snapToPerpendicular — DXF 는 건너뛴다', () => {
  function withDxf() {
    const shapes = [{
      id: 'dxf:1',
      type: 'dxfgroup',
      props: { pathData: 'M0,100L200,100' },   // 위 H 와 같은 자리의 선
    }]
    return {
      getCurrentPageShapes: () => shapes,
      getShapePageTransform: () => Mat.Translate(0, 0),
      getZoomLevel: () => 1,
    } as unknown as Editor
  }

  it('DXF 선 위를 가리켜도 안 걸린다', () => {
    expect(snapToPerpendicular(withDxf(), { x: 50, y: 0 }, { x: 160, y: 100 })).toBeNull()
  })

  it('같은 자리에 **진짜 벽**이 있으면 걸린다 — 대상만 가린 것이다', () => {
    const r = snapToPerpendicular(fakeEditor([H]), { x: 50, y: 0 }, { x: 160, y: 100 })
    expect(r).not.toBeNull()
  })
})
