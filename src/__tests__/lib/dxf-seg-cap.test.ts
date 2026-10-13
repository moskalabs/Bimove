/**
 * 세그먼트 하드 캡 회귀 테스트.
 *
 * 성수 파일(24.11_성수_포레스트_평면-3) 모형 탭에서 "선 잘리는 부분" 이 보였다.
 * 뷰포트도 아웃라이어도 아니라 100k 캡이 범인이었다 — 예전 캡은 레이어마다
 * 같은 **비율**로 균등 샘플링했는데, 그 파일은 해치 레이어 CO-HAT 하나가
 * 세그먼트 120206개 중 73540개(61%)를 쥐고 있고 중앙 길이가 1.7 단위다.
 * 비율대로 깎으면 눈에 안 보이는 해치는 멀쩡한데 벽(F_WALL, 53개, 중앙 길이
 * 540)에서 9개(17%)가 사라져 도면에 구멍이 뚫렸다.
 *
 * 그래서 전역 길이순으로 바꿨다. 같은 파일에서 잘리는 길이가 1.74 단위 —
 * 화면에서 1px 도 안 되는 것만 떨어져 나가고 구조물 레이어는 전부 살아남는다.
 * 레이어마다 가장 긴 MIN_SEGS_PER_LAYER 개는 먼저 떼어 보장해 두므로, 예전
 * 규칙이 지키려던 "특정 레이어만 통째로 날아가는 것 방지" 도 그대로 남아 있다.
 */
import { describe, it, expect } from 'vitest'
import { capByLength, filterAndCleanSegments, MAX_FINAL_SEGS, MIN_SEGS_PER_LAYER } from '../../lib/dxf'
import type { RawSeg } from '../../lib/dxf'

/** 길이 len 인 가로 세그먼트 n 개 */
function segs(layer: string | undefined, n: number, len: number): RawSeg[] {
  const out: RawSeg[] = []
  for (let i = 0; i < n; i++) out.push({ x1: 0, y1: i, dx: len, dy: 0, layer })
  return out
}

const length = (s: RawSeg) => Math.hypot(s.dx, s.dy)

function countByLayer(list: RawSeg[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of list) {
    const k = s.layer || '0'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

/**
 * 성수 모형 탭 모양: 해치가 예산을 다 먹고 구조물은 몇십 개뿐.
 * 구조물 개수는 실측 그대로 쓰고, 해치만 **상한보다 넉넉히** 잡는다 —
 * 상한값을 바꿔도 "넘치는 상황" 이라는 전제가 유지돼야 한다.
 */
const SEONGSU = [
  ...segs('CO-HAT', MAX_FINAL_SEGS + 20_000, 1.7),
  ...segs('F_WALL', 53, 540),
  ...segs('TB-FORM', 335, 2400),
]

/** 예전 캡 — 레이어별 비례 균등 샘플링. 회귀 비교용으로만 남겨둔다. */
function proportionalSample(all: RawSeg[]): RawSeg[] {
  const ratio = MAX_FINAL_SEGS / all.length
  const byLayer = new Map<string, RawSeg[]>()
  for (const s of all) {
    const key = s.layer || '0'
    let arr = byLayer.get(key)
    if (!arr) { arr = []; byLayer.set(key, arr) }
    arr.push(s)
  }
  const sampled: RawSeg[] = []
  for (const [, layerSegs] of byLayer) {
    const keep = Math.max(1, Math.round(layerSegs.length * ratio))
    if (keep >= layerSegs.length) {
      for (const s of layerSegs) sampled.push(s)
    } else {
      const step = layerSegs.length / keep
      for (let i = 0; i < keep; i++) sampled.push(layerSegs[Math.floor(i * step)])
    }
  }
  return sampled
}

describe('capByLength', () => {
  it('상한 아래면 하나도 안 버린다', () => {
    const few = segs('F_WALL', 10, 540)
    const kept = capByLength(few)
    expect(kept).toHaveLength(10)
    expect(new Set(kept)).toEqual(new Set(few))
  })

  it('상한을 정확히 지킨다', () => {
    expect(capByLength(SEONGSU)).toHaveLength(MAX_FINAL_SEGS)
  })

  it('해치가 예산을 먹어도 벽·도면틀은 다 남는다 — 성수 모형 탭 모양', () => {
    const after = countByLayer(capByLength(SEONGSU))
    expect(after.get('F_WALL')).toBe(53)
    expect(after.get('TB-FORM')).toBe(335)
    // 줄어든 건 전부 해치 쪽
    expect(after.get('CO-HAT')).toBe(MAX_FINAL_SEGS - 53 - 335)
  })

  it('예전 비례 샘플링이면 벽과 도면틀이 깎였다 (회귀)', () => {
    const old = countByLayer(proportionalSample(SEONGSU))
    // 비율 기준이라 길이와 무관하게 깎인다 — 벽 한 줄이 통째로 없어져 구멍이 뚫렸다.
    expect(old.get('F_WALL')).toBeLessThan(53)
    expect(old.get('TB-FORM')).toBeLessThan(335)
    // 길이 기준(현행)은 같은 입력에서 둘 다 100% 지킨다
    const now = countByLayer(capByLength(SEONGSU))
    expect(now.get('F_WALL')).toBe(53)
    expect(now.get('TB-FORM')).toBe(335)
  })

  it('버린 건 남긴 것보다 길지 않다', () => {
    // 한 레이어 안에서 길이를 다 다르게 — 레이어 최소 보장이 끼어들지 않는다
    const graded: RawSeg[] = []
    for (let i = 0; i < MAX_FINAL_SEGS + 50; i++) graded.push(...segs('C-1', 1, i + 1))

    const kept = new Set(capByLength(graded))
    const dropped = graded.filter(s => !kept.has(s))

    // 가장 짧은 50개가 정확히 떨어져 나간다 (길이 1~50)
    expect(dropped.map(length).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
  })

  it('짧은 선뿐인 레이어도 통째로 사라지지 않는다', () => {
    // 해치(1.7)가 예산을 다 먹고, 더 짧은(1.0) 자잘한 레이어 10개가 경쟁한다
    const tiny = Array.from({ length: 10 }, (_, i) => segs(`TINY-${i}`, 50, 1))
    const all = [...segs('CO-HAT', MAX_FINAL_SEGS, 1.7), ...tiny.flat()]

    const after = countByLayer(capByLength(all))
    for (let i = 0; i < 10; i++) {
      expect(after.get(`TINY-${i}`)).toBe(MIN_SEGS_PER_LAYER)
    }
  })

  it("layer 가 없는 세그먼트는 '0' 레이어로 묶는다", () => {
    // 레이어가 따로 잡히면 15+15 가 둘 다 최소 보장에 들어 30개가 남는다.
    // 한 덩어리로 묶여야 20개만 남는다.
    const all = [
      ...segs('TB-FORM', MAX_FINAL_SEGS, 1000),
      ...segs(undefined, 15, 2),
      ...segs('0', 15, 2),
    ]
    expect(countByLayer(capByLength(all)).get('0')).toBe(MIN_SEGS_PER_LAYER)
  })
})

/**
 * 상한값 자체의 회귀.
 *
 * 성수 파일 배치 탭 실측 — 정제가 끝난 세그먼트가 273,237개다. 상한이 100k
 * 였을 때 그 중 173,237개(63.4%)가 잘렸고, CO-HAT 는 146,941개 중 3,521개
 * (2%)만 남았다. 캡을 뺀 쪽을 래스터라이즈해 비교하니 지시선과 가구 디테일이
 * 통째로 없어져 있었다 — 한이 본 "선 잘리는 부분" 이 이것이다.
 */
describe('상한값', () => {
  /** 성수 배치 탭 실측 (정제 후) */
  const SEONGSU_PLAN_SEGS = 273_237

  it('성수 배치 탭이 한 개도 안 잘리고 들어온다', () => {
    expect(MAX_FINAL_SEGS).toBeGreaterThanOrEqual(SEONGSU_PLAN_SEGS)
  })

  it('그래도 상한은 남아 있다 (망가진 파일 안전망)', () => {
    expect(Number.isFinite(MAX_FINAL_SEGS)).toBe(true)
    expect(MAX_FINAL_SEGS).toBeLessThanOrEqual(1_000_000)
  })
})

/**
 * 캡 손실은 **따로** 보고해야 한다.
 *
 * 예전엔 캡 손실이 '세그먼트 정제(...)' 한 줄에 합쳐졌는데, ImportPanel 은
 * 그 사유로 시작하는 항목을 토스트에서 빼 버린다. 그래서 도면의 63% 가
 * 날아가도 쓰는 사람에게는 아무 말도 안 나갔다.
 */
describe('filterAndCleanSegments 손실 보고', () => {
  /**
   * 병합에 안 걸리는 세그먼트 n 개.
   *
   * segs() 를 쓰면 안 된다 — 전부 x1=0 가로선이라 mergeDxfSegments 의 버킷 키
   * (`round(perp/10)`) 가 10줄씩 묶고 구간이 완전히 겹쳐서 10:1 로 접힌다.
   * 캡에 닿기 전에 입력이 사라지므로 캡 손실을 잴 수 없다. y 를 20 씩 띄우면
   * 버킷이 세그먼트마다 하나씩이라 병합이 일어나지 않는다.
   */
  function scatter(layer: string, n: number, len: number): RawSeg[] {
    const out: RawSeg[] = []
    for (let i = 0; i < n; i++) out.push({ x1: 0, y1: i * 20, dx: len, dy: 0, layer })
    return out
  }

  /** 성수 배치 탭 모양으로 상한을 2만개 넘긴다 */
  const OVERFLOW = [
    ...scatter('CO-HAT', MAX_FINAL_SEGS + 20_000, 1.7),
    ...scatter('F_WALL', 53, 540),
    ...scatter('TB-FORM', 335, 2400),
  ]

  function collect(input: RawSeg[]): Record<string, number> {
    const report: Record<string, number> = {}
    filterAndCleanSegments(input, (reason, n) => {
      if (n > 0) report[reason] = (report[reason] ?? 0) + n
    })
    return report
  }

  it('캡에 걸리면 정제와 다른 사유로 센다', () => {
    const report = collect(OVERFLOW)
    const capKey = Object.keys(report).find(k => k.startsWith('세그먼트 상한'))
    expect(capKey).toBeDefined()
    expect(report[capKey!]).toBe(OVERFLOW.length - MAX_FINAL_SEGS)
  })

  it('캡 사유는 토스트에서 걸러지지 않는다', () => {
    // ImportPanel.summarizeImportReport 가 빼는 접두사들
    const capKey = Object.keys(collect(OVERFLOW)).find(k => k.startsWith('세그먼트 상한'))!
    expect(capKey.startsWith('세그먼트 정제')).toBe(false)
    expect(capKey.startsWith('도면 범위 밖')).toBe(false)
  })

  it('사유별 합이 실제 손실과 맞는다 (이중계상 없음)', () => {
    const report: Record<string, number> = {}
    const kept = filterAndCleanSegments(OVERFLOW, (reason, n) => {
      if (n > 0) report[reason] = (report[reason] ?? 0) + n
    })
    const total = Object.values(report).reduce((a, b) => a + b, 0)
    expect(total).toBe(OVERFLOW.length - kept.length)
  })

  it('캡에 안 걸리면 상한 사유를 안 띄운다', () => {
    const report = collect(scatter('F_WALL', 10, 540))
    expect(Object.keys(report).some(k => k.startsWith('세그먼트 상한'))).toBe(false)
  })
})
