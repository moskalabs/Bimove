import { describe, it, expect } from 'vitest'
import { parseMultiLeaderLines } from '../../lib/dxf-fast-worker'

/** group code/value 쌍을 DXF chunk 로 만든다. chunk 의 첫 줄은 엔티티 타입이다. */
function chunk(...pairs: Array<[number | string, string]>): string {
  const out = ['MULTILEADER']
  for (const [code, value] of pairs) out.push(String(code), value)
  return out.join('\n') + '\n'
}

describe('parseMultiLeaderLines', () => {
  it('지시선 하나를 꼭짓점 순서대로 돌려준다', () => {
    const lines = parseMultiLeaderLines(chunk(
      [300, 'CONTEXT_DATA{'],
      [10, '100'], [20, '200'],   // content base point — 지시선이 아니다
      [302, 'LEADER{'],
      [304, 'LEADER_LINE{'],
      [10, '10'], [20, '20'],
      [10, '30'], [20, '40'],
      [305, '}'],
      [303, '}'],
      [301, '}'],
    ))
    expect(lines).toEqual([[[10, 20], [30, 40]]])
  })

  it('화살표가 여러 개면 지시선도 따로 나온다', () => {
    // 예전 Map 기반 구현은 이걸 한 줄로 이어 붙여서, 두 화살표 사이에
    // 있지도 않은 선을 그렸다.
    const lines = parseMultiLeaderLines(chunk(
      [300, 'CONTEXT_DATA{'],
      [302, 'LEADER{'],
      [304, 'LEADER_LINE{'],
      [10, '0'], [20, '0'],
      [10, '10'], [20, '10'],
      [305, '}'],
      [304, 'LEADER_LINE{'],
      [10, '100'], [20, '100'],
      [10, '110'], [20, '110'],
      [305, '}'],
      [303, '}'],
      [301, '}'],
    ))
    expect(lines).toEqual([
      [[0, 0], [10, 10]],
      [[100, 100], [110, 110]],
    ])
  })

  it('랜딩과 dogleg 를 끝에 이어 붙인다', () => {
    const lines = parseMultiLeaderLines(chunk(
      [300, 'CONTEXT_DATA{'],
      [41, '2.5'],                 // CONTEXT_DATA 의 41 은 글자 높이 — dogleg 가 아니다
      [302, 'LEADER{'],
      [10, '50'], [20, '50'],      // last leader line point (랜딩)
      [11, '1'], [21, '0'],        // dogleg 방향
      [41, '8'],                   // dogleg 길이
      [304, 'LEADER_LINE{'],
      [10, '0'], [20, '0'],
      [305, '}'],
      [303, '}'],
      [301, '}'],
    ))
    expect(lines).toEqual([[[0, 0], [50, 50], [58, 50]]])
  })

  it('CONTEXT_DATA 바깥의 좌표는 무시한다', () => {
    const lines = parseMultiLeaderLines(chunk(
      [10, '999'], [20, '999'],    // LEADER{ 밖 — 섞여 들어오면 안 된다
      [300, 'CONTEXT_DATA{'],
      [302, 'LEADER{'],
      [304, 'LEADER_LINE{'],
      [10, '1'], [20, '2'],
      [10, '3'], [20, '4'],
      [305, '}'],
      [303, '}'],
      [301, '}'],
    ))
    expect(lines).toEqual([[[1, 2], [3, 4]]])
  })

  it('꼭짓점이 하나뿐이고 랜딩도 없으면 버린다', () => {
    const lines = parseMultiLeaderLines(chunk(
      [300, 'CONTEXT_DATA{'],
      [302, 'LEADER{'],
      [304, 'LEADER_LINE{'],
      [10, '1'], [20, '2'],
      [305, '}'],
      [303, '}'],
      [301, '}'],
    ))
    expect(lines).toEqual([])
  })

  it('지시선이 없는 MULTILEADER 는 빈 배열', () => {
    expect(parseMultiLeaderLines(chunk([300, 'CONTEXT_DATA{'], [301, '}']))).toEqual([])
  })
})
