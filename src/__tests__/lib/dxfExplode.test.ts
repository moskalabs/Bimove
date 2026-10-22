/**
 * DXF 덩어리 **분해**.
 *
 * 가져온 DXF 는 "연결된 선분 덩어리(최대 400개)" 하나가 shape 하나다. 그래서
 * 선 하나를 눌러도 덩어리째 잡힌다 — 한이 "특정 오브젝트 클릭하면 그룹 자체로
 * 묶여서 선택된다" 고 한 게 이것이다.
 *
 * 여기서 재는 핵심은 **"오브젝트" 를 무엇으로 보느냐**다. `pathData` 는 이미
 * 선분으로 납작해져 있어서(원본 폴리라인도 `M a L b M b L c` 로 들어온다),
 * 선분 단위로 쪼개면 폴리라인 하나가 shape 수십 개가 된다 — 쓸 수 없는 결과다.
 * 그래서 끝이 맞닿은 것을 도로 이어 붙이고, **이어진 한 줄**을 하나로 본다.
 */
import { describe, it, expect } from 'vitest'
import {
  explodePathData, parseSegments, planExplode, toPathData, MAX_EXPLODE_SHAPES,
  explodeDxfShapes,
} from '../../lib/dxfExplode'

describe('explodePathData', () => {
  it('이어진 선분은 **한 줄로 묶는다**', () => {
    // 폴리라인 하나가 선분 셋으로 들어온 꼴.
    const r = explodePathData('M0,0L10,0M10,0L10,10M10,10L20,10')
    expect(r).toHaveLength(1)
    expect(r[0].segCount).toBe(3)
  })

  it('떨어진 선분은 **따로 낸다**', () => {
    const r = explodePathData('M0,0L10,0M50,50L60,50')
    expect(r).toHaveLength(2)
    expect(r.map(p => p.segCount)).toEqual([1, 1])
  })

  it('멀리 있는 걸 욕심내서 잇지 않는다', () => {
    // 끝점이 0.5 어긋나 있다 — 이어 붙이기 오차(0.05) 밖이다.
    const r = explodePathData('M0,0L10,0M10.5,0L20,0')
    expect(r).toHaveLength(2)
  })

  it('반올림 오차(소수 첫째 자리)는 봐준다', () => {
    // 들여올 때 toFixed(1) 로 자르므로 이 정도는 "같은 점" 이다.
    const r = explodePathData('M0,0L10,0M10.02,0L20,0')
    expect(r).toHaveLength(1)
    expect(r[0].segCount).toBe(2)
  })

  it('바운딩박스를 같이 낸다 — 새 shape 의 자리가 된다', () => {
    const r = explodePathData('M10,20L30,20M30,20L30,50')
    expect(r[0]).toMatchObject({ minX: 10, minY: 20, maxX: 30, maxY: 50 })
  })

  it('path 가 비면 빈 배열', () => {
    expect(explodePathData('')).toEqual([])
    expect(explodePathData('M0,0')).toEqual([])
  })

  it('망가진 좌표는 건너뛴다 (NaN 이 바운딩박스를 통째로 날린다)', () => {
    const r = explodePathData('M0,0L10,0Mxx,yyL20,0M10,0L10,9')
    expect(r).toHaveLength(1)
    expect(Number.isFinite(r[0].minX)).toBe(true)
  })

  it('돌려준 점들로 path 를 다시 만들면 같은 선분이 나온다', () => {
    // 분해 결과가 그대로 새 shape 의 pathData 가 된다 — 왕복이 깨지면 안 된다.
    const src = 'M0,0L10,0M10,0L10,10'
    const r = explodePathData(src)
    expect(parseSegments(toPathData(r[0]))).toEqual(parseSegments(src))
  })

  it('새 shape 자리로 **좌표를 민다**', () => {
    // 새 shape 은 제 바운딩박스 왼쪽 위에 앉으므로, path 는 거기 기준이어야 한다.
    const r = explodePathData('M10,20L30,20M30,20L30,50')[0]
    const segs = parseSegments(toPathData(r, r.minX, r.minY))
    expect(segs[0]).toEqual({ x1: 0, y1: 0, x2: 20, y2: 0 })
    expect(segs[1]).toEqual({ x1: 20, y1: 0, x2: 20, y2: 30 })
  })
})

describe('planExplode — 먼저 세어 본다', () => {
  it('쪼갤 게 없으면 nothing', () => {
    // 선분 하나짜리를 하나로 쪼개는 건 아무것도 안 하는 것이다.
    expect(planExplode(['M0,0L10,0']).kind).toBe('nothing')
    expect(planExplode([]).kind).toBe('nothing')
    expect(planExplode(['']).kind).toBe('nothing')
  })

  it('여러 덩어리를 한꺼번에 센다', () => {
    const p = planExplode(['M0,0L10,0M50,0L60,0', 'M0,99L10,99'])
    expect(p.kind).toBe('ok')
    if (p.kind === 'ok') expect(p.paths.flat()).toHaveLength(3)
  })

  it('너무 많이 쪼개지면 **안 한다**', () => {
    // 분해는 shape 수를 늘린다. 한 번에 수백 개가 생기면 그 사이 화면이 멎어
    // 되돌릴 기회도 없다. 미리 세어 보고 막는다.
    const many = Array.from({ length: MAX_EXPLODE_SHAPES + 5 }, (_, i) => `M${i * 100},0L${i * 100 + 10},0`).join('')
    const p = planExplode([many])
    expect(p.kind).toBe('too-many')
    if (p.kind === 'too-many') expect(p.count).toBe(MAX_EXPLODE_SHAPES + 5)
  })

  it('한도 안쪽이면 그대로 간다', () => {
    const ok = Array.from({ length: MAX_EXPLODE_SHAPES }, (_, i) => `M${i * 100},0L${i * 100 + 10},0`).join('')
    expect(planExplode([ok]).kind).toBe('ok')
  })
})

// ── 에디터에 적용 ──

type FakeShape = {
  id: string
  type: string
  x: number
  y: number
  rotation: number
  parentId: string
  opacity?: number
  props: Record<string, unknown>
  meta: Record<string, unknown>
}

/** `explodeDxfShapes` 가 실제로 부르는 것만 흉내 낸다. */
function fakeEditor(shapes: FakeShape[]) {
  const created: FakeShape[] = []
  const deleted: string[] = []
  return {
    created,
    deleted,
    editor: {
      getShape: (id: string) => shapes.find(s => s.id === id),
      run: (fn: () => void) => fn(),
      createShapes: (xs: FakeShape[]) => created.push(...xs),
      deleteShapes: (ids: string[]) => deleted.push(...ids),
      setSelectedShapes: () => {},
    } as never,
  }
}

function dxf(over: Partial<FakeShape> = {}): FakeShape {
  return {
    id: 'shape:src',
    type: 'dxfgroup',
    x: 100,
    y: 50,
    rotation: 0,
    parentId: 'page:main',
    // 떨어진 두 줄 → 조각 둘
    props: { pathData: 'M0,0L10,0M200,100L210,100', thickness: 0 },
    meta: {},
    ...over,
  }
}

describe('explodeDxfShapes — 원본의 자리를 물려준다', () => {
  it('그룹 안에 있던 것은 **그 그룹에 그대로 남는다**', () => {
    // 전엔 parentId 를 안 실어서 tldraw 가 현재 페이지에 붙였다. 그런데
    // 그룹 안 도형의 x,y 는 부모 기준이라, 페이지에 그 숫자를 그대로 놓으면
    // 엉뚱한 자리로 간다 — 그리고 원본은 지워진다.
    const shape = dxf({ parentId: 'shape:group1' })
    const { editor, created, deleted } = fakeEditor([shape])
    expect(explodeDxfShapes(editor, ['shape:src'] as never).kind).toBe('ok')
    expect(created.length).toBeGreaterThan(1)
    expect(created.every(c => c.parentId === 'shape:group1')).toBe(true)
    expect(deleted).toEqual(['shape:src'])
  })

  it('돌려 둔 도면은 **돌아간 채로** 쪼개진다', () => {
    const shape = dxf({ rotation: Math.PI / 2, x: 0, y: 0 })
    const { editor, created } = fakeEditor([shape])
    explodeDxfShapes(editor, ['shape:src'] as never)
    expect(created.every(c => c.rotation === Math.PI / 2)).toBe(true)

    // 90° 돌면 원본 안쪽의 (200,100) 은 부모 좌표로 (-100,200) 에 간다.
    // rotation 만 넣고 자리를 안 돌리면 (200,100) 에 그대로 남아 어긋난다.
    const far = created.find(c => Math.abs(c.x + 100) < 1e-6)
    expect(far, JSON.stringify(created.map(c => [c.x, c.y]))).toBeTruthy()
    expect(far!.y).toBeCloseTo(200, 6)
  })

  it('안 돌린 것은 전처럼 그냥 더한다', () => {
    const { editor, created } = fakeEditor([dxf()])
    explodeDxfShapes(editor, ['shape:src'] as never)
    expect(created.some(c => c.x === 100 && c.y === 50)).toBe(true)
    expect(created.some(c => c.x === 300 && c.y === 150)).toBe(true)
  })

  it('흐려 둔 레이어는 흐린 채로 남는다', () => {
    const { editor, created } = fakeEditor([dxf({ opacity: 0.3 })])
    explodeDxfShapes(editor, ['shape:src'] as never)
    expect(created.every(c => c.opacity === 0.3)).toBe(true)
  })

  it('글자·해치 덩이도 같은 자리를 물려받는다', () => {
    const shape = dxf({
      rotation: Math.PI / 2,
      parentId: 'shape:group1',
      // 줄이 하나뿐이면 `planExplode` 가 "쪼갤 게 없다" 며 그만둔다
      props: { pathData: 'M0,0L10,0M200,100L210,100', thickness: 0, w: 10, h: 10, textsJson: '[{"t":"x"}]' },
    })
    const { editor, created } = fakeEditor([shape])
    explodeDxfShapes(editor, ['shape:src'] as never)
    const texts = created.filter(c => (c.props as { textsJson?: string }).textsJson)
    expect(texts).toHaveLength(1)
    expect(texts[0].parentId).toBe('shape:group1')
    expect(texts[0].rotation).toBe(Math.PI / 2)
  })
})
