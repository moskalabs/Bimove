/**
 * 보고 있는 자리와 고른 것.
 *
 * 여기가 틀리면 **화면이 통째로 사라진다** — 0 으로 나눠 카메라가 NaN 이
 * 되거나, 확대 한계를 안 걸어 좌표가 부동소수 바닥을 긁거나, 지운 도형이
 * 고른 채로 남아 속성 패널이 없는 걸 고치려 든다. 전부 되돌릴 방법이 없다.
 */
import { describe, it, expect, vi } from 'vitest'
import { BimoveView } from '../../editor/view'

const BOX = { w: 800, h: 600 }

function view(box = BOX) {
  const v = new BimoveView()
  v.setBox(box)
  return v
}

describe('BimoveView — 카메라', () => {
  it('한가운데가 보고 있는 그 점이다', () => {
    const v = view()
    v.setCenter({ x: 100, y: -200 })
    expect(v.getCenter()).toEqual({ x: 100, y: -200 })
    expect(v.pageToScreen({ x: 100, y: -200 })).toEqual({ x: 400, y: 300 })
  })

  it('왕복하면 제자리', () => {
    const v = view()
    v.setCenter({ x: -1234.5, y: 987.25 })
    v.setZoom(0.013)
    for (const p of [{ x: 0, y: 0 }, { x: 37, y: -812 }, { x: -9000, y: 4500 }]) {
      const back = v.screenToPage(v.pageToScreen(p))
      expect(back.x).toBeCloseTo(p.x, 6)
      expect(back.y).toBeCloseTo(p.y, 6)
    }
  })

  it('page 의 y 는 아래로 자란다', () => {
    // 뒤집히면 도면이 위아래 거울로 보인다.
    const v = view()
    expect(v.pageToScreen({ x: 0, y: -100 }).y).toBeLessThan(v.pageToScreen({ x: 0, y: 100 }).y)
  })

  it('확대하면 커서 밑 점이 제자리에 남는다', () => {
    const v = view()
    const at = { x: 620, y: 140 }
    const before = v.screenToPage(at)
    v.zoomAtScreen(at, 2.5)
    const after = v.screenToPage(at)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    expect(v.getZoom()).toBeCloseTo(2.5, 6)
  })

  it('확대 한계에 닿으면 **중심이 안 밀린다**', () => {
    // 한계만 걸고 그냥 부르면 배율은 그대로인데 중심만 움직여서, 더 못
    // 확대되는 자리에서 화면이 슬금슬금 흐른다.
    const v = view()
    v.setZoom(1e6)
    const center = v.getCenter()
    v.zoomAtScreen({ x: 10, y: 10 }, 4)
    expect(v.getZoom()).toBe(1e6)
    expect(v.getCenter()).toEqual(center)
  })

  it('말도 안 되는 배율은 한계로 접는다', () => {
    const v = view()
    v.setZoom(0)
    expect(v.getZoom()).toBeGreaterThan(0)
    v.setZoom(NaN)
    expect(Number.isFinite(v.getZoom())).toBe(true)
    v.setZoom(-5)
    expect(v.getZoom()).toBeGreaterThan(0)
  })

  it('끈 만큼 도면이 따라온다', () => {
    const v = view()
    v.setZoom(2)
    const p = v.screenToPage({ x: 400, y: 300 })
    v.panByScreen(100, 0)
    // 화면을 오른쪽으로 100px 끌면 그 점이 오른쪽으로 100px 가 있어야 한다.
    expect(v.pageToScreen(p).x).toBeCloseTo(500, 6)
  })

  it('보이는 네모를 page 좌표로 돌려준다', () => {
    const v = view()
    v.setZoom(2)
    v.setCenter({ x: 0, y: 0 })
    const b = v.getVisibleBounds()
    expect(b.maxX - b.minX).toBeCloseTo(400, 6)
    expect(b.maxY - b.minY).toBeCloseTo(300, 6)
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 6)
  })
})

describe('BimoveView — zoomToFit', () => {
  it('네모가 다 들어오고 가운데에 온다', () => {
    const v = view()
    const b = { minX: -100, minY: -50, maxX: 300, maxY: 150 }
    v.zoomToFit(b)
    const vis = v.getVisibleBounds()
    expect(vis.minX).toBeLessThanOrEqual(b.minX)
    expect(vis.maxX).toBeGreaterThanOrEqual(b.maxX)
    expect(vis.minY).toBeLessThanOrEqual(b.minY)
    expect(vis.maxY).toBeGreaterThanOrEqual(b.maxY)
    expect(v.getCenter().x).toBeCloseTo(100, 6)
    expect(v.getCenter().y).toBeCloseTo(50, 6)
  })

  it('캔버스를 아직 안 쟀으면 **아무것도 안 한다**', () => {
    // 0 으로 나누면 카메라가 NaN 이 되고 화면이 통째로 사라진다.
    const v = new BimoveView()
    v.zoomToFit({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
    expect(Number.isFinite(v.getZoom())).toBe(true)
    expect(Number.isFinite(v.getCenter().x)).toBe(true)
  })

  it('찌그러진 네모는 무시한다', () => {
    const v = view()
    v.setZoom(3)
    v.zoomToFit({ minX: 10, minY: 0, maxX: 0, maxY: 100 })
    expect(v.getZoom()).toBe(3)
    v.zoomToFit({ minX: NaN, minY: 0, maxX: 100, maxY: 100 })
    expect(Number.isFinite(v.getZoom())).toBe(true)
  })

  it('점 하나짜리 도면이면 배율은 그대로 두고 그리로 간다', () => {
    const v = view()
    v.setZoom(5)
    v.zoomToFit({ minX: 7, minY: 9, maxX: 7, maxY: 9 })
    expect(v.getZoom()).toBe(5)
    expect(v.getCenter()).toEqual({ x: 7, y: 9 })
  })
})

describe('BimoveView — 선택', () => {
  it('고르고 바꾸고 비운다', () => {
    const v = view()
    v.select('a')
    expect(v.getSelectedIds()).toEqual(['a'])
    v.setSelected(['b', 'c'])
    expect(v.getSelectedIds().sort()).toEqual(['b', 'c'])
    expect(v.isSelected('a')).toBe(false)
    v.selectNone()
    expect(v.getSelectionCount()).toBe(0)
  })

  it('toggle 은 더하고 뺀다 (Shift 클릭)', () => {
    const v = view()
    v.toggle('a')
    v.toggle('b')
    expect(v.getSelectedIds().sort()).toEqual(['a', 'b'])
    v.toggle('a')
    expect(v.getSelectedIds()).toEqual(['b'])
  })

  it('없어진 도형은 고른 목록에서 빠진다', () => {
    // 안 빼면 속성 패널이 **없는 도형**을 고치려 들고, 되돌리면 뜬금없이
    // 골라져 있다.
    const v = view()
    v.setSelected(['a', 'b', 'c'])
    v.pruneSelection(id => id !== 'b')
    expect(v.getSelectedIds().sort()).toEqual(['a', 'c'])
  })
})

describe('BimoveView — 구독', () => {
  it('바뀌면 알린다', () => {
    const v = view()
    const fn = vi.fn()
    v.listen(fn)
    v.select('a')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('**같은 값으로 다시 넣으면 안 알린다**', () => {
    // 안 그러면 화면이 헛돈다 — 선택이 안 바뀌었는데 500개를 다시 그린다.
    const v = view()
    v.setSelected(['a', 'b'])
    const fn = vi.fn()
    v.listen(fn)
    v.setSelected(['b', 'a'])
    v.setZoom(v.getZoom())
    v.setBox(v.getBox())
    v.panByScreen(0, 0)
    v.pruneSelection(() => true)
    expect(fn).not.toHaveBeenCalled()
  })

  it('끊으면 안 온다', () => {
    const v = view()
    const fn = vi.fn()
    v.listen(fn)()
    v.select('a')
    expect(fn).not.toHaveBeenCalled()
  })
})
