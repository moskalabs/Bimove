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
/** true 면 RPC 가 터진다 (네트워크 끊김 흉내). */
let rpcFails = false
/**
 * CAS 가 걸린 **인자 셋짜리** 함수가 배포돼 있나.
 *
 * false 면 PostgREST 가 PGRST202 로 "그런 함수 없다" 고 답한다 — 아직
 * 마이그레이션을 안 돌린 환경이다. 그때만 옛 길(집고 → 둘짜리)로 간다.
 */
let casDeployed = true
/**
 * 발주서 행을 **읽은** 횟수.
 *
 * CAS 가 성공한 뒤에도 시각을 따로 읽으면, 그 사이 다른 기기가 저장했을 때
 * 남의 시각을 제 기준값으로 삼는다 — 내용은 보지도 않았는데 다음 CAS 가
 * 통과해서 상대를 덮는다. 그래서 "안 읽는다" 를 직접 센다.
 */
let poReads = 0
/** true 면 다음 **읽기** 때 다른 기기가 저장한 것처럼 서버가 앞서 나간다. */
let bumpOnRead = false

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
      if (patch === null) {
        poReads++
        if (bumpOnRead && server) {
          // 다른 기기(B)가 방금 저장한 것처럼 서버를 앞세운다.
          bumpOnRead = false
          server = {
            updatedAt: toPg(new Date(Date.parse(server.updatedAt) + 30_000).toISOString()),
            tables: [...server.tables, { id: 'tB', label: 'B가 만든 표' }],
          }
        }
      }
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
      rpc: async (
        _fn: string,
        args: {
          p_project_id: string
          p_tables: Array<{ id: string; label: string }>
          p_expected_updated_at?: string
        },
      ) => {
        const cas = 'p_expected_updated_at' in args
        if (cas && !casDeployed) {
          return { error: { code: 'PGRST202', message: 'could not find the function' } }
        }
        if (rpcFails) return { error: { code: 'XX000', message: '네트워크' } }
        // CAS: 기대와 다르면 **아무것도 안 쓰고** P0409 로 올린다.
        // (마이그레이션의 RAISE EXCEPTION … ERRCODE = 'P0409' 와 같은 동작)
        //
        // NULL 은 "검사 없음" 이 아니라 **"서버에 없어야 한다"** 는 뜻이다.
        // 그래서 네 경우를 다 가린다.
        if (cas) {
          const expected = args.p_expected_updated_at ?? null
          const mismatch = server
            ? expected === null || Date.parse(server.updatedAt) !== Date.parse(expected)
            : expected !== null
          if (mismatch) {
            return { error: { code: 'P0409', message: '다른 기기가 먼저 저장했습니다' } }
          }
        }
        // 목록을 그대로 반영하고 updated_at 을 다시 찍는다
        server = {
          updatedAt: toPg(new Date(Date.parse(server?.updatedAt ?? '2026-10-09T09:00:00.000Z') + 60_000).toISOString()),
          tables: args.p_tables.map(t => ({ id: t.id, label: t.label })),
        }
        // 셋짜리는 **찍은 시각을 그 자리에서** 돌려준다 (RETURNS timestamptz).
        // 둘짜리는 예전처럼 uuid 다.
        return { data: cas ? server.updatedAt : 'po1', error: null }
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
  rpcFails = false
  casDeployed = true
  poReads = 0
  bumpOnRead = false
})

describe('syncPurchaseOrder — "서버에 없음" 도 CAS 로 지킨다', () => {
  it('없다고 읽고 왔는데 그 사이 생겼으면 **안 덮는다**', async () => {
    // 기준값 없음 = "서버를 읽었는데 발주서가 없었다" 는 뜻이다.
    // (못 읽은 세션은 아예 서버로 안 쓴다 — POTablesTab 의 fetchFailedRef.)
    //
    // 전엔 그 경우 **조건 없는 둘짜리 RPC** 로 내려갔다. 이 길은 서버 물량표를
    // 전부 지우고 내 것으로 바꾸므로, 그 사이 다른 기기가 만든 발주서가
    // 통째로 사라졌다.
    server = { updatedAt: toPg('2026-10-09T09:10:00.000Z'), tables: [{ id: 'tB', label: 'B가 만든 표' }] }
    const r = await syncPurchaseOrder(po('내 표'))
    expect(r.kind).toBe('conflict')
    expect(server!.tables.map(t => t.label)).toEqual(['B가 만든 표'])   // 그대로다
  })

  it('정말 비어 있으면 첫 저장은 그대로 나간다', async () => {
    server = null
    const r = await syncPurchaseOrder(po('내 표'))
    expect(r.kind).toBe('ok')
    expect(server!.tables.map(t => t.label)).toEqual(['내 표'])
  })

  it('기대한 행이 사라졌으면 다시 만들지 않는다', async () => {
    // 다른 기기가 발주서를 지웠다. 조용히 새로 만들면 그 삭제를 없던 일로 만든다.
    const base = server!.updatedAt
    server = null
    const r = await syncPurchaseOrder(po('내 표'), base)
    expect(r.kind).toBe('conflict')
    expect(server).toBeNull()
  })
})

describe('syncPurchaseOrder — 성공 뒤 기준값', () => {
  it('RPC 가 찍은 시각을 쓴다 — **따로 읽지 않는다**', async () => {
    const base = server!.updatedAt
    const r = await syncPurchaseOrder(po('벽체'), base)
    expect(r.kind).toBe('ok')
    expect(r.serverUpdatedAt).toBe(server!.updatedAt)
    // 읽었으면 그 사이 남이 저장했을 때 **남의 시각**을 제 기준으로 삼는다.
    expect(poReads).toBe(0)
  })

  it('쓰고 읽는 사이에 남이 저장해도 **남의 시각을 집어오지 않는다**', async () => {
    const base = server!.updatedAt
    bumpOnRead = true          // 지금 읽으면 B 의 저장이 보인다
    const r = await syncPurchaseOrder(po('벽체'), base)
    expect(r.kind).toBe('ok')
    // 안 읽었으므로 B 의 저장은 안 보이고, 기준값은 내가 쓴 시각 그대로다.
    expect(bumpOnRead).toBe(true)
    expect(Date.parse(r.serverUpdatedAt!)).toBe(Date.parse(server!.updatedAt))
  })
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
    const r = await syncPurchaseOrder(po('벽체'), stale)
    expect(r.kind).toBe('conflict')
    // **서버가 그대로인가** 가 전부다. CAS 가 걸린 뒤로는 RPC 자체는 나가고
    // 함수 안에서 거절하므로, 호출 횟수로 재면 안 된다 (한 번 그렇게 재다가
    // CAS 를 붙이고 나서 이 테스트가 깨졌다 — 재는 자리가 틀렸던 것이다).
    expect(server!.tables.map(t => t.label)).toEqual(afterOther)
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

    casDeployed = false   // 옛 길(집고 → 쓰고)에서만 되돌리기가 돈다
    rpcFails = true
    await expect(syncPurchaseOrder(po('벽체', '천장'), base)).rejects.toThrow()

    expect(server!.updatedAt).toBe(base)
    expect(server!.tables.map(t => t.label)).toEqual(tablesBefore)
  })

  it('되돌린 뒤 같은 기준값으로 다시 쓰면 통과한다', async () => {
    // 되돌리기가 제대로 안 되면 여기서 conflict 가 나면서 영구 정지한다.
    const base = server!.updatedAt
    casDeployed = false
    rpcFails = true
    await expect(syncPurchaseOrder(po('벽체'), base)).rejects.toThrow()

    rpcFails = false
    const r = await syncPurchaseOrder(po('벽체', '천장'), base)
    expect(r.kind).toBe('ok')
    expect(server!.tables.map(t => t.label)).toEqual(['벽체', '천장'])
  })

  it('CAS 가 배포돼 있으면 집는 단계 없이 한 번에 쓴다', async () => {
    // 검사와 쓰기가 한 트랜잭션이라 "집고 → 끊김" 이 생길 수 없다.
    const base = server!.updatedAt
    const r = await syncPurchaseOrder(po('벽체', '천장'), base)
    expect(r.kind).toBe('ok')
    expect(server!.tables.map(t => t.label)).toEqual(['벽체', '천장'])
  })

  it('CAS 가 없는 환경에서도 똑같이 동작한다', async () => {
    // 마이그레이션을 안 돌려도 돌아가야 한다 — 안 그러면 배포 순서가 묶인다.
    casDeployed = false
    const base = server!.updatedAt
    expect((await syncPurchaseOrder(po('벽체', '천장'), base)).kind).toBe('ok')
    expect(server!.tables.map(t => t.label)).toEqual(['벽체', '천장'])

    // 낡은 기준값이면 여기서도 막힌다
    expect((await syncPurchaseOrder(po('벽체'), base)).kind).toBe('conflict')
  })

  // ── 여기 두 줄은 **계약이 바뀐 자리**다 ──
  //
  // 전엔 "기준값 없음 = 조건 없이 쓴다", "행이 없으면 기준값이 있어도 첫 쓰기"
  // 였다. 둘 다 덮어쓰기 구멍이었다 — 이 RPC 는 서버 물량표를 전부 지우고 다시
  // 넣기 때문에, 그 사이 다른 기기가 만들었거나 지운 것을 없던 일로 만든다.
  // 바뀐 규칙은 바로 위 describe('…"서버에 없음" 도 CAS 로 지킨다') 에 있다.

  it('기준값을 안 주면 **"서버에 없어야 한다"** 는 뜻이다', async () => {
    // 지금 서버에는 행이 있다 → 기대와 다르다 → 안 쓴다.
    const before = server!.tables.map(t => t.label)
    const r = await syncPurchaseOrder(po('벽체', '천장'))
    expect(r.kind).toBe('conflict')
    expect(server!.tables.map(t => t.label)).toEqual(before)
  })

  it('기준값이 있는데 행이 없으면 충돌이다 — 되살리지 않는다', async () => {
    server = null
    const r = await syncPurchaseOrder(po('벽체'), toPg('2026-10-09T09:00:00.000Z'))
    expect(r.kind).toBe('conflict')
    expect(server).toBeNull()
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
