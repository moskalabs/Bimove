/**
 * Test: 호/타원 호 샘플링 공용 함수 (dxf-shared.ts).
 *
 * 리닝 도면 F-1 레이어에 회색 원반 네 개가 떠 있던 사고의 뒤처리다. HATCH
 * 테두리의 타원 호 edge 가 gc 50/51(도) 을 라디안으로 읽어서 `51 = 360` 이
 * 57 바퀴가 됐고, 고정 샘플링한 자기교차 다각형이 단색 채움(nonzero) 으로
 * 타원을 가득 메웠다. 같은 블록이 네 벌 복붙돼 있어서 각자 단위를 정했다.
 *
 * 그래서 샘플링을 한 군데로 모으고, 스윕을 한 바퀴로 잠갔다. 여기서 보는 건
 * 그 **안전망 자체** 다 — 단위를 또 틀리든 DXF 가 쓰레기 값을 주든 테두리가
 * 한 바퀴를 넘게 돌 수 없다는 것.
 */
import { describe, it, expect } from 'vitest'
import { normalizeArcSweepDeg, sampleArcDeg } from '../../lib/dxf-shared'

describe('normalizeArcSweepDeg — 스윕은 0 초과 360 이하', () => {
  it('보통 호는 그대로 둔다', () => {
    expect(normalizeArcSweepDeg(0, 90)).toEqual({ startDeg: 0, sweepDeg: 90 })
    expect(normalizeArcSweepDeg(-90, 0)).toEqual({ startDeg: -90, sweepDeg: 90 })
  })

  it('끝각이 시작각보다 작으면 0도를 지나 돌아온 것이다', () => {
    expect(normalizeArcSweepDeg(350, 10)).toEqual({ startDeg: 350, sweepDeg: 20 })
  })

  it('시작 = 끝 이면 한 바퀴 (0도짜리 호는 없다)', () => {
    expect(normalizeArcSweepDeg(0, 0)).toEqual({ startDeg: 0, sweepDeg: 360 })
    expect(normalizeArcSweepDeg(45, 45)).toEqual({ startDeg: 45, sweepDeg: 360 })
  })

  // 이게 안전망의 핵심. `51 = 360` 을 라디안으로 잘못 읽으면 360 rad =
  // 20626도 = 57 바퀴가 된다. 그래도 한 바퀴를 넘지 못한다.
  it('한 바퀴를 넘는 값은 한 바퀴로 자른다', () => {
    expect(normalizeArcSweepDeg(0, 720).sweepDeg).toBe(360)
    expect(normalizeArcSweepDeg(0, 20626).sweepDeg).toBe(360)
    expect(normalizeArcSweepDeg(0, 1e9).sweepDeg).toBe(360)
  })

  it('NaN/Infinity 는 시작 0, 끝 360 으로 본다', () => {
    expect(normalizeArcSweepDeg(NaN, 90)).toEqual({ startDeg: 0, sweepDeg: 90 })
    expect(normalizeArcSweepDeg(0, NaN)).toEqual({ startDeg: 0, sweepDeg: 360 })
    expect(normalizeArcSweepDeg(Infinity, -Infinity)).toEqual({ startDeg: 0, sweepDeg: 360 })
  })

  it('gc 73 = 0 (시계방향) 이면 시작/끝을 뒤집는다', () => {
    expect(normalizeArcSweepDeg(0, 90, false)).toEqual({ startDeg: 90, sweepDeg: 270 })
  })
})

describe('sampleArcDeg — 각도는 도(度)', () => {
  it('조각 N 개면 점은 N+1 개 (끝점 포함)', () => {
    // 기본 15도에 한 조각.
    expect(sampleArcDeg({ cx: 0, cy: 0, rx: 10, startDeg: 0, endDeg: 90 })).toHaveLength(7)
    expect(sampleArcDeg({ cx: 0, cy: 0, rx: 10, startDeg: 0, endDeg: 360 })).toHaveLength(25)
  })

  // 라디안으로 되돌려 조각 수를 세면 360도가 24.000000000000004 가 되어
  // ceil 이 조각을 하나 더 만든다. 도 단위로 세면 정확히 24.
  it('한 바퀴는 딱 24조각 (부동소수점 반올림 없음)', () => {
    const pts = sampleArcDeg({ cx: 0, cy: 0, rx: 100, startDeg: 0, endDeg: 360 })
    expect(pts).toHaveLength(25)
    expect(pts[0][0]).toBeCloseTo(100, 9)
    expect(pts[0][1]).toBeCloseTo(0, 9)
    expect(pts[24][0]).toBeCloseTo(100, 9)
    expect(pts[24][1]).toBeCloseTo(0, 9)
    // 90도마다 축에 정확히 올라앉는다.
    expect(pts[6][0]).toBeCloseTo(0, 9)
    expect(pts[6][1]).toBeCloseTo(100, 9)
    expect(pts[12][0]).toBeCloseTo(-100, 9)
    expect(pts[18][1]).toBeCloseTo(-100, 9)
  })

  it('아무리 짧은 호도 3조각은 낸다', () => {
    expect(sampleArcDeg({ cx: 0, cy: 0, rx: 10, startDeg: 0, endDeg: 1 })).toHaveLength(4)
  })

  it('stepDeg 로 해상도를 조절한다', () => {
    // 270도 / 10도 = 27조각.
    expect(sampleArcDeg({
      cx: 0, cy: 0, rx: 10, startDeg: 0, endDeg: 270, stepDeg: 10,
    })).toHaveLength(28)
  })

  it('segments 를 주면 stepDeg 를 무시한다', () => {
    expect(sampleArcDeg({
      cx: 0, cy: 0, rx: 10, startDeg: 0, endDeg: 360, stepDeg: 1, segments: 24,
    })).toHaveLength(25)
  })

  it('중심을 옮기면 점도 같이 옮겨간다', () => {
    const pts = sampleArcDeg({ cx: 5, cy: -3, rx: 2, startDeg: 0, endDeg: 360 })
    for (const [x, y] of pts) expect(Math.hypot(x - 5, y + 3)).toBeCloseTo(2, 9)
  })

  it('ry 를 주면 타원, 안 주면 원', () => {
    const circle = sampleArcDeg({ cx: 0, cy: 0, rx: 50, startDeg: 0, endDeg: 360 })
    for (const [x, y] of circle) expect(Math.hypot(x, y)).toBeCloseTo(50, 9)

    const ellipse = sampleArcDeg({ cx: 0, cy: 0, rx: 100, ry: 50, startDeg: 0, endDeg: 360 })
    for (const [x, y] of ellipse) {
      expect((x / 100) ** 2 + (y / 50) ** 2).toBeCloseTo(1, 9)
    }
  })

  // 단축비 0 인 HATCH 는 실제로 나온다 (퇴화한 테두리). 선분으로 찌그러뜨리면
  // 채움이 사라지므로 원으로 본다.
  it('ry 가 0 이하/비정상이면 rx 를 쓴다', () => {
    for (const ry of [0, -10, NaN, Infinity]) {
      const pts = sampleArcDeg({ cx: 0, cy: 0, rx: 7, ry, startDeg: 0, endDeg: 360 })
      for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeCloseTo(7, 9)
    }
  })

  it('rot 은 라디안 — 장축을 돌린다', () => {
    // 100x50 타원을 90도 돌리면 세로로 길어진다.
    const pts = sampleArcDeg({
      cx: 0, cy: 0, rx: 100, ry: 50, rot: Math.PI / 2, startDeg: 0, endDeg: 360,
    })
    const xs = pts.map(([x]) => x), ys = pts.map(([, y]) => y)
    expect(Math.max(...xs)).toBeCloseTo(50, 9)
    expect(Math.max(...ys)).toBeCloseTo(100, 9)
  })

  it('rx/rot 이 비정상이면 0 으로 떨어진다 (NaN 좌표를 내지 않는다)', () => {
    for (const [x, y] of sampleArcDeg({
      cx: 1, cy: 2, rx: NaN, rot: NaN, startDeg: 0, endDeg: 360,
    })) {
      expect(Number.isFinite(x)).toBe(true)
      expect(Number.isFinite(y)).toBe(true)
    }
  })

  // 사고 재현 — 단위를 틀려 57 바퀴짜리 끝각이 들어와도 테두리는 한 바퀴만 돈다.
  it('깨진 끝각이 들어와도 한 바퀴를 넘지 않는다', () => {
    const pts = sampleArcDeg({ cx: 0, cy: 0, rx: 100, startDeg: 0, endDeg: 20626 })
    expect(pts).toHaveLength(25)
    // 각도가 단조증가하고 2π 를 한 번만 지난다 — 자기교차 별모양이 아니다.
    const angles = pts.map(([x, y]) => Math.atan2(y, x))
    const wrapped = angles.filter((t, i) => i > 0 && t < angles[i - 1] - 1e-9)
    expect(wrapped).toHaveLength(1)
  })
})
