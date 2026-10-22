/**
 * DXF 덩어리 **분해**.
 *
 * 가져온 DXF 는 "연결된 선분 덩어리(최대 400개)" 하나가 shape 하나다. 5만 개를
 * 각각 shape 으로 만들면 캔버스가 못 버티기 때문인데, 그 대가로 선 하나를
 * 눌러도 덩어리째 잡힌다. 한 줄만 지우거나 옮기려면 쪼갤 수 있어야 한다.
 *
 * ── 무엇이 "오브젝트" 인가 ──
 *
 * `pathData` 는 이미 선분으로 납작해져 있다 — 원본의 폴리라인도 `M a L b M b
 * L c …` 로 쪼개져 들어온다. 그래서 선분 단위로 쪼개면 폴리라인 하나가
 * **shape 수십 개**가 된다. 쓸 수 있는 결과가 아니다.
 *
 * 그래서 **끝이 맞닿은 선분을 도로 이어 붙인다.** 이어진 한 줄이 곧 사람이
 * 생각하는 오브젝트다 (벽 한 변, 문 하나, 치수선 하나). 400 선분짜리 덩어리가
 * 보통 폴리라인 몇 개로 줄어든다.
 *
 * 욕심내서 멀리 있는 것까지 잇지는 않는다 — 원래 떨어져 있던 선이 한 덩어리가
 * 되면 분해를 한 의미가 없다. 들어온 차례대로 보면서 **앞 선분의 끝에서
 * 시작하는 것**만 잇는다.
 */

/** 한 줄(= 분해 결과 하나). page 가 아니라 **그 shape 의 로컬** 좌표다. */
export type ExplodedPath = {
  /**
   * 이어진 점들. **문자열이 아니라 점으로** 들고 있는다 — 새 shape 은 제
   * 바운딩박스 왼쪽 위로 옮겨 앉으므로 좌표를 그만큼 밀어야 하는데, 문자열을
   * 만들어 놓고 다시 파싱해서 미는 건 같은 일을 두 번 하는 것이다.
   */
  pts: Array<[number, number]>
  /** 로컬 바운딩박스. 새 shape 의 x/y/w/h 를 여기서 만든다. */
  minX: number; minY: number; maxX: number; maxY: number
  segCount: number
}

/**
 * 점들 → `M x,y L x,y …`.
 *
 * @param dx,dy 빼 줄 양. 새 shape 이 (minX,minY) 로 옮겨 앉으므로 보통 그 값을 넣는다.
 */
export function toPathData(p: ExplodedPath, dx = 0, dy = 0): string {
  let d = ''
  for (let i = 1; i < p.pts.length; i++) {
    const [ax, ay] = p.pts[i - 1]
    const [bx, by] = p.pts[i]
    d += `M${ax - dx},${ay - dy}L${bx - dx},${by - dy}`
  }
  return d
}

/**
 * 끝점이 같다고 볼 오차.
 *
 * 들여올 때 좌표를 소수 첫째 자리로 반올림하므로(`toFixed(1)`) 그보다 작게
 * 잡으면 붙어 있던 것도 안 붙는다.
 */
const JOIN_EPS = 0.05

type Seg = { x1: number; y1: number; x2: number; y2: number }

/**
 * `M x,y L x,y` 를 이어 붙인 path 에서 선분을 뽑는다.
 *
 * `lib/snap` 의 `parseDxfPathEndpoints` 와 같은 일을 하지만, 거긴 스냅용이라
 * 결과 모양이 다르다. 여기서는 **순서**가 중요해서 따로 둔다 — 이어 붙이기는
 * 들어온 차례에 기댄다.
 */
export function parseSegments(pathData: string): Seg[] {
  const out: Seg[] = []
  const re = /M([\d.eE+-]+),([\d.eE+-]+)\s*L([\d.eE+-]+),([\d.eE+-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pathData)) !== null) {
    const [x1, y1, x2, y2] = [1, 2, 3, 4].map(i => parseFloat(m![i]))
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue
    out.push({ x1, y1, x2, y2 })
  }
  return out
}

/** 두 점이 같은 자리인가. */
const same = (ax: number, ay: number, bx: number, by: number) =>
  Math.abs(ax - bx) <= JOIN_EPS && Math.abs(ay - by) <= JOIN_EPS

/**
 * 덩어리 하나를 **이어진 줄들**로 나눈다.
 *
 * 결과가 비면 (선분이 없으면) 빈 배열이다 — 부른 쪽이 "분해할 게 없다" 로
 * 다루면 된다.
 */
export function explodePathData(pathData: string): ExplodedPath[] {
  const segs = parseSegments(pathData)
  if (segs.length === 0) return []

  const out: ExplodedPath[] = []
  /** 지금 잇고 있는 줄의 점들. */
  let pts: Array<[number, number]> = []

  const flush = () => {
    if (pts.length < 2) { pts = []; return }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    out.push({ pts, minX, minY, maxX, maxY, segCount: pts.length - 1 })
    pts = []
  }

  for (const s of segs) {
    const last = pts[pts.length - 1]
    if (last && same(last[0], last[1], s.x1, s.y1)) {
      pts.push([s.x2, s.y2])
    } else {
      flush()
      pts.push([s.x1, s.y1], [s.x2, s.y2])
    }
  }
  flush()
  return out
}

/**
 * 분해해도 되는가.
 *
 * 분해는 shape 수를 늘린다 — 그게 이 기능의 전부다. 그런데 캔버스가 느려지는
 * 이유도 같은 것이라, 한 번에 얼마나 늘어나는지는 막아야 한다. 되돌리기는
 * 되지만 그 사이 화면이 멎으면 되돌릴 기회도 없다.
 *
 * 그래서 **미리 세어 보고** 넘치면 안 한다. 사용자는 더 좁게 골라서 다시 하면 된다.
 */
export const MAX_EXPLODE_SHAPES = 300

export type ExplodePlan =
  | { kind: 'ok'; paths: ExplodedPath[][] }
  /** 너무 많이 쪼개진다. `count` 는 생길 shape 수. */
  | { kind: 'too-many'; count: number }
  /** 쪼갤 게 없다 (선분이 하나뿐이거나 아예 없다). */
  | { kind: 'nothing' }

/**
 * 고른 덩어리들을 분해하면 무엇이 되는지 **먼저 계산한다.**
 *
 * @param pathDatas 고른 shape 들의 pathData (순서 유지)
 */
export function planExplode(pathDatas: readonly string[]): ExplodePlan {
  const paths = pathDatas.map(explodePathData)
  const count = paths.reduce((n, p) => n + p.length, 0)
  if (count === 0) return { kind: 'nothing' }
  // 하나짜리를 하나로 쪼개는 건 아무것도 안 하는 것이다.
  if (count === pathDatas.length && paths.every(p => p.length <= 1)) return { kind: 'nothing' }
  if (count > MAX_EXPLODE_SHAPES) return { kind: 'too-many', count }
  return { kind: 'ok', paths }
}

// ── 에디터에 적용 ──

import { createShapeId, type Editor, type TLShapeId } from 'tldraw'

export type ExplodeOutcome =
  | { kind: 'ok'; created: number }
  | { kind: 'too-many'; count: number }
  | { kind: 'nothing' }

/**
 * 고른 DXF 덩어리를 **이어진 줄 단위**로 쪼갠다.
 *
 * 쪼갠 것도 `dxfgroup` 그대로다 — 타입을 유지해야 렌더·스냅·내보내기가 전부
 * 그대로 돈다. 바뀌는 건 "한 shape 이 품는 양" 뿐이다.
 *
 * 글자와 해치는 **따로 한 덩이**로 남긴다. 선에 딸려 보내면 어느 줄에 붙일지
 * 정할 근거가 없고, 버리면 조용히 사라진다.
 *
 * 되돌리기는 tldraw 의 히스토리가 받는다 — 만들기와 지우기를 한 묶음으로 돌린다.
 */
export function explodeDxfShapes(editor: Editor, ids: readonly TLShapeId[]): ExplodeOutcome {
  const targets = ids
    .map(id => editor.getShape(id))
    .filter((s): s is NonNullable<typeof s> => !!s && s.type === 'dxfgroup')
  if (targets.length === 0) return { kind: 'nothing' }

  type P = { pathData: string; textsJson?: string; hatchesJson?: string; thickness: number }
  const plan = planExplode(targets.map(s => (s.props as P).pathData ?? ''))
  if (plan.kind !== 'ok') return plan

  const toCreate: unknown[] = []
  targets.forEach((shape, i) => {
    const props = shape.props as P
    // 원본이 어디에 어떻게 놓여 있었는지를 **그대로 물려준다.**
    //
    // 전엔 `x: shape.x + minX` 만 하고 parentId·rotation·opacity 를 안 실었다.
    // 셋 다 조용히 틀린다:
    //
    //  - **parentId** 를 안 주면 tldraw 가 현재 페이지에 붙인다. 그런데
    //    그룹·프레임 안에 든 도형의 x,y 는 **부모 기준**이라, 페이지에 그
    //    숫자를 그대로 놓으면 엉뚱한 자리로 간다. 그리고 원본은 지워진다.
    //  - **rotation** 을 안 주면 돌려 둔 도면이 제자리로 돌아간다.
    //  - **opacity** 를 안 주면 레이어 패널에서 흐려 둔 것이 다시 진해진다.
    //
    // 회전이 있으면 조각의 자리도 같이 돌아야 한다. tldraw 의 로컬 변환은
    // `Translate(x,y) · Rotate(rotation)` 이라 (Editor.getShapeLocalTransform),
    // 원본 안쪽의 (dx,dy) 는 부모 좌표로 이렇게 간다.
    const { x: ox, y: oy, rotation } = shape
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const at = (dx: number, dy: number) => ({
      x: ox + dx * cos - dy * sin,
      y: oy + dx * sin + dy * cos,
    })

    const inherited = {
      parentId: shape.parentId,
      rotation,
      ...(typeof shape.opacity === 'number' ? { opacity: shape.opacity } : {}),
    }

    for (const p of plan.paths[i]) {
      toCreate.push({
        id: createShapeId(),
        type: 'dxfgroup',
        ...at(p.minX, p.minY),
        ...inherited,
        props: {
          w: Math.max(1, p.maxX - p.minX),
          h: Math.max(1, p.maxY - p.minY),
          pathData: toPathData(p, p.minX, p.minY),
          thickness: props.thickness ?? 0,
          segCount: p.segCount,
          textsJson: '',
          hatchesJson: '',
        },
        meta: { ...shape.meta },
      })
    }
    // 글자·해치는 자리를 그대로 두고 한 덩이로 남긴다.
    if (props.textsJson || props.hatchesJson) {
      toCreate.push({
        id: createShapeId(),
        type: 'dxfgroup',
        x: ox,
        y: oy,
        ...inherited,
        props: {
          w: (shape.props as { w: number }).w,
          h: (shape.props as { h: number }).h,
          pathData: '',
          thickness: 0,
          segCount: 0,
          textsJson: props.textsJson ?? '',
          hatchesJson: props.hatchesJson ?? '',
        },
        meta: { ...shape.meta },
      })
    }
  })

  editor.run(() => {
    editor.createShapes(toCreate as never)
    editor.deleteShapes(targets.map(s => s.id))
    editor.setSelectedShapes(toCreate.map(s => (s as { id: TLShapeId }).id))
  })
  return { kind: 'ok', created: toCreate.length }
}
