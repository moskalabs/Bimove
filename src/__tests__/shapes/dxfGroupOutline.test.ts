/**
 * 선택 테두리 범위 회귀 테스트.
 *
 * shape 의 props.w/h 는 **선만 보고 잡은 크기**다. 글자는 거기 안 들어간다.
 * 가운데·오른쪽 정렬된 글자는 기준점에서 왼쪽으로 뻗으므로, w/h 를 그대로
 * 테두리로 쓰면 선택 상자가 글자를 자르고 지나간다.
 */
import { describe, it, expect } from 'vitest'
import { outlineBounds } from '../../shapes/DxfGroupShape'
import { packTextsJson } from '../../lib/dxf'

type Txt = { x: number; y: number; t: string; h: number; ap?: number; mw?: number }

/** outlineBounds 가 보는 최소한의 shape */
const shapeWith = (w: number, h: number, texts: Txt[] = []) => ({
  props: {
    w, h,
    textsJson: texts.length ? packTextsJson(texts) : '',
    pathData: 'M0,0L10,10',
    thickness: 1, segCount: 1, hatchesJson: '',
  },
}) as never

describe('outlineBounds', () => {
  it('글자가 없으면 shape 크기 그대로다', () => {
    expect(outlineBounds(shapeWith(200, 100))).toEqual({ x: 0, y: 0, w: 200, h: 100 })
  })

  it('가운데 정렬 글자가 왼쪽으로 삐져나가면 그만큼 넓힌다', () => {
    // ap=5(MC), 기준점 x=10 → 글자는 10 을 중심으로 좌우로 뻗는다.
    // 폭 어림값 = h × 글자수 × 0.6 = 20 × 10 × 0.6 = 120 → 왼쪽 끝 -50
    const b = outlineBounds(shapeWith(200, 100, [
      { x: 10, y: 50, t: '내부리모델링공사가', h: 20, ap: 5 },
    ]))
    expect(b.x).toBeLessThan(0)
    expect(b.x + b.w).toBeGreaterThanOrEqual(200)
  })

  it('왼쪽 정렬 글자는 오른쪽으로만 넓힌다', () => {
    const b = outlineBounds(shapeWith(200, 100, [
      { x: 190, y: 50, t: '기준선표기', h: 20, ap: 7 },   // BL
    ]))
    expect(b.x).toBe(0)
    expect(b.x + b.w).toBeGreaterThan(200)
  })

  it('MTEXT 는 정의된 폭(mw)을 그대로 쓴다', () => {
    // 어림값 대신 DXF 가 알려준 폭이 있으면 그게 맞다.
    const b = outlineBounds(shapeWith(100, 100, [
      { x: 50, y: 50, t: 'A', h: 10, ap: 1, mw: 400 },
    ]))
    expect(b.x + b.w).toBeCloseTo(450, 1)
  })

  it('여러 줄 글자는 줄 수만큼 세로로 넓힌다', () => {
    const one = outlineBounds(shapeWith(10, 10, [{ x: 0, y: 0, t: '한줄', h: 10, ap: 1 }]))
    const three = outlineBounds(shapeWith(10, 10, [{ x: 0, y: 0, t: '한줄\n두줄\n세줄', h: 10, ap: 1 }]))
    expect(three.h).toBeGreaterThan(one.h)
  })

  it('baseline 기준 글자는 위로 뻗는다 (아래가 아니다)', () => {
    // ap=7(BL) 은 기준점이 글자 **밑선**이라 글자는 그 위에 있다.
    const b = outlineBounds(shapeWith(100, 100, [{ x: 50, y: 0, t: '제목', h: 30, ap: 7 }]))
    expect(b.y).toBeLessThan(0)
  })
})
