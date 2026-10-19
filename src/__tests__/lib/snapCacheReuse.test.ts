/**
 * 스냅 목록을 **언제 다시 만드는가.**
 *
 * 한이 "렌더링 쓸데없이 많이 하는 거 아닌지 봐봐" 라고 해서 재 봤더니 여기였다.
 *
 * 목록 캐시가 `performance.now()` 로 16ms 창을 쓰고 있었는데, 그게 **제일
 * 필요한 순간에 무너진다** — 선분 5만 개짜리 DXF 는 목록을 만드는 데만 14ms 가
 * 걸리고, 한 프레임에 스냅 질의가 넷(끝점·교차·수직·연장)이라 두 번째
 * 질의부터는 이미 16ms 가 지나 있다. 그래서 네 번 다 처음부터 다시 만들었다.
 * 재보니 한 프레임 56ms 였다.
 *
 * 고친 건 둘이다.
 *   1. 캐시 키를 **시간이 아니라 `getCurrentPageShapes()` 배열의 신원**으로.
 *      도형이 안 바뀌면(= 커서만 움직이면) 아예 안 만든다.
 *   2. DXF 부분을 **따로** 캐시. 그리는 중에는 미리보기 벽 때문에 배열이 매
 *      프레임 새로 오지만 dxfgroup 객체는 그대로다 — 5만 선분을 다시 파싱할
 *      이유가 없다.
 *
 * 결과(5만 선분): 커서만 56→9.3ms, 그리는 중 56→8.5ms. 처음 여는 100ms 는
 * 한 번뿐이다.
 *
 * 시간을 재는 테스트는 기계가 바쁘면 흔들리므로, 여기서는 **다시 만든 횟수**를
 * 센다. 그게 실제로 고친 것이다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { snapToWallEndpoint, snapToIntersection, _resetSnapCache } from '../../lib/snap'
import { Mat, type Editor } from 'tldraw'

/** 선분 셋짜리 dxfgroup 하나. 개수는 상관없다 — 세는 건 **다시 만들었는지**다. */
const DXF = { id: 'dxf:1', type: 'dxfgroup', props: { pathData: 'M0,0L80,0 M0,100L80,100 M0,200L80,200' } }

function setup() {
  let wall = { id: 'w:1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0, thickness: 100 } }
  let arr: unknown[] = [DXF, wall]
  /** 변환을 몇 번 구했나 = 목록을 얼마나 다시 만들었나. */
  const seen: string[] = []
  const editor = {
    getCurrentPageShapes: () => arr,
    getShapePageTransform: (s: { id: string }) => { seen.push(s.id); return Mat.Translate(0, 0) },
    getZoomLevel: () => 1,
  } as unknown as Editor
  const frame = () => {
    snapToWallEndpoint(editor, { x: 5, y: 5 })
    snapToIntersection(editor, { x: 5, y: 5 })
  }
  /** 미리보기 벽만 바뀐 새 프레임. dxfgroup 객체는 **그대로** 넘긴다. */
  const moveWall = () => {
    wall = { ...wall, props: { ...wall.props, x2: wall.props.x2 + 1 } }
    arr = [DXF, wall]
  }
  return { seen, frame, moveWall }
}

beforeEach(() => _resetSnapCache())

describe('스냅 목록 캐시', () => {
  it('커서만 움직이는 동안에는 **한 번도 다시 안 만든다**', () => {
    const { seen, frame } = setup()
    frame()
    const afterFirst = seen.length
    expect(afterFirst).toBeGreaterThan(0)       // 처음엔 만든다
    for (let i = 0; i < 10; i++) frame()
    expect(seen.length).toBe(afterFirst)        // 그 뒤로는 공짜
  })

  it('한 프레임 안의 **여러 질의**가 캐시를 공유한다', () => {
    // 16ms 시간 캐시일 땐 만드는 게 16ms 를 넘는 순간 질의마다 다시 만들었다.
    const { seen, frame } = setup()
    frame()
    const dxfBuilds = seen.filter(id => id === 'dxf:1').length
    expect(dxfBuilds).toBe(2)   // 끝점 목록 1 + 선 목록 1. 질의 수와 무관하다.
  })

  it('벽이 움직여도 **DXF 는 다시 안 판다**', () => {
    // 그리는 동안 매 프레임 일어나는 일이다. 여기가 안 지켜지면 5만 선분을
    // 프레임마다 다시 파싱한다 (14ms).
    const { seen, frame, moveWall } = setup()
    frame()
    seen.length = 0
    for (let i = 0; i < 10; i++) { moveWall(); frame() }
    expect(seen.filter(id => id === 'dxf:1')).toHaveLength(0)
    expect(seen.filter(id => id === 'w:1').length).toBeGreaterThan(0)  // 벽은 다시 만든다
  })
})
