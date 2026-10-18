/**
 * 발주서 패널이 **기준값 없이 서버에 쓰지 않는다.**
 *
 * 서버 쓰기 경로에는 prune 이 붙어 있다 — 서버에 있는데 내 목록엔 없는 행을
 * 지운다. 그래서 기준 없이 쓰면 다른 기기가 방금 만든 물량표·품목이
 * 삭제된다. 발주서에는 버전 백업이 없어서 되돌릴 방법도 없다.
 *
 * 여기서 보는 건 세 가지다 —
 *   1. 서버에서 받은 시각을 **그대로** 쓰기 조건으로 넘기는가
 *   2. 서버를 **못 읽었으면** 아예 안 쓰는가 (서버 상태를 모르니까)
 *   3. 충돌을 만나면 **멈추는가** (자동으로 덮어쓰지 않는가)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { PurchaseOrder } from '../../lib/purchaseOrder'
import { savePurchaseOrder } from '../../lib/purchaseOrder'

const SERVER_AT = '2026-10-09T09:00:00.000+00:00'

const fetchPurchaseOrder = vi.fn()
const syncPurchaseOrder = vi.fn()
const toasts: Array<{ msg: string; kind?: string }> = []

vi.mock('../../lib/supabaseSync', () => ({
  fetchPurchaseOrder: (...a: unknown[]) => fetchPurchaseOrder(...a),
  syncPurchaseOrder: (...a: unknown[]) => syncPurchaseOrder(...a),
}))
vi.mock('../../context/EditorContext', () => ({ useEditor: () => null }))
vi.mock('../../context/ProjectContext', () => ({
  useProjectId: () => 'p1',
  useProjectName: () => ({ name: 'p', setName: () => {} }),
}))
vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ toast: (msg: string, kind?: string) => { toasts.push({ msg, kind }) } }),
}))

const { POTablesTab } = await import('../../components/panels/boq/POTablesTab')

const remotePo = (): PurchaseOrder => ({
  projectId: 'p1',
  tables: [{ id: 't0', templateId: 'wall-paint', label: '벽체', createdAt: 0, items: [] }],
  updatedAt: Date.parse(SERVER_AT),
  serverUpdatedAt: SERVER_AT,
})

/** 디바운스(2초)를 넘긴다. 보내기는 비동기라 microtask 도 흘려준다. */
async function letItSync() {
  await act(async () => {
    vi.advanceTimersByTime(2100)
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** 물량표를 하나 추가해 `po` 를 바꾼다 — 자동 저장을 다시 돌리려고. */
async function addATable() {
  fireEvent.click(await screen.findByTitle('물량표 추가'))
  const tpl = document.querySelector('.po-template-label')
  expect(tpl, '템플릿 목록이 안 떴다').toBeTruthy()
  fireEvent.click(tpl!.closest('button') ?? tpl!)
}

beforeEach(() => {
  localStorage.clear()
  toasts.length = 0
  fetchPurchaseOrder.mockReset()
  syncPurchaseOrder.mockReset()
  syncPurchaseOrder.mockResolvedValue({ kind: 'ok', serverUpdatedAt: '2026-10-09T09:01:00.000+00:00' })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => { vi.useRealTimers() })

describe('발주서 서버 쓰기 가드', () => {
  it('서버에서 받은 시각을 그대로 쓰기 조건으로 넘긴다', async () => {
    fetchPurchaseOrder.mockResolvedValue(remotePo())
    render(<POTablesTab />)
    await act(async () => { await Promise.resolve() })
    await letItSync()

    expect(syncPurchaseOrder).toHaveBeenCalled()
    // 두 번째 인자가 기준값이다. ms 로 깎으면 .eq() 가 안 맞는다 —
    // 받은 문자열 그대로여야 한다.
    expect(syncPurchaseOrder.mock.calls[0][1]).toBe(SERVER_AT)
  })

  it('로컬이 더 최신이어서 화면을 안 바꿔도 기준값은 받아 둔다', async () => {
    // 쓰기 조건과 화면 선택은 별개다. 로컬을 올리기로 했어도 올릴 때는
    // 서버가 들고 있는 값으로 조건을 걸어야 그 사이 남의 저장을 안 덮는다.
    savePurchaseOrder({ projectId: 'p1', tables: [], updatedAt: 0 })
    fetchPurchaseOrder.mockResolvedValue(remotePo())
    render(<POTablesTab />)
    await act(async () => { await Promise.resolve() })
    await letItSync()

    expect(syncPurchaseOrder.mock.calls[0][1]).toBe(SERVER_AT)
  })

  it('서버를 못 읽었으면 **서버에 쓰지 않는다**', async () => {
    // 서버 상태를 모르는데 쓰면 기준 없는 덮어쓰기 + prune 이다.
    fetchPurchaseOrder.mockRejectedValue(new Error('네트워크'))
    render(<POTablesTab />)
    await act(async () => { await Promise.resolve() })
    await letItSync()

    expect(syncPurchaseOrder).not.toHaveBeenCalled()
    expect(toasts.some(t => t.msg.includes('이 기기에만 저장'))).toBe(true)
  })

  it('충돌을 만나면 멈추고 알린다 — 다시 덮어쓰지 않는다', async () => {
    fetchPurchaseOrder.mockResolvedValue(remotePo())
    syncPurchaseOrder.mockResolvedValue({ kind: 'conflict', serverUpdatedAt: '2026-10-09T09:09:00.000+00:00' })
    render(<POTablesTab />)
    await act(async () => { await Promise.resolve() })
    await letItSync()

    expect(syncPurchaseOrder).toHaveBeenCalledTimes(1)
    expect(toasts.some(t => t.msg.includes('다른 기기에서 발주서를 수정'))).toBe(true)

    // 멈춘 뒤에 더 고쳐도 서버로 보내지 않는다. 자동으로 덮어쓰면 상대
    // 작업이 사라지고 발주서에는 되돌릴 백업이 없다.
    await addATable()
    await letItSync()
    expect(syncPurchaseOrder).toHaveBeenCalledTimes(1)
  })

  it('멀쩡할 때는 고칠 때마다 보내고, 기준값을 이어 받는다', async () => {
    fetchPurchaseOrder.mockResolvedValue(remotePo())
    render(<POTablesTab />)
    await act(async () => { await Promise.resolve() })
    await letItSync()
    expect(syncPurchaseOrder).toHaveBeenCalledTimes(1)

    await addATable()
    await letItSync()
    expect(syncPurchaseOrder).toHaveBeenCalledTimes(2)
    // 첫 쓰기가 돌려준 값이 두 번째의 기준이 된다
    expect(syncPurchaseOrder.mock.calls[1][1]).toBe('2026-10-09T09:01:00.000+00:00')
  })
})
