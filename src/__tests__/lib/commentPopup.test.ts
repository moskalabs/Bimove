import { describe, it, expect } from 'vitest'
import { placePopup, PIN, POPUP_W, POPUP_MAX_H } from '../../lib/commentPopup'

/** 창이 상자 안에 **통째로** 들어갔나. 잘리면 입력칸과 버튼이 안 보인다. */
function inside(p: { left: number; top: number; width: number; maxHeight: number }, box: { w: number; h: number }) {
  return p.left >= 0 && p.top >= 0 && p.left + p.width <= box.w && p.top + p.maxHeight <= box.h
}

const BOX = { w: 900, h: 700 }

describe('placePopup', () => {
  it('자리가 있으면 핀 오른쪽에 붙는다', () => {
    const p = placePopup(100, 200, BOX)
    expect(p.left).toBe(100 + PIN / 2 + 12)
    expect(p.width).toBe(POPUP_W)
    expect(inside(p, BOX)).toBe(true)
  })

  it('오른쪽 끝이면 왼쪽으로 뒤집는다', () => {
    const p = placePopup(BOX.w - 20, 200, BOX)
    expect(p.left).toBeLessThan(BOX.w - 20)
    expect(inside(p, BOX)).toBe(true)
  })

  it('아래쪽 끝이어도 안 잘린다 — 전엔 아예 보지도 않았다', () => {
    const p = placePopup(100, BOX.h - 10, BOX)
    expect(inside(p, BOX)).toBe(true)
  })

  it('네 귀퉁이 어디에 찍어도 상자 안이다', () => {
    for (const x of [-50, 0, 1, BOX.w / 2, BOX.w - 1, BOX.w + 50]) {
      for (const y of [-50, 0, 1, BOX.h / 2, BOX.h - 1, BOX.h + 50]) {
        expect(inside(placePopup(x, y, BOX), BOX), `(${x},${y})`).toBe(true)
      }
    }
  })

  it('기준은 창이 아니라 **캔버스**다', () => {
    // 1920 짜리 창에서 좌우 패널을 뺀 캔버스가 900 이면, x=800 짜리 핀은
    // 창 기준으로는 한참 여유가 있지만 캔버스에서는 뒤집어야 한다.
    const p = placePopup(800, 100, BOX)
    expect(p.left + p.width).toBeLessThanOrEqual(BOX.w)
  })

  it('캔버스가 창보다 낮으면 천장도 같이 낮아진다', () => {
    const squat = { w: 900, h: 240 }
    const p = placePopup(100, 100, squat)
    expect(p.maxHeight).toBeLessThan(POPUP_MAX_H)
    expect(inside(p, squat)).toBe(true)
  })

  it('아무리 좁아도 창을 뭉개지는 않는다 — 입력칸이 사라지면 못 쓴다', () => {
    const tiny = { w: 300, h: 80 }
    expect(placePopup(10, 10, tiny).maxHeight).toBeGreaterThanOrEqual(120)
  })

  it('아직 못 잰 상자(첫 그림)에는 밀지 않는다', () => {
    // 0 으로 밀면 핀이 어디 있든 창이 전부 왼쪽 위로 쏠린다.
    const p = placePopup(400, 300, { w: 0, h: 0 })
    expect(p.left).toBe(400 + PIN / 2 + 12)
    expect(p.top).toBe(300 - PIN)
  })
})
