/**
 * 발주서 로컬/서버 선택 회귀 테스트.
 *
 * 예전엔 `remote.tables.length > 0` 하나로 갈랐다. 두 가지가 어긋난다 —
 *
 *   1. 서버에서 **다 지운** 상태가 무시되어, 로컬에 남은 삭제 전 데이터가
 *      다음 동기화 때 서버로 되살아난다.
 *   2. 시각을 안 보므로, 아직 못 올린 로컬 수정이 낡은 서버 데이터에 덮인다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
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

// ── 새 기기에서 서버 발주서가 지워지던 경로 ──
//
// 이 기기에 저장된 게 없을 때 loadPurchaseOrder 가 `updatedAt: Date.now()` 인
// 빈 발주서를 돌려줬다. 그러면 시각 비교에서 **서버가 낡아 보이고**, 서버를
// 거부한 뒤 그 빈 발주서를 올려 남의 발주서를 지웠다.
//
// 저장한 적이 없으면 0 이 맞다. 그리고 호출부는 "로컬이 아예 없음" 을 따로
// 보고 비교 없이 서버를 받는다.

import {
  loadPurchaseOrder, savePurchaseOrder, hasStoredPurchaseOrder,
} from '../../lib/purchaseOrder'
import { setCurrentUserId } from '../../lib/scopedStorage'

/** POTablesTab 의 판단을 그대로 옮긴 것 */
function decideTakeRemote(
  projectId: string,
  remote: { updatedAt: number },
): boolean {
  const hadLocal = hasStoredPurchaseOrder(projectId)
  const local = loadPurchaseOrder(projectId)
  return !hadLocal || shouldTakeRemotePO(remote, local)
}

describe('새 기기에서 발주서 불러오기', () => {
  beforeEach(() => {
    localStorage.clear()
    setCurrentUserId('u1')
  })

  it('저장된 적 없으면 updatedAt 은 0 이다', () => {
    // Date.now() 였다면 서버가 늘 낡아 보인다.
    expect(loadPurchaseOrder('p1').updatedAt).toBe(0)
    expect(hasStoredPurchaseOrder('p1')).toBe(false)
  })

  it('로컬이 없으면 서버를 그대로 받는다 (서버가 아무리 오래돼도)', () => {
    // 여기가 깨지면 새 기기 접속만으로 서버 발주서가 날아간다.
    const ancient = { updatedAt: 1 }
    expect(decideTakeRemote('p1', ancient)).toBe(true)
  })

  it('한 번 저장한 뒤에는 시각으로 가린다', () => {
    savePurchaseOrder({ projectId: 'p1', tables: [], updatedAt: 0 })
    expect(hasStoredPurchaseOrder('p1')).toBe(true)
    // 방금 저장했으므로 낡은 서버는 지지 않는다
    expect(decideTakeRemote('p1', { updatedAt: 1 })).toBe(false)
    // 뚜렷하게 새 서버는 받는다
    expect(decideTakeRemote('p1', { updatedAt: Date.now() + 60_000 })).toBe(true)
  })

  it('savePurchaseOrder 는 넘긴 객체를 고치지 않는다', () => {
    // 호출부가 넘기는 건 React state 다. 제자리에서 바꾸면 리렌더 없이 값만
    // 달라져 화면과 어긋난다.
    const po = { projectId: 'p1', tables: [], updatedAt: 0 }
    const saved = savePurchaseOrder(po)
    expect(po.updatedAt).toBe(0)
    expect(saved.updatedAt).toBeGreaterThan(0)
    expect(saved).not.toBe(po)
  })

  it('사용자가 다르면 "저장된 적 없음" 으로 본다', () => {
    savePurchaseOrder({ projectId: 'p1', tables: [], updatedAt: 0 })
    setCurrentUserId('u2')
    expect(hasStoredPurchaseOrder('p1')).toBe(false)
    expect(decideTakeRemote('p1', { updatedAt: 1 })).toBe(true)
  })
})
