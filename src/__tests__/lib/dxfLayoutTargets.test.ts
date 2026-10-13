/**
 * buildLayoutTargets — 레이아웃 목록이 몇 장의 페이지가 되는가.
 *
 * 제보: 오토캐드에 모형/배치1/Layout1 3개 탭인 도면이 Bimove 엔 2장으로
 * 들어왔다. 뷰포트를 못 찾은 레이아웃을 통째로 건너뛰고 있어서, 탭이
 * **조용히 사라졌다**. 이제 탭 자리는 반드시 남긴다 (도형만 비운다).
 */
import { describe, it, expect } from 'vitest'
import { buildLayoutTargets, unlabeledPaperOwner, type DxfLayout, type DxfViewport } from '../../lib/dxf-shared'

const layout = (name: string, tabOrder: number, isModelSpace = false): DxfLayout => ({
  name, isModelSpace, tabOrder, paperWidth: 420, paperHeight: 297,
})

// paper* 는 종이 위 창이다. clip* 과 달리 여기 테스트들은 대부분 안 쓰므로
// A3 가운데 200x150 창을 기본값으로 둔다 (축척은 paperH / viewHeight).
const vp = (
  layoutName: string, cx: number, cy: number, w: number, h: number,
  paper?: { cx: number; cy: number; w: number; h: number },
): DxfViewport => ({
  layoutName,
  centerX: cx, centerY: cy,
  viewWidth: w, viewHeight: h,
  clipMinX: cx - w / 2, clipMinY: cy - h / 2,
  clipMaxX: cx + w / 2, clipMaxY: cy + h / 2,
  paperCX: paper?.cx ?? 210, paperCY: paper?.cy ?? 148.5,
  paperW: paper?.w ?? 200, paperH: paper?.h ?? 150,
})

/**
 * gc 410 이 없는 ENTITIES 종이 엔티티의 주인 탭 고르기.
 *
 * DXF 는 저장 당시 활성 탭의 BLOCK_RECORD 를 접미사 없는 `*Paper_Space` 로
 * 쓴다. 그 탭 하나만 가져가야 같은 시트가 중복으로 안 들어온다.
 */
describe('unlabeledPaperOwner', () => {
  const withBlock = (name: string, blockName: string | null, isModelSpace = false): DxfLayout =>
    ({ ...layout(name, 1, isModelSpace), blockName })

  it('`*Paper_Space` 를 가진 탭을 고른다', () => {
    expect(unlabeledPaperOwner([
      withBlock('Model', null, true),
      withBlock('Layout1', '*Paper_Space0'),
      withBlock('배치1', '*Paper_Space'),
    ])).toBe('배치1')
  })

  it('대소문자는 무시한다', () => {
    expect(unlabeledPaperOwner([withBlock('배치1', '*PAPER_SPACE')])).toBe('배치1')
  })

  it('후보가 없으면 null — 예전처럼 모든 탭이 가져간다', () => {
    expect(unlabeledPaperOwner([
      withBlock('Layout1', '*Paper_Space0'),
      withBlock('Layout2', '*Paper_Space1'),
    ])).toBeNull()
  })

  it('후보가 둘이면 null — 못 고르면 잃는 쪽보다 중복이 낫다', () => {
    expect(unlabeledPaperOwner([
      withBlock('A', '*Paper_Space'),
      withBlock('B', '*Paper_Space'),
    ])).toBeNull()
  })

  it('모형 탭은 후보가 아니다', () => {
    expect(unlabeledPaperOwner([withBlock('Model', '*Paper_Space', true)])).toBeNull()
  })

  it('blockName 이 없으면 후보가 아니다', () => {
    expect(unlabeledPaperOwner([withBlock('Layout1', null)])).toBeNull()
  })
})

describe('buildLayoutTargets', () => {
  it('탭 하나당 페이지 하나 — 뷰포트가 없어도 자리는 남긴다', () => {
    const layouts = [layout('Model', 0, true), layout('배치1', 1), layout('Layout1', 2)]
    const vps = new Map([['배치1', [vp('배치1', 100, 200, 400, 300)]]])

    const targets = buildLayoutTargets(layouts, vps)

    expect(targets.map(t => t.layout.name)).toEqual(['Model', '배치1', 'Layout1'])
    expect(targets.map(t => t.geometry)).toEqual([true, true, false])
  })

  // 도형까지 넣으면 clip 이 없어서 모델공간 전체가 복사된다 = 모형 탭의 복제본.
  it('뷰포트 없는 탭은 clip 도 도형도 없다', () => {
    const targets = buildLayoutTargets([layout('Model', 0, true), layout('Layout1', 1)], new Map())
    const empty = targets.find(t => t.layout.name === 'Layout1')!
    expect(empty.clip).toBeNull()
    expect(empty.geometry).toBe(false)
  })

  it('모형 탭은 clip 없이 전체를 쓴다', () => {
    const targets = buildLayoutTargets([layout('Model', 0, true)], new Map())
    expect(targets).toHaveLength(1)
    expect(targets[0].clip).toBeNull()
    expect(targets[0].geometry).toBe(true)
  })

  it('뷰포트가 여러 개면 clip 은 그 합집합', () => {
    const vps = new Map([['배치1', [
      vp('배치1', 0, 0, 100, 100),      // (-50,-50)~(50,50)
      vp('배치1', 500, 300, 200, 100),  // (400,250)~(600,350)
    ]]])
    const targets = buildLayoutTargets([layout('Model', 0, true), layout('배치1', 1)], vps)

    expect(targets[1].clip).toEqual({ minX: -50, minY: -50, maxX: 600, maxY: 350 })
  })

  it('탭 순서(code 71)대로 정렬한다', () => {
    const layouts = [layout('C', 3), layout('Model', 0, true), layout('A', 1), layout('B', 2)]
    const targets = buildLayoutTargets(layouts, new Map())
    expect(targets.map(t => t.layout.name)).toEqual(['Model', 'A', 'B', 'C'])
  })

  // 정렬 때문에 입력 배열을 제자리에서 뒤집으면 호출한 쪽의 state 가 깨진다.
  it('입력 배열을 건드리지 않는다', () => {
    const layouts = [layout('C', 3), layout('Model', 0, true)]
    buildLayoutTargets(layouts, new Map())
    expect(layouts.map(l => l.name)).toEqual(['C', 'Model'])
  })

  it('레이아웃이 없으면 빈 배열', () => {
    expect(buildLayoutTargets([], new Map())).toEqual([])
  })

  // 2단계: 종이 탭에 모델 도형을 끌어오려면 창마다 모델→종이 사상이 필요하다.
  it('뷰포트마다 모델→종이 사상을 같이 넘긴다', () => {
    const vps = new Map([['배치1', [
      vp('배치1', 1000, 2000, 20000, 15000, { cx: 210, cy: 148.5, w: 200, h: 150 }),
    ]]])
    const targets = buildLayoutTargets([layout('Model', 0, true), layout('배치1', 1)], vps)

    expect(targets[0].viewports).toEqual([])
    expect(targets[1].viewports).toHaveLength(1)
    const p = targets[1].viewports[0]
    expect(p.modelCX).toBe(1000)
    expect(p.modelCY).toBe(2000)
    expect(p.scale).toBeCloseTo(150 / 15000, 12)   // 1/100
    expect(p.paperCX).toBe(210)
    expect(p.paperH).toBe(150)
  })

  // viewHeight 0 이면 scale 이 Infinity → 좌표가 전부 NaN 이 된다. clip 은
  // 그래도 쓸 수 있으니 탭은 살리고 사상만 뺀다.
  it('축척을 못 구하는 뷰포트는 사상에서 빠진다', () => {
    const bad = vp('배치1', 0, 0, 0, 0)
    const vps = new Map([['배치1', [bad, vp('배치1', 10, 10, 100, 100)]]])
    const targets = buildLayoutTargets([layout('배치1', 1)], vps)

    expect(targets[0].geometry).toBe(true)
    expect(targets[0].viewports).toHaveLength(1)
    expect(targets[0].viewports[0].modelCX).toBe(10)
  })
})
