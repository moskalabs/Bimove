/**
 * Test: HATCH 패턴 축척(gc 41) / 각도(gc 52) / 정의선(gc 78, 53, 45, 46) 파싱.
 *
 * 이 코드들은 DXF 에서 boundary path **뒤에** 온다. 예전 파서는 gc 91 앞의
 * 헤더 구간에서만 41/52 를 찾았으므로 모든 해치가 축척 1 / 각도 0 으로
 * 들어갔고, 정의선은 통째로 스킵됐다 — 실제 도면에서 축척 60 짜리
 * _USER 교차 해치가 45도 사선 하나로 렌더되는 원인이었다.
 *
 * ── 2026-10-19: 보는 대상을 **출하되는 파서**로 옮겼다 ──
 *
 * 이 테스트는 `dxf.ts` 의 `parseRawHatches` 를 보고 있었다. 그런데 그 함수는
 * 앱 어디서도 안 부른다 — 입력으로 받던 "파싱된 엔티티 객체" 를 만들어 주던
 * dxf-parser(npm) 경로가 지워지면서 **호출자가 사라졌다.** 초록불이었지만
 * 출하되는 코드는 하나도 지키지 않고 있었던 셈이다.
 *
 * 실제로 해치를 읽는 건 워커의 `parseHatchEntity` 인데, 거기는 패턴 정의선
 * 테스트가 **하나도 없었다.** 그래서 같은 코드 배치를 워커에 그대로 먹인다.
 *
 * (node 환경 지정을 뺐다. 워커 모듈은 맨 끝에서 `self.onmessage` 를 걸므로
 *  node 에서는 import 자체가 터진다 — dxf-hatch-style 등 다른 워커 테스트도
 *  같은 이유로 jsdom 에서 돈다.)
 */
import { describe, it, expect } from 'vitest'
import { parseHatchEntity } from '../../lib/dxf-fast-worker'
import { defLineSpacing } from '../../lib/dxf-shared'

type Pair = [string, string]

/**
 * 워커가 받는 한 덩이. 엔티티 이름 줄 뒤로 코드/값이 한 줄씩 온다.
 * (`parseHatchEntity` 는 1번 줄부터 두 줄씩 짝으로 읽는다.)
 */
const asChunk = (pairs: Pair[]): string =>
  ['HATCH', ...pairs.flat()].join('\n') + '\n'

/** 실제 도면(out.dxf)의 십자형 _USER 해치와 같은 코드 배치. */
function crossHatch(): Pair[] {
  return [
    ['5', '30FA8'], ['330', '1F'],
    ['100', 'AcDbEntity'], ['8', '0'], ['62', '8'], ['48', '30.0'],
    ['100', 'AcDbHatch'],
    ['10', '0.0'], ['20', '0.0'], ['30', '0.0'],
    ['210', '0.0'], ['220', '0.0'], ['230', '1.0'],
    ['2', '_USER'], ['70', '0'], ['71', '0'],
    ['91', '1'],
    // boundary path: 폴리라인 아닌 edge 타입(72=1, 직선) 4개로 사각형
    ['92', '0'], ['93', '4'],
    ['72', '1'], ['10', '0'], ['20', '0'], ['11', '100'], ['21', '0'],
    ['72', '1'], ['10', '100'], ['20', '0'], ['11', '100'], ['21', '100'],
    ['72', '1'], ['10', '100'], ['20', '100'], ['11', '0'], ['21', '100'],
    ['72', '1'], ['10', '0'], ['20', '100'], ['11', '0'], ['21', '0'],
    ['97', '0'],
    // --- 여기부터 패턴 정의 데이터 (헤더가 아니라 boundary 뒤) ---
    ['75', '1'], ['76', '0'],
    ['52', '0.0'], ['41', '60.0'], ['77', '1'],
    ['78', '2'],
    ['53', '0.0'], ['43', '0.0'], ['44', '0.0'], ['45', '0.0'], ['46', '60.0'], ['79', '0'],
    ['53', '90.0'], ['43', '0.0'], ['44', '0.0'], ['45', '-60.0'], ['46', '0.0'], ['79', '0'],
    ['47', '1.0'],
    ['98', '1'], ['10', '50.0'], ['20', '50.0'],
  ]
}

describe('HATCH 패턴 정의 데이터', () => {
  const h = parseHatchEntity(asChunk(crossHatch()), '0')!

  it('해치를 읽는다', () => {
    expect(h).toBeTruthy()
  })

  it('boundary path 뒤의 gc 41 축척을 읽는다', () => {
    expect(h.patternScale).toBe(60)
  })

  it('gc 52 각도를 읽는다', () => {
    expect(h.patternAngle).toBe(0)
  })

  it('gc 78 정의선 수를 읽는다 (2 = 교차 해치)', () => {
    expect(h.patternDefLines).toBe(2)
  })

  it('정의선 offset(gc 45/46) 에서 실제 간격을 계산한다', () => {
    expect(h.patternSpacing).toBeCloseTo(60, 6)
  })

  it('첫 정의선의 각도(gc 53)를 쓴다 — 45도 기본값이 아니다', () => {
    expect(h.patternDefAngle).toBe(0)
  })

  it('패턴명과 단색 플래그(gc 70=0)를 유지한다', () => {
    expect(h.patternName).toBe('_USER')
    expect(h.solidFill).toBe(false)
  })

  it('seed point(gc 98 뒤의 10/20)를 boundary 로 잘못 먹지 않는다', () => {
    // 사각형 네 변 = 8점. seed (50,50) 이 섞이면 centroid 가 틀어진다.
    expect(h.cx).toBeCloseTo(50, 6)
    expect(h.cy).toBeCloseTo(50, 6)
  })

  it('정의선을 각도·간격·dash 까지 전부 수집한다', () => {
    expect(h.patternDefs).toEqual([
      { angle: 0, spacing: 60, dashes: [] },
      { angle: 90, spacing: 60, dashes: [] },
    ])
  })
})

/**
 * 실제 도면의 AR-RROOF (축척 30) 정의선.
 * 오프셋 (1676.5, 761.9) 은 선 방향 성분과 수직 성분이 섞여 있다 —
 * .pat 원본 `0, 0,0, 2.2,1, 15,-2,5,-1` 에서
 * 수직 1 x 25.4 x 30 = 762, 선 방향 2.2 x 25.4 x 30 = 1676.4.
 * hypot 로 재면 1841 이 나와서 간격이 2.4배 넓어진다.
 */
function dashedRoof(): Pair[] {
  return [
    ['5', '1A2B'], ['330', '1F'],
    ['100', 'AcDbEntity'], ['8', 'ROOF'],
    ['100', 'AcDbHatch'],
    ['10', '0.0'], ['20', '0.0'], ['30', '0.0'],
    ['210', '0.0'], ['220', '0.0'], ['230', '1.0'],
    ['2', 'AR-RROOF'], ['70', '0'], ['71', '0'],
    ['91', '1'],
    ['92', '0'], ['93', '2'],
    ['72', '1'], ['10', '0'], ['20', '0'], ['11', '100'], ['21', '0'],
    ['72', '1'], ['10', '100'], ['20', '100'], ['11', '0'], ['21', '0'],
    ['97', '0'],
    ['75', '1'], ['76', '1'],
    ['52', '0.0'], ['41', '30.0'], ['77', '0'],
    ['78', '1'],
    ['53', '0.0'], ['43', '0.0'], ['44', '0.0'],
    ['45', '1676.4'], ['46', '762.0'],
    ['79', '4'], ['49', '11430.0'], ['49', '-1524.0'], ['49', '3810.0'], ['49', '-762.0'],
    ['47', '1.0'],
    ['98', '0'],
  ]
}

describe('HATCH 정의선 dash', () => {
  const h = parseHatchEntity(asChunk(dashedRoof()), 'ROOF')!

  it('dash 길이(gc 49)를 순서대로 모은다 — 음수는 공백', () => {
    expect(h.patternDefs).toHaveLength(1)
    expect(h.patternDefs[0].dashes).toEqual([11430, -1524, 3810, -762])
  })

  it('간격은 오프셋의 수직 성분 — hypot(1841) 이 아니다', () => {
    expect(h.patternDefs[0].spacing).toBeCloseTo(762, 3)
    expect(h.patternSpacing).toBeCloseTo(762, 3)
  })
})

describe('defLineSpacing', () => {
  it('수평선: offY 가 그대로 간격', () => {
    expect(defLineSpacing(0, 1676.4, 762)).toBeCloseTo(762, 9)
  })

  it('90도 선: offX 가 간격 (WCS 오프셋이라 축이 바뀐다)', () => {
    // 실제 도면 ANGLE 패턴 값. 1.7e-16 은 cos(90) 반올림 찌꺼기.
    expect(defLineSpacing(90, -2.794, 1.7e-16)).toBeCloseTo(2.794, 9)
  })

  it('선 방향으로만 밀린 오프셋은 간격 0 — 평행선이 안 생긴다', () => {
    expect(defLineSpacing(45, 10, 10)).toBeCloseTo(0, 9)
  })
})
