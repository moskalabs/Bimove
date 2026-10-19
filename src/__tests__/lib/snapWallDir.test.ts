/**
 * 기존 벽 끝에서 다시 시작할 때도 **앞 구간을 안다.**
 *
 * 이어 그리기(클릭-클릭)로 꺾으면 도구가 앞 구간 방향을 들고 있다. 그런데 한 번
 * 끊었다가 기존 벽 끝에서 다시 시작하면 그게 없어서, 직각 스냅도 안 걸리고
 * 코너에 각도도 안 떴다. 사용자 눈에는 **같은 동작인데 어떤 때만 되는** 모양이다.
 *
 * 한이 "꺾을 때 각도도 보이게끔" 이라고 한 게 이거일 것이다 — 뱃지는 이미
 * 있었다(07e7ba8). 안 뜨는 길이 하나 남아 있었다.
 *
 * 돌려주는 방향 약속은 이어 그리기와 같다: 접점으로 **들어오는** 쪽.
 */
import { describe, it, expect } from 'vitest'
import { wallDirIntoPoint, cornerAngleAt } from '../../lib/snap'
import type { Editor } from 'tldraw'

type FakeWall = { id: string; x: number; y: number; x2: number; y2: number }

/** `wallDirIntoPoint` 가 쓰는 것만 흉내낸다 (회전 없는 벽). */
function fakeEditor(walls: FakeWall[], others: { id: string; type: string }[] = []) {
  const shapes = [
    ...walls.map(w => ({ id: w.id, type: 'wall', props: { x2: w.x2, y2: w.y2 }, _w: w })),
    ...others.map(o => ({ ...o, props: {} })),
  ]
  return {
    getCurrentPageShapes: () => shapes,
    getShapePageTransform: (s: { _w?: FakeWall }) => ({
      applyToPoint: (p: { x: number; y: number }) => ({
        x: (s._w?.x ?? 0) + p.x,
        y: (s._w?.y ?? 0) + p.y,
      }),
    }),
  } as unknown as Editor
}

// (0,0) 에서 (100,0) 으로 가는 가로 벽.
const H: FakeWall = { id: 'w1', x: 0, y: 0, x2: 100, y2: 0 }

describe('wallDirIntoPoint', () => {
  it('벽 **끝점**에 붙으면 그 벽이 들어온 방향을 준다', () => {
    const d = wallDirIntoPoint(fakeEditor([H]), { x: 100, y: 0 })!
    expect(d.x).toBeCloseTo(100, 9)
    expect(d.y).toBeCloseTo(0, 9)
  })

  it('벽 **시작점**에 붙으면 뒤집어서 준다 — 늘 "들어오는" 쪽이어야 한다', () => {
    // 시작점에 붙었다는 건 그 벽이 접점에서 **나가는** 중이라는 뜻이다.
    // 안 뒤집으면 직각이 반대로 계산돼 벽이 엉뚱한 쪽으로 당겨진다.
    const d = wallDirIntoPoint(fakeEditor([H]), { x: 0, y: 0 })!
    expect(d.x).toBeCloseTo(-100, 9)
    expect(d.y).toBeCloseTo(0, 9)
  })

  it('멀면 null — 아무 벽이나 앞 구간으로 삼지 않는다', () => {
    expect(wallDirIntoPoint(fakeEditor([H]), { x: 100, y: 40 })).toBeNull()
  })

  it('거리 기준은 벽이 "붙었다" 고 보는 값과 같다 (기본 8)', () => {
    // 이 값이 WallShape 의 JOIN_SNAP_R 과 어긋나면, 코너는 맞물려 보이는데
    // 각은 안 뜨는(혹은 그 반대) 상태가 생긴다.
    expect(wallDirIntoPoint(fakeEditor([H]), { x: 100, y: 7.9 })).not.toBeNull()
    expect(wallDirIntoPoint(fakeEditor([H]), { x: 100, y: 8.1 })).toBeNull()
  })

  it('지금 그리는 미리보기는 건너뛴다', () => {
    // 자기 자신을 앞 구간으로 삼으면 각이 늘 0° 로 뜬다.
    expect(wallDirIntoPoint(fakeEditor([H]), { x: 100, y: 0 }, 'w1')).toBeNull()
  })

  it('길이가 0 인 벽은 안 본다 (방향이 없다)', () => {
    const zero: FakeWall = { id: 'z', x: 100, y: 0, x2: 0, y2: 0 }
    expect(wallDirIntoPoint(fakeEditor([zero]), { x: 100, y: 0 })).toBeNull()
  })

  it('벽이 아닌 도형은 안 본다', () => {
    const ed = fakeEditor([], [{ id: 'd1', type: 'dxfgroup' }])
    expect(wallDirIntoPoint(ed, { x: 0, y: 0 })).toBeNull()
  })

  it('여러 개 붙어 있으면 **제일 가까운** 끝을 고른다', () => {
    const near: FakeWall = { id: 'w2', x: 100, y: 2, x2: 0, y2: 50 } // 시작점이 더 가깝다
    const d = wallDirIntoPoint(fakeEditor([H, near]), { x: 100, y: 1.5 })!
    // w2 의 시작점(100,2)이 0.5, w1 의 끝점(100,0)이 1.5 → 뒤집힌 w2 방향
    expect(d.x).toBeCloseTo(0, 9)
    expect(d.y).toBeCloseTo(-50, 9)
  })

  it('옮겨 놓은 벽도 page 좌표로 본다', () => {
    const moved: FakeWall = { id: 'm', x: 500, y: 300, x2: 0, y2: -80 }
    expect(wallDirIntoPoint(fakeEditor([moved]), { x: 500, y: 220 })).not.toBeNull()
    expect(wallDirIntoPoint(fakeEditor([moved]), { x: 0, y: -80 })).toBeNull()
  })
})

/**
 * 고른 벽에 띄우는 **코너 각도**가 그릴 때와 같은 값이 되는가.
 *
 * `wallDirIntoPoint` 는 이웃이 접점으로 **들어오는** 방향을 준다. 내각은 서로
 * **멀어지는** 두 방향 사이 각이라 뒤집어 넣어야 한다. 여기서 부호를 틀리면
 * 직각(90°)은 대칭이라 멀쩡해 보이다가 **비스듬한 코너에서만 조용히** 틀린다.
 * 그래서 조합을 `cornerAngleAt` 한 군데로 모으고 여기서 잰다.
 */
describe('cornerAngleAt', () => {
  it('ㄱ자로 붙으면 90°', () => {
    // 이웃: (0,0)→(100,0). 접점은 (100,0).
    // 내 벽은 거기서 아래로 뻗는다.
    const r = cornerAngleAt(fakeEditor([H]), { x: 100, y: 0 }, { x: 0, y: 80 }, 'me')!
    expect(r.deg).toBeCloseTo(90, 9)
  })

  it('곧게 이어가면 180° — 안 꺾은 것이다', () => {
    const r = cornerAngleAt(fakeEditor([H]), { x: 100, y: 0 }, { x: 80, y: 0 }, 'me')!
    expect(r.deg).toBeCloseTo(180, 9)
  })

  it('되접으면 0°', () => {
    const r = cornerAngleAt(fakeEditor([H]), { x: 100, y: 0 }, { x: -80, y: 0 }, 'me')!
    expect(r.deg).toBeCloseTo(0, 6)
  })

  it('**비스듬한 코너**에서 부호를 확인한다 (90° 는 대칭이라 못 잡는다)', () => {
    // 이웃이 (0,0)→(100,0) 으로 들어오고, 내 벽이 접점에서 위로 30° 올라간다.
    // 멀어지는 두 방향 사이 각 = 180 − 30 = 150.
    const up30 = { x: Math.cos(-Math.PI / 6) * 80, y: Math.sin(-Math.PI / 6) * 80 }
    const r = cornerAngleAt(fakeEditor([H]), { x: 100, y: 0 }, up30, 'me')!
    expect(r.deg).toBeCloseTo(150, 6)
  })

  it('이웃이 없으면 null — 자유로운 끝에는 각이 없다', () => {
    expect(cornerAngleAt(fakeEditor([H]), { x: 100, y: 400 }, { x: 0, y: 80 }, 'me')).toBeNull()
  })

  it('자기 자신은 이웃이 아니다', () => {
    expect(cornerAngleAt(fakeEditor([H]), { x: 100, y: 0 }, { x: 0, y: 80 }, 'w1')).toBeNull()
  })
})
