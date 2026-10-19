/**
 * 외곽선이 **이웃을 따라가는가.**
 *
 * 한이 "꺾이는 지점 겹친다" 를 네 번 말했다. 기하는 맞았고, 범인은 렌더였다.
 *
 * tldraw 는 `ShapeUtil.component()` 를 `useStateTracking` 안에서 부른다.
 * 그런데 우리 `component()` 는 `<WallComponent/>` **엘리먼트만** 돌려준다 —
 * 추적은 엘리먼트를 만드는 동안에만 걸리고, 컴포넌트 본문은 React 가 나중에
 * 따로 돌린다. 그래서 본문에서 이웃을 읽어도 **구독이 안 걸렸다.**
 *
 * 결과: 벽은 제 레코드가 바뀔 때만 다시 그려진다. 이어 그리기에서 앞 구간이
 * 마지막으로 그려지는 순간엔 다음 구간이 아직 없으므로, 앞 구간은
 * **"이웃 없음" = miter 없고 끝이 막힌** 모양으로 굳는다. 그 위에 다음 구간이
 * miter 된 채 올라오니 겹쳐 보인다 — 한의 확대 화면에 세로로 가로지르던
 * 그 선이 앞 구간의 **막는 선**이다.
 *
 * 고친 방법은 `useValue` 로 감싸는 것이다. 여기서 재는 건 그게 성립하기 위한
 * 두 가지 계약이다.
 *
 *   1. 이웃이 생기면 **끝을 안 막는다** (그리고 miter 된다).
 *   2. 안 바뀌었으면 **같은 객체**를 돌려준다 — useValue 가 참조로 비교하므로,
 *      매번 새 객체면 도형 하나 움직일 때마다 벽 전부가 다시 그려진다.
 */
import { describe, it, expect } from 'vitest'
import { computeWallOutline, getWallsSnapshot } from '../../shapes/WallShape'
import type { WallShape } from '../../shapes/WallShape'
import { Mat, type Editor } from 'tldraw'

function wall(id: string, x: number, y: number, x2: number, y2: number): WallShape {
  return {
    id, type: 'wall', x, y, rotation: 0, index: 'a1', parentId: 'page:1',
    isLocked: false, opacity: 1, meta: {}, typeName: 'shape',
    props: { x2, y2, thickness: 100 },
  } as unknown as WallShape
}

/** 도형이 바뀌면 tldraw 의 computed 는 **새 배열**을 낸다. 그걸 흉내낸다. */
function fakeEditor(shapes: WallShape[]) {
  let arr = shapes
  const editor = {
    getCurrentPageShapes: () => arr,
    getShapePageTransform: (s: WallShape) => Mat.Translate(s.x, s.y),
  } as unknown as Editor
  return { editor, setShapes: (next: WallShape[]) => { arr = next } }
}

// (0,0)→(500,0) 가로 벽. 그 끝에서 (500,0)→(500,500) 으로 꺾인다.
const A = () => wall('a', 0, 0, 500, 0)
const B = () => wall('b', 500, 0, 0, 500)

describe('computeWallOutline — 이웃 반영', () => {
  it('혼자면 양 끝을 막는다', () => {
    const a = A()
    const { editor } = fakeEditor([a])
    const o = computeWallOutline(editor, a)
    expect(o.capStart).toBe(true)
    expect(o.capEnd).toBe(true)
  })

  it('끝에 이웃이 붙으면 **그 끝을 안 막는다**', () => {
    // 이게 한이 본 세로 선이다. 막으면 코너를 가로지른다.
    const a = A()
    const { editor } = fakeEditor([a, B()])
    const o = computeWallOutline(editor, a)
    expect(o.capStart).toBe(true)    // 시작은 자유로운 끝
    expect(o.capEnd).toBe(false)
  })

  it('이웃이 붙으면 끝 코너가 **miter 된다** (각진 끝이 아니다)', () => {
    const a = A()
    const alone = computeWallOutline(editor0([a]), a)
    const withB = computeWallOutline(fakeEditor([a, B()]).editor, a)
    // 혼자일 때 두 끝 코너는 x 가 같다 (벽에 수직인 각진 끝).
    expect(alone.corners[1].x).toBeCloseTo(alone.corners[2].x, 9)
    // 이웃이 있으면 한쪽은 뻗고 한쪽은 당겨져서 어긋난다.
    expect(Math.abs(withB.corners[1].x - withB.corners[2].x)).toBeGreaterThan(50)
  })

  it('안 바뀌었으면 **같은 객체**를 돌려준다', () => {
    // useValue 가 참조로 비교한다. 매번 새 객체면 도형 하나 움직일 때마다
    // 페이지의 벽 전부가 다시 그려진다.
    const a = A()
    const { editor } = fakeEditor([a, B()])
    const first = computeWallOutline(editor, a)
    expect(computeWallOutline(editor, a)).toBe(first)
  })

  it('이웃이 움직이면 **다른 결과**가 나온다', () => {
    const a = A()
    const { editor, setShapes } = fakeEditor([a, B()])
    const joined = computeWallOutline(editor, a)
    expect(joined.capEnd).toBe(false)

    // B 를 멀리 치운다 → 더 이상 이웃이 아니다.
    setShapes([a, wall('b', 5000, 5000, 0, 500)])
    const lonely = computeWallOutline(editor, a)
    expect(lonely).not.toBe(joined)
    expect(lonely.capEnd).toBe(true)
  })
})

/** 위 테스트에서 한 줄로 쓰려고. */
function editor0(shapes: WallShape[]): Editor {
  return fakeEditor(shapes).editor
}

describe('getWallsSnapshot — 배열이 바뀌면 다시 만든다', () => {
  it('같은 배열이면 같은 스냅샷', () => {
    const { editor } = fakeEditor([A()])
    expect(getWallsSnapshot(editor)).toBe(getWallsSnapshot(editor))
  })
})

/**
 * **다른 페이지**의 벽을 그릴 때 그 페이지 이웃을 보는가.
 *
 * 배치 썸네일(LayoutPanel)은 현재 페이지를 바꾸지 않고 임의 페이지의 SVG 를
 * 만든다. 그런데 `getWallsSnapshot` 이 `getCurrentPageShapes()` 만 보면,
 * 그 썸네일에서는 코너가 안 붙거나 **현재 페이지의 엉뚱한 벽과** 붙는다.
 */
describe('getWallsSnapshot — 페이지', () => {
  it('다른 페이지를 지정하면 **그 페이지 벽**만 본다', () => {
    const here = wall('here', 0, 0, 500, 0)
    const there = wall('there', 9000, 9000, 0, 500)
    const editor = {
      getCurrentPageShapes: () => [here],
      getCurrentPageId: () => 'page:1',
      getPageShapeIds: (id: string) => (id === 'page:2' ? ['s:there'] : []),
      getShape: (id: string) => (id === 's:there' ? there : undefined),
      getShapePageTransform: (s: WallShape) => Mat.Translate(s.x, s.y),
    } as unknown as Editor

    const snap = getWallsSnapshot(editor, 'page:2')
    expect(snap.map(w => w.id)).toEqual(['there'])
    expect(snap[0].sx).toBe(9000)
  })

  it('현재 페이지를 지정하면 캐시를 그대로 쓴다', () => {
    const a = A()
    const editor = {
      getCurrentPageShapes: () => [a],
      getCurrentPageId: () => 'page:1',
      getPageShapeIds: () => { throw new Error('현재 페이지인데 페이지 조회를 했다') },
      getShapePageTransform: (s: WallShape) => Mat.Translate(s.x, s.y),
    } as unknown as Editor
    expect(() => getWallsSnapshot(editor, 'page:1')).not.toThrow()
  })
})
