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
 *      프레임 새로 오지만 dxfgroup 은 그대로다 — 5만 선분을 다시 파싱할
 *      이유가 없다.
 *
 * 결과(5만 선분): 커서만 56→9.3ms, 그리는 중 56→8.5ms. 처음 여는 100ms 는
 * 한 번뿐이다.
 *
 * 시간을 재는 테스트는 기계가 바쁘면 흔들리므로, 여기서는 **pathData 를 몇 번
 * 읽었는지**를 센다 — 그걸 읽는 건 다시 만들 때뿐이고, 그게 실제로 아낀 일이다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { snapToWallEndpoint, snapToIntersection, _resetSnapCache } from '../../lib/snap'
import { Mat, type Editor } from 'tldraw'

/** 몇 번 다시 만들었나. `pathData` 는 **다시 만들 때만** 읽힌다. */
let parses = 0

/** 선분 셋짜리 dxfgroup. 개수는 상관없다 — 세는 건 다시 만들었는지다. */
const DXF = {
  id: 'dxf:1',
  type: 'dxfgroup',
  props: {
    get pathData() { parses++; return 'M0,0L80,0 M0,100L80,100 M0,200L80,200' },
  },
}

const WALL0 = { id: 'w:1', type: 'wall', x: 0, y: 0, props: { x2: 100, y2: 0, thickness: 100 } }

function setup() {
  let wall = WALL0
  let arr: unknown[] = [DXF, wall]
  const editor = {
    getCurrentPageShapes: () => arr,
    getShapePageTransform: () => Mat.Translate(0, 0),
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
  return { frame, moveWall }
}

beforeEach(() => { _resetSnapCache(); parses = 0 })

describe('스냅 목록 캐시', () => {
  it('커서만 움직이는 동안에는 **한 번도 다시 안 만든다**', () => {
    const { frame } = setup()
    frame()
    const afterFirst = parses
    expect(afterFirst).toBeGreaterThan(0)       // 처음엔 만든다
    for (let i = 0; i < 10; i++) frame()
    expect(parses).toBe(afterFirst)             // 그 뒤로는 공짜
  })

  it('한 프레임 안의 **여러 질의**가 캐시를 공유한다', () => {
    // 16ms 시간 캐시일 땐 만드는 게 16ms 를 넘는 순간 질의마다 다시 만들었다.
    const { frame } = setup()
    frame()
    // 끝점 목록 1 + 선 목록 1. 질의 수와는 무관하다.
    expect(parses).toBe(2)
  })

  it('벽이 움직여도 **DXF 는 다시 안 판다**', () => {
    // 그리는 동안 매 프레임 일어나는 일이다. 여기가 안 지켜지면 5만 선분을
    // 프레임마다 다시 파싱한다 (14ms).
    const { frame, moveWall } = setup()
    frame()
    const afterFirst = parses
    for (let i = 0; i < 10; i++) { moveWall(); frame() }
    expect(parses).toBe(afterFirst)
  })
})

/**
 * **부모 그룹째** 옮기면 DXF 캐시가 무효가 되는가.
 *
 * 캐시가 dxfgroup 레코드 참조만 보면 부족하다 — 부모 그룹을 옮기거나 돌리면
 * **자식 레코드는 그대로**고 부모 것만 바뀐다. 그러면 page 좌표로 구워 둔
 * 끝점이 옛 자리에 남아서, 보이는 도면과 스냅이 어긋난다.
 *
 * (바깥 캐시는 무효가 된다 — 부모 그룹도 페이지 도형이라 배열이 새로 온다.
 *  문제는 그 다음, **DXF 부분을 다시 만들지 말지** 고르는 자리였다.)
 *
 * `getShapePageTransform` 은 부모까지 합친 결과라 그 변화를 담는다.
 */
describe('DXF 캐시와 부모 transform', () => {
  function movableParent() {
    let offset = 0
    const editor = {
      // 매번 새 배열 (부모 레코드가 바뀌었으므로). **DXF 객체는 같다.**
      getCurrentPageShapes: () => [DXF],
      getShapePageTransform: () => Mat.Translate(offset, 0),
      getZoomLevel: () => 1,
    } as unknown as Editor
    return { editor, move: (x: number) => { offset = x } }
  }

  it('자식은 그대로인데 **부모가 움직이면** 다시 만든다', () => {
    const { editor, move } = movableParent()
    snapToWallEndpoint(editor, { x: 5, y: 5 })
    const afterFirst = parses

    move(500)
    snapToWallEndpoint(editor, { x: 5, y: 5 })
    expect(parses).toBeGreaterThan(afterFirst)

    // 구운 좌표가 실제로 따라갔는지도 본다.
    expect(snapToWallEndpoint(editor, { x: 500, y: 0 })).not.toBeNull()
    expect(snapToWallEndpoint(editor, { x: 0, y: 0 })).toBeNull()
  })

  it('부모가 가만있으면 **다시 안 만든다**', () => {
    const { editor } = movableParent()
    snapToWallEndpoint(editor, { x: 5, y: 5 })
    const afterFirst = parses
    for (let i = 0; i < 5; i++) snapToWallEndpoint(editor, { x: 5, y: 5 })
    expect(parses).toBe(afterFirst)
  })
})
