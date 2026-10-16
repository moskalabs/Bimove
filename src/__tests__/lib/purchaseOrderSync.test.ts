/**
 * 발주서 로컬/서버 선택 회귀 테스트.
 *
 * 예전엔 `remote.tables.length > 0` 하나로 갈랐다. 두 가지가 어긋난다 —
 *
 *   1. 서버에서 **다 지운** 상태가 무시되어, 로컬에 남은 삭제 전 데이터가
 *      다음 동기화 때 서버로 되살아난다.
 *   2. 시각을 안 보므로, 아직 못 올린 로컬 수정이 낡은 서버 데이터에 덮인다.
 */
import { describe, it, expect } from 'vitest'
import { shouldTakeRemotePO, PO_CLOCK_SKEW_MS } from '../../lib/purchaseOrder'

const T = 1_792_000_000_000

describe('shouldTakeRemotePO', () => {
  it('서버가 뚜렷하게 최신이면 가져온다', () => {
    expect(shouldTakeRemotePO({ updatedAt: T + 60_000 }, { updatedAt: T })).toBe(true)
  })

  it('로컬이 더 최신이면 두고 본다 (아직 못 올린 수정)', () => {
    // 여기가 깨지면 동기화 실패 뒤 다시 열 때 작업이 낡은 서버 데이터에 덮인다.
    expect(shouldTakeRemotePO({ updatedAt: T }, { updatedAt: T + 60_000 })).toBe(false)
  })

  it('시계 차이만큼은 로컬 편을 든다', () => {
    // 로컬은 Date.now(), 서버는 now() 로 찍는다. 디바운스(2초) 안쪽의 차이로
    // 로컬이 지면 안 된다.
    expect(shouldTakeRemotePO({ updatedAt: T + PO_CLOCK_SKEW_MS }, { updatedAt: T })).toBe(false)
    expect(shouldTakeRemotePO({ updatedAt: T + PO_CLOCK_SKEW_MS + 1 }, { updatedAt: T })).toBe(true)
  })

  it('같은 시각이면 로컬을 둔다', () => {
    expect(shouldTakeRemotePO({ updatedAt: T }, { updatedAt: T })).toBe(false)
  })

  it('서버가 비어 있어도 최신이면 가져온다 (삭제가 반영된다)', () => {
    // 길이로 가르던 때는 이 경우가 무시돼서 지운 표가 되살아났다.
    // 이 함수는 내용이 아니라 시각만 본다 — 빈 서버도 최신이면 이긴다.
    expect(shouldTakeRemotePO({ updatedAt: T + 60_000 }, { updatedAt: T })).toBe(true)
  })
})
