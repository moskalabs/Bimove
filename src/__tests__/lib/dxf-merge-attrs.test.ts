/**
 * mergeDxfSegments 속성 보존 회귀 테스트
 *
 * 동일선상 병합은 구간 하나를 `first` 세그먼트의 속성으로 대표해서 내보낸다.
 * 그래서 두 가지가 동시에 맞아야 한다.
 *
 *  1. **키**: 다르게 보여야 하는 속성(layer / color / linetype / lineweight)이
 *     버킷 키에 들어가야 한다. 빠지면 파선과 실선이 한 버킷에 섞여 병합되고,
 *     결과는 `first` 하나의 속성으로 뭉개진다.
 *  2. **출력**: 병합 결과에 그 속성들을 실어 보내야 한다. `flush()` 가
 *     layer/color 만 넣고 linetypeName/lineweight 를 떨구면, 파싱이 아무리
 *     정확해도 화면에선 전부 실선·기본 굵기로 그려진다.
 */
import { describe, it, expect } from 'vitest'
import { mergeDxfSegments, type RawSeg } from '../../lib/dxf'

/** (x1,y1) 에서 길이 len 만큼 +x 방향 수평 세그먼트 */
function hseg(x1: number, y1: number, len: number, attrs: Partial<RawSeg> = {}): RawSeg {
  return { x1, y1, dx: len, dy: 0, ...attrs }
}

describe('mergeDxfSegments: 속성 보존', () => {
  it('병합된 구간이 linetypeName / lineweight 를 유지한다', () => {
    // 끊어짐 없이 이어지는 파선 2개 → 1개로 병합
    const out = mergeDxfSegments([
      hseg(0, 0, 100, { layer: 'W1', color: '#ff0000', linetypeName: 'DASHED', lineweight: 50 }),
      hseg(100, 0, 100, { layer: 'W1', color: '#ff0000', linetypeName: 'DASHED', lineweight: 50 }),
    ])

    expect(out).toHaveLength(1)
    expect(out[0].dx).toBeCloseTo(200)
    expect(out[0].linetypeName).toBe('DASHED')
    expect(out[0].lineweight).toBe(50)
  })

  it('linetype 이 다른 세그먼트는 병합되지 않는다', () => {
    // 겹치는 위치에 파선/실선. 키에 linetype 이 없으면 하나로 합쳐지고
    // 파선 속성이 사라진다.
    const out = mergeDxfSegments([
      hseg(0, 0, 100, { layer: 'W1', linetypeName: 'DASHED' }),
      hseg(100, 0, 100, { layer: 'W1' }),
    ])

    expect(out).toHaveLength(2)
    expect(out.map(s => s.linetypeName).sort()).toEqual(['DASHED', undefined])
  })

  it('lineweight 가 다른 세그먼트는 병합되지 않는다', () => {
    const out = mergeDxfSegments([
      hseg(0, 0, 100, { layer: 'W1', lineweight: 13 }),
      hseg(100, 0, 100, { layer: 'W1', lineweight: 70 }),
    ])

    expect(out).toHaveLength(2)
    expect(out.map(s => s.lineweight).sort((a, b) => a! - b!)).toEqual([13, 70])
  })

  it('레이어가 다른 세그먼트는 병합되지 않는다', () => {
    // 병합되면 한쪽 레이어의 선이 다른 레이어로 흡수된다 → 레이어 끄기/BOQ 가 틀어진다
    const out = mergeDxfSegments([
      hseg(0, 0, 100, { layer: 'WALL' }),
      hseg(100, 0, 100, { layer: 'DOOR' }),
    ])

    expect(out).toHaveLength(2)
    expect(out.map(s => s.layer).sort()).toEqual(['DOOR', 'WALL'])
  })

  it('색이 다른 세그먼트는 병합되지 않는다 (기존 동작 유지)', () => {
    const out = mergeDxfSegments([
      hseg(0, 0, 100, { layer: 'W1', color: '#ff0000' }),
      hseg(100, 0, 100, { layer: 'W1', color: '#0000ff' }),
    ])

    expect(out).toHaveLength(2)
  })

  it('속성이 같고 gap 이 10px 를 넘으면 따로 남는다', () => {
    const out = mergeDxfSegments([
      hseg(0, 0, 100, { layer: 'W1', linetypeName: 'HIDDEN' }),
      hseg(200, 0, 100, { layer: 'W1', linetypeName: 'HIDDEN' }),
    ])

    expect(out).toHaveLength(2)
    expect(out.every(s => s.linetypeName === 'HIDDEN')).toBe(true)
  })
})
