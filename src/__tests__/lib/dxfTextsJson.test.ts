/**
 * textsJson pack/unpack 왕복.
 *
 * DxfGroupShape.props.textsJson 은 임포트한 도면의 **모든 텍스트**가 들어가는
 * 자리다. 폰트/색상을 테이블로 빼서 중복을 없애는 "신형" 포맷과, 그 전에
 * 저장된 "구형"(배열 그대로) 포맷이 섞여 있다.
 *
 * 포맷을 건드리면 이미 저장된 프로젝트의 글자가 조용히 사라지거나 폰트/색이
 * 엉킨다 — 에러도 안 나고 콘솔도 조용하다. 그래서 왕복을 못박아 둔다.
 */
import { describe, it, expect } from 'vitest'
import { packTextsJson, unpackTextsJson } from '../../lib/dxf'

type Entry = Parameters<typeof packTextsJson>[0][number]

/** pack → unpack 왕복 결과 */
function roundTrip(texts: Entry[]) {
  return unpackTextsJson(packTextsJson(texts))
}

describe('textsJson pack/unpack', () => {
  it('빈 배열은 빈 문자열이 되고 다시 빈 배열로 돌아온다', () => {
    expect(packTextsJson([])).toBe('')
    expect(unpackTextsJson('')).toEqual([])
  })

  // 폰트/색상이 전부 없으면 테이블이 오히려 손해라 구형(배열) 포맷으로 쓴다.
  it('폰트/색상이 없으면 배열 포맷으로 쓰고 그대로 복원된다', () => {
    const texts: Entry[] = [
      { x: 1, y: 2, t: '가', h: 3 },
      { x: -4.5, y: 0, t: 'B', h: 2.25 },
    ]
    const packed = packTextsJson(texts)
    expect(JSON.parse(packed)).toBeInstanceOf(Array)
    expect(roundTrip(texts)).toEqual(texts)
  })

  it('폰트/색상이 있으면 테이블 포맷으로 쓰고 그대로 복원된다', () => {
    const texts: Entry[] = [
      { x: 0, y: 0, t: 'A', h: 2, f: 'Arial', c: '#FF0000' },
      { x: 10, y: 10, t: 'B', h: 2, f: 'Arial', c: '#00FF00' },
    ]
    const parsed = JSON.parse(packTextsJson(texts))
    expect(parsed.F).toEqual(['Arial'])          // 중복 제거
    expect(parsed.C).toEqual(['#FF0000', '#00FF00'])
    expect(roundTrip(texts)).toEqual(texts)
  })

  // fi / ci 는 0 이 될 수 있다. `if (t.fi)` 로 검사하면 첫 번째 폰트가 날아간다.
  it('테이블 인덱스 0 인 폰트/색상도 살아남는다', () => {
    const texts: Entry[] = [{ x: 0, y: 0, t: 'Z', h: 1, f: '굴림', c: '#123456' }]
    const parsed = JSON.parse(packTextsJson(texts))
    expect(parsed.T[0].fi).toBe(0)
    expect(parsed.T[0].ci).toBe(0)
    expect(roundTrip(texts)).toEqual(texts)
  })

  it('선택 필드 r / ap / mw 가 왕복에서 유지된다', () => {
    const texts: Entry[] = [
      { x: 1, y: 1, t: '회전', h: 2, r: 90, f: 'Arial' },
      { x: 2, y: 2, t: '정렬', h: 2, ap: 4, f: 'Arial' },
      { x: 3, y: 3, t: '폭', h: 2, mw: 120, f: 'Arial' },
      { x: 4, y: 4, t: '전부', h: 2, r: -45, ap: 7, mw: 80, c: '#ABCDEF' },
    ]
    expect(roundTrip(texts)).toEqual(texts)
  })

  // 0 은 "없음"이 아니다. r: 0 / ap: 0 / mw: 0 이 undefined 로 뭉개지면
  // 회전 0도 텍스트가 기본 정렬로 튀어버린다.
  it('값이 0 인 선택 필드도 유지된다', () => {
    const texts: Entry[] = [{ x: 0, y: 0, t: '영', h: 1, r: 0, ap: 0, mw: 0, f: 'Arial' }]
    const back = roundTrip(texts)
    expect(back[0].r).toBe(0)
    expect(back[0].ap).toBe(0)
    expect(back[0].mw).toBe(0)
  })

  it('폰트만 있거나 색상만 있는 경우가 섞여도 된다', () => {
    const texts: Entry[] = [
      { x: 0, y: 0, t: '폰트만', h: 1, f: 'Arial' },
      { x: 1, y: 0, t: '색만', h: 1, c: '#FF00FF' },
      { x: 2, y: 0, t: '둘다없음', h: 1 },
    ]
    expect(roundTrip(texts)).toEqual(texts)
  })

  // 신형 도입 전에 저장된 프로젝트는 배열이 그대로 들어 있다.
  it('구형(배열) 포맷을 그대로 읽는다', () => {
    const legacy = '[{"x":5,"y":6,"t":"구형","h":2,"c":"#000000","f":"Arial"}]'
    expect(unpackTextsJson(legacy)).toEqual([
      { x: 5, y: 6, t: '구형', h: 2, c: '#000000', f: 'Arial' },
    ])
  })

  it('테이블 범위를 벗어난 인덱스는 undefined 로 떨어진다 (throw 하지 않는다)', () => {
    const broken = '{"F":["Arial"],"C":[],"T":[{"x":0,"y":0,"t":"A","h":1,"fi":9,"ci":9}]}'
    const back = unpackTextsJson(broken)
    expect(back).toHaveLength(1)
    expect(back[0].f).toBeUndefined()
    expect(back[0].c).toBeUndefined()
  })

  it('깨진 JSON / 모르는 모양은 빈 배열', () => {
    expect(unpackTextsJson('{{{')).toEqual([])
    expect(unpackTextsJson('{"nope":1}')).toEqual([])
    expect(unpackTextsJson('null')).toEqual([])
    expect(unpackTextsJson('42')).toEqual([])
  })

  it('같은 폰트를 쓰는 텍스트가 많아도 테이블은 한 개만 쌓인다', () => {
    const texts: Entry[] = Array.from({ length: 200 }, (_, i) => ({
      x: i, y: 0, t: `T${i}`, h: 2, f: '맑은 고딕', c: '#333333',
    }))
    const packed = packTextsJson(texts)
    const parsed = JSON.parse(packed)
    expect(parsed.F).toHaveLength(1)
    expect(parsed.C).toHaveLength(1)
    // 테이블로 빼는 게 실제로 이득인지 — 배열 그대로보다 작아야 한다.
    expect(packed.length).toBeLessThan(JSON.stringify(texts).length)
    expect(roundTrip(texts)).toEqual(texts)
  })
})
