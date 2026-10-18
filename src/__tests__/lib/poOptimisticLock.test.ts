/**
 * 발주서 저장의 optimistic lock.
 *
 * 전엔 조건 없이 썼다. 두 기기가 같은 발주서를 고치면 나중 쪽이 이기는데,
 * 이 길에는 prune(서버에 있고 내 목록엔 없는 행을 지우기) 이 붙어 있다 —
 * 즉 상대가 방금 만든 물량표·품목이 **삭제된다.** 도면 스냅샷은 충돌 때
 * 버전으로 백업하지만 발주서에는 그런 게 없어서 되돌릴 방법도 없다.
 *
 * 그래서 여기서 보는 건 "덮어쓰기 전에 멈추는가" 하나다.
 *
 * 모킹은 timestamptz 를 **값으로** 비교한다. 우리가 쓰는 건 JS 의
 * `…T09:00:00.000Z` 인데 같은 행을 다시 읽으면 Postgres 는 `…+00:00` 으로
 * 돌려준다. 글자로 비교하면 내가 방금 쓴 걸 남이 쓴 것으로 보고 매번
 * 충돌이 난다 (스냅샷 쪽에서 실제로 겪은 사고다).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PurchaseOrder } from '../../lib/purchaseOrder'

/** PostgREST 가 timestamptz 를 돌려주는 형식 */
const toPg = (iso: string) => iso.replace(/Z$/, '+00:00')

type ServerTable = { id: string; label: string }

/** 서버의 purchase_orders 한 행 + 딸린 물량표. null 이면 행이 아직 없다. */
let server: { updatedAt: string; tables: ServerTable[] } | null = null
/** RPC 가 몇 번 불렸나 — 충돌 때 **아무것도 안 썼는지** 보는 데 쓴다. */
let rpcCalls = 0
/** true 면 RPC 가 터진다 (네트워크 끊김 흉내). */
let rpcFails = false

vi.mock('../../lib/supabase', () => {
  const makeBuilder = () => {
    const filters: Array<[string, unknown]> = []
    let patch: Record<string, unknown> | null = null

    const matches = () => {
      if (!server) return false
      return filters.every(([col, val]) => {
        if (col === 'project_id') return val === 'p1'
        if (col === 'updated_at') return Date.parse(server!.updatedAt) === Date.parse(String(val))
        return true
      })
    }

    const run = () => {
      if (!server) return { data: null, error: null }
      if (!matches()) return { data: null, error: null }     // 0행
      if (patch?.updated_at) {
        server = { ...server, updatedAt: toPg(String(patch.updated_at)) }
        patch = null
      }
      return {
        data: {
          id: 'po1',
          updated_at: server.updatedAt,
          boq_tables: server.tables.map(t => ({
            id: t.id, template_id: 'wall-paint', label: t.label, sort_order: 0,
            created_at: '2026-10-09T09:00:00.000Z', boq_items: [],
          })),
        },
        error: null,
      }
    }

    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder },
      in: () => builder,
      update: (values: Record<string, unknown>) => { patch = values; return builder },
      upsert: () => builder,
      delete: () => builder,
      single: async () => run(),
      maybeSingle: async () => run(),
      // `.single()`/`.maybeSingle()` 없이 **그냥 await** 하는 질의도 있다
      // (되돌리기 UPDATE 가 그렇다). PostgREST 는 그때도 실제로 실행하므로
      // 여기서도 run() 을 불러야 한다 — 안 그러면 되돌리기가 "안 한 것" 이
      // 되고, 테스트가 코드를 통과시킨다.
      then: (res: (v: unknown) => unknown) => {
        run()
        return res({ data: [], error: null })
      },
    }
    return builder
  }
  return {
    supabase: {
      from: () => makeBuilder(),
      rpc: async (_fn: string, args: { p_project_id: string; p_tables: Array<{ id: string; label: string }> }) => {
        rpcCalls++
        if (rpcFails) return { error: { code: 'XX000', message: '네트워크' } }
        // RPC 는 목록을 그대로 반영하고 updated_at 을 다시 찍는다
        server = {
          updatedAt: toPg(new Date(Date.parse(server?.updatedAt ?? '2026-10-09T09:00:00.000Z') + 60_000).toISOString()),
          tables: args.p_tables.map(t => ({ id: t.id, label: t.label })),
        }
        return { error: null }
      },
    },
    supabaseConfigured: true,
  }
})

const { syncPurchaseOrder, fetchPurchaseOrder } = await import('../../lib/supabaseSync')

const po = (...labels: string[]): PurchaseOrder => ({
  projectId: 'p1',
  updatedAt: Date.parse('2026-10-09T09:05:00.000Z'),
  tables: labels.map((label, i) => ({
    id: `t${i}`, templateId: 'wall-paint' as const, label, createdAt: 0, items: [],
  })),
})

beforeEach(() => {
  server = { updatedAt: toPg('2026-10-09T09:00:00.000Z'), tables: [{ id: 't0', label: '벽체' }] }
  rpcCalls = 0
  rpcFails = false
})

describe('syncPurchaseOrder — optimistic lock', () => {
  it('기준값이 맞으면 쓰고, 새 기준값을 돌려준다', async () => {
    const base = server!.updatedAt
    const r = await syncPurchaseOrder(po('벽체', '천장'), base)
    expect(r.kind).toBe('ok')
    expect(r.serverUpdatedAt).toBe(server!.updatedAt)
    expect(r.serverUpdatedAt).not.toBe(base)       // 서버가 시각을 다시 찍었다
    expect(server!.tables.map(t => t.label)).toEqual(['벽체', '천장'])
  })

  it('연달아 저장해도 자기 자신과 충돌하지 않는다', async () => {
    // 돌려받은 값을 다음 기준으로 쓰는 흐름. 여기가 깨지면 2초마다
    // "다른 기기에서 수정했습니다" 가 뜨고 동기화가 멈춘다.
    const first = await syncPurchaseOrder(po('벽체'), server!.updatedAt)
    expect(first.kind).toBe('ok')
    const second = await syncPurchaseOrder(po('벽체', '바닥'), first.serverUpdatedAt)
    expect(second.kind).toBe('ok')
    const third = await syncPurchaseOrder(po('벽체', '바닥', '천장'), second.serverUpdatedAt)
    expect(third.kind).toBe('ok')
  })

  it('다른 기기가 먼저 저장했으면 **아무것도 쓰지 않는다**', async () => {
    const stale = server!.updatedAt
    // 다른 기기가 물량표를 하나 만들고 저장했다
    await syncPurchaseOrder(po('벽체', '다른기기가만든표'), stale)
    const afterOther = server!.tables.map(t => t.label)

    // 우리는 아직 낡은 기준값을 들고 있다. 전엔 이 쓰기가 통과하면서
    // prune 이 '다른기기가만든표' 를 지웠다.
    const callsBefore = rpcCalls
    const r = await syncPurchaseOrder(po('벽체'), stale)
    expect(r.kind).toBe('conflict')
    expect(rpcCalls).toBe(callsBefore)                       // RPC 가 안 나갔다
    expect(server!.tables.map(t => t.label)).toEqual(afterOther)   // 서버 그대로
    // 호출부가 다시 맞출 수 있게 지금 서버 값을 알려준다
    expect(r.serverUpdatedAt).toBe(server!.updatedAt)
  })

  it('집어놓고 못 쓰면 **시각을 되돌린다**', async () => {
    // 권리를 집을 때 updated_at 을 앞으로 찍는다. 그 뒤 저장이 실패하면
    // **내용은 그대로인데 시각만 전진한** 상태가 남고, 두 가지가 깨진다 —
    //   1. 다음 시도가 제 claim 을 "다른 기기 충돌" 로 오인해 영영 멈춘다
    //   2. 그 사이 새로고침하면 안 바뀐 서버가 더 최신으로 보여 로컬을 덮는다
    const base = server!.updatedAt
    const tablesBefore = server!.tables.map(t => t.label)

    rpcFails = true
    await expect(syncPurchaseOrder(po('벽체', '천장'), base)).rejects.toThrow()

    expect(server!.updatedAt).toBe(base)
    expect(server!.tables.map(t => t.label)).toEqual(tablesBefore)
  })

  it('되돌린 뒤 같은 기준값으로 다시 쓰면 통과한다', async () => {
    // 되돌리기가 제대로 안 되면 여기서 conflict 가 나면서 영구 정지한다.
    const base = server!.updatedAt
    rpcFails = true
    await expect(syncPurchaseOrder(po('벽체'), base)).rejects.toThrow()

    rpcFails = false
    const r = await syncPurchaseOrder(po('벽체', '천장'), base)
    expect(r.kind).toBe('ok')
    expect(server!.tables.map(t => t.label)).toEqual(['벽체', '천장'])
  })

  it('기준값을 안 주면 옛 동작 — 조건 없이 쓴다', async () => {
    // 서버에 발주서가 처음 올라가는 경우가 이 길이다.
    const r = await syncPurchaseOrder(po('벽체', '천장'))
    expect(r.kind).toBe('ok')
    expect(server!.tables).toHaveLength(2)
  })

  it('서버에 행이 아직 없으면 기준값이 있어도 첫 쓰기로 본다', async () => {
    server = null
    const r = await syncPurchaseOrder(po('벽체'), toPg('2026-10-09T09:00:00.000Z'))
    expect(r.kind).toBe('ok')
    expect(server!.tables.map(t => t.label)).toEqual(['벽체'])
  })

  it('표기만 다른 같은 시각으로는 헛충돌이 나지 않는다 (Z vs +00:00)', async () => {
    const asZ = server!.updatedAt.replace(/\+00:00$/, 'Z')
    const r = await syncPurchaseOrder(po('벽체'), asZ)
    expect(r.kind).toBe('ok')
  })
})

describe('fetchPurchaseOrder', () => {
  it('서버 시각을 **깎지 않고** 들고 온다 — 쓰기 조건의 기준값이다', async () => {
    const got = await fetchPurchaseOrder('p1')
    expect(got?.serverUpdatedAt).toBe(server!.updatedAt)
    // ms 로 깎은 숫자는 마이크로초를 잃어서 .eq() 가 안 맞는다 — 그래서
    // 문자열을 따로 들고 간다.
    expect(got?.updatedAt).toBe(Date.parse(server!.updatedAt))
  })

  it('받아온 값을 그대로 기준으로 쓰면 통과한다', async () => {
    const got = await fetchPurchaseOrder('p1')
    const r = await syncPurchaseOrder({ ...got!, tables: [] }, got!.serverUpdatedAt)
    expect(r.kind).toBe('ok')
  })
})
