/**
 * 벽 목록 캐시가 **reactive 구독을 안 건너뛰는가.**
 *
 * tldraw 는 도형의 `component()` 를 `useStateTracking` 안에서 부른다 — 그리는
 * 동안 읽은 신호가 그대로 그 도형의 구독이 된다. 그래서 캐시가 살아 있다고
 * `getCurrentPageShapes()` 를 아예 안 읽고 돌아가면, 그 프레임에 캐시를 맞은
 * 벽은 **이웃을 구독하지 못한다.** 이웃이 나중에 움직여도 다시 안 그려지고,
 * 제 레코드는 안 변하니 영영 안 그려진다.
 *
 * 결과는 코너마다 한쪽이 옛 모양(이웃이 없던 때의 각진 끝)으로 남는 것이다.
 * 이어 그리기에서 특히 그렇다 — 앞 구간이 마지막으로 그려지는 순간엔 다음
 * 구간이 아직 없다. 한이 "꺾이는 지점이 겹치는 느낌" 이라고 한 게 이것이다.
 *
 * 그래서 보는 건 둘이다: **매번 읽는가**, 그리고 **안 바뀌었으면 안 만드는가.**
 */
import { describe, it, expect } from 'vitest'
import { getWallsSnapshot } from '../../shapes/WallShape'
import type { Editor } from 'tldraw'

type FakeShape = { id: string; type: string; props: { x2: number; y2: number; thickness: number } }

function wall(id: string, x2: number, y2: number): FakeShape {
  return { id, type: 'wall', props: { x2, y2, thickness: 100 } }
}

/** 읽은 횟수와 만든 횟수를 따로 센다. */
function fakeEditor(initial: FakeShape[]) {
  let arr: FakeShape[] = initial
  const counts = { reads: 0, transforms: 0 }
  const editor = {
    getCurrentPageShapes: () => { counts.reads++; return arr },
    getShapePageTransform: () => {
      counts.transforms++
      return { applyToPoint: (p: { x: number; y: number }) => ({ x: p.x, y: p.y }) }
    },
  } as unknown as Editor
  /** 도형이 바뀌면 tldraw 의 computed 는 **새 배열**을 낸다. */
  const change = (next: FakeShape[]) => { arr = next }
  return { editor, counts, change }
}

describe('getWallsSnapshot', () => {
  it('**매번 읽는다** — 그 읽기가 곧 구독이다', () => {
    const { editor, counts } = fakeEditor([wall('a', 100, 0)])
    getWallsSnapshot(editor)
    getWallsSnapshot(editor)
    getWallsSnapshot(editor)
    // 전엔 16ms 시간 캐시라 2·3번째가 읽지 않고 돌아갔다. 그 벽들은 이웃이
    // 움직여도 다시 안 그려졌다.
    expect(counts.reads).toBe(3)
  })

  it('안 바뀌었으면 **다시 만들지는 않는다**', () => {
    const { editor, counts } = fakeEditor([wall('a', 100, 0), wall('b', 0, 100)])
    getWallsSnapshot(editor)
    const before = counts.transforms
    getWallsSnapshot(editor)
    getWallsSnapshot(editor)
    expect(counts.transforms).toBe(before)   // 읽기만 하고 만들진 않았다
  })

  it('배열이 바뀌면 **다시 만든다**', () => {
    const { editor, counts, change } = fakeEditor([wall('a', 100, 0)])
    getWallsSnapshot(editor)
    const before = counts.transforms
    change([wall('a', 100, 0), wall('b', 0, 100)])
    const snap = getWallsSnapshot(editor)
    expect(counts.transforms).toBeGreaterThan(before)
    expect(snap).toHaveLength(2)
  })

  it('page 변환을 거쳐 끝점을 잡는다 — 벽이 아닌 건 뺀다', () => {
    const { editor } = fakeEditor([
      wall('a', 100, 0),
      { id: 'd', type: 'dxfgroup', props: { x2: 0, y2: 0, thickness: 0 } },
    ])
    const snap = getWallsSnapshot(editor)
    expect(snap).toHaveLength(1)
    expect(snap[0]).toMatchObject({ id: 'a', sx: 0, sy: 0, ex: 100, ey: 0, half: 50 })
  })

  it('두께가 없으면 기본값으로 버틴다 (NaN 이 코너를 통째로 날린다)', () => {
    const { editor } = fakeEditor([
      { id: 'a', type: 'wall', props: { x2: 100, y2: 0 } } as unknown as FakeShape,
    ])
    expect(getWallsSnapshot(editor)[0].half).toBe(5)
  })
})
