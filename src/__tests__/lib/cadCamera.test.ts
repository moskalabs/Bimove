import { describe, it, expect } from 'vitest'
import { screenToPage, pageToScreen, onScreen, zoomAt, type CadCam } from '../../lib/cadCamera'

const BOX = { w: 800, h: 600 }

describe('cadCamera', () => {
  it('화면 한가운데는 카메라가 보고 있는 그 점이다', () => {
    const cam: CadCam = { cx: 100, cy: 200, scale: 2 }
    // 엔진 (100, 200) → page (100, -200)
    expect(screenToPage(cam, { x: 400, y: 300 }, BOX)).toEqual({ x: 100, y: -200 })
    expect(pageToScreen(cam, { x: 100, y: -200 }, BOX)).toEqual({ x: 400, y: 300 })
  })

  it('왕복하면 제자리다', () => {
    const cams: CadCam[] = [
      { cx: 0, cy: 0, scale: 1 },
      { cx: -1234.5, cy: 987.25, scale: 0.013 },
      { cx: 5e5, cy: -5e5, scale: 123.75 },
    ]
    for (const cam of cams) {
      for (const p of [{ x: 0, y: 0 }, { x: 37, y: -812 }, { x: -9000, y: 4500 }]) {
        const back = screenToPage(cam, pageToScreen(cam, p, BOX), BOX)
        expect(back.x).toBeCloseTo(p.x, 6)
        expect(back.y).toBeCloseTo(p.y, 6)
      }
    }
  })

  it('page 의 y 는 **아래로** 자란다 — 엔진과 반대다', () => {
    // 이게 뒤집히면 핀이 도면 위아래로 거울처럼 뒤집혀 꽂힌다.
    const cam: CadCam = { cx: 0, cy: 0, scale: 1 }
    const up = pageToScreen(cam, { x: 0, y: -100 }, BOX)   // page y 작음 = 위
    const down = pageToScreen(cam, { x: 0, y: 100 }, BOX)  // page y 큼 = 아래
    expect(up.y).toBeLessThan(down.y)
  })

  it('x 는 뒤집히지 않는다', () => {
    const cam: CadCam = { cx: 0, cy: 0, scale: 1 }
    const left = pageToScreen(cam, { x: -100, y: 0 }, BOX)
    const right = pageToScreen(cam, { x: 100, y: 0 }, BOX)
    expect(left.x).toBeLessThan(right.x)
  })

  it('확대하면 같은 거리가 더 벌어진다', () => {
    const near: CadCam = { cx: 0, cy: 0, scale: 1 }
    const far: CadCam = { cx: 0, cy: 0, scale: 4 }
    const d = (c: CadCam) =>
      pageToScreen(c, { x: 100, y: 0 }, BOX).x - pageToScreen(c, { x: 0, y: 0 }, BOX).x
    expect(d(far)).toBeCloseTo(d(near) * 4, 6)
  })

  it('onScreen — 여백만큼 너그럽다', () => {
    expect(onScreen({ x: 400, y: 300 }, BOX)).toBe(true)
    expect(onScreen({ x: -5, y: 300 }, BOX)).toBe(false)
    // 핀은 가운데가 기준이라 가장자리에서 반쯤 걸친다. 딱 자르면 깜빡인다.
    expect(onScreen({ x: -5, y: 300 }, BOX, 20)).toBe(true)
    expect(onScreen({ x: 815, y: 610 }, BOX, 20)).toBe(true)
    expect(onScreen({ x: 900, y: 300 }, BOX, 20)).toBe(false)
  })

  it('zoomAt — 커서 밑 점이 제자리에 남는다', () => {
    const cam: CadCam = { cx: 0, cy: 0, scale: 1 }
    const cursor = { x: 620, y: 140 }
    const before = screenToPage(cam, cursor, BOX)
    zoomAt(cam, cursor, BOX, 2.5)
    const after = screenToPage(cam, cursor, BOX)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    expect(cam.scale).toBeCloseTo(2.5, 6)
  })

  it('zoomAt 을 되감으면 카메라가 돌아온다', () => {
    const cam: CadCam = { cx: 12, cy: -34, scale: 3 }
    zoomAt(cam, { x: 100, y: 500 }, BOX, 1.7)
    zoomAt(cam, { x: 100, y: 500 }, BOX, 1 / 1.7)
    expect(cam.cx).toBeCloseTo(12, 6)
    expect(cam.cy).toBeCloseTo(-34, 6)
    expect(cam.scale).toBeCloseTo(3, 6)
  })

  it('뷰어가 쓰던 식과 같은 답을 낸다', () => {
    // CadCraftViewer.onWheel 에 인라인으로 있던 바로 그 계산. 떼어내면서
    // 숫자가 달라지면 "줌이 커서에서 빗나간다" 로 나타난다.
    const cam: CadCam = { cx: 7, cy: -3, scale: 0.4 }
    const r = { width: BOX.w, height: BOX.h }
    const sx = 613, sy = 97
    const dx = sx - r.width / 2
    const dy = sy - r.height / 2
    const wx = cam.cx + dx / cam.scale
    const wy = cam.cy - dy / cam.scale

    const page = screenToPage(cam, { x: sx, y: sy }, BOX)
    expect(page.x).toBeCloseTo(wx, 9)
    expect(page.y).toBeCloseTo(-wy, 9)
  })
})
