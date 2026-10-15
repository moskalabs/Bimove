// Supabase ↔ 발주서 동기화
// localStorage를 1차 캐시로, Supabase를 영속 저장소로 사용
import { supabase, supabaseConfigured } from './supabase'
import type {
  PurchaseOrder, BOQTable, BOQItem,
} from './purchaseOrder'

// ── 발주서 로드 (Supabase → 클라이언트 모델) ──

/**
 * 발주서 전체를 **한 번의 쿼리로** 가져온다.
 *
 * 예전엔 테이블마다 품목을, 품목마다 제외항목을 따로 물었다. 테이블 5개에
 * 품목이 20개씩이면 왕복이 100번 넘는다 — 패널을 열 때마다 몇 초씩 걸렸다.
 * PostgREST 의 중첩 select 로 한 번에 받는다.
 *
 * 정렬은 받아서 우리가 한다. 중첩 관계의 order 는 쿼리로 못 주고, sort_order
 * 가 비어 있는 옛 행도 있어서 안정 정렬이 필요하다.
 */
export async function fetchPurchaseOrder(projectId: string): Promise<PurchaseOrder | null> {
  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select(`
      id, updated_at,
      boq_tables (
        id, template_id, label, sort_order, created_at,
        boq_items (
          id, name, material, width_mm, height_mm, item_width_mm, item_length_mm,
          loss_rate, unit_price, unit, calc_method, length_m, manual_qty, sort_order,
          boq_exclusions ( id, type, label, shape_id, width_mm, height_mm )
        )
      )
    `)
    .eq('project_id', projectId)
    .maybeSingle()

  // 발주서가 아직 없는 건 정상이다 (maybeSingle → data null). 그 외의 실패는
  // 호출부가 "서버에서 못 불러왔다" 를 알려줄 수 있게 올려보낸다.
  if (error) throw error
  if (!po) return null

  const byOrder = <T extends { sort_order?: number | null }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const boqTables: BOQTable[] = byOrder(po.boq_tables ?? []).map(t => ({
    id: t.id,
    templateId: t.template_id as BOQTable['templateId'],
    label: t.label,
    createdAt: new Date(t.created_at).getTime(),
    items: byOrder(t.boq_items ?? []).map((item): BOQItem => ({
      id: item.id,
      name: item.name,
      material: item.material,
      widthMm: Number(item.width_mm),
      heightMm: Number(item.height_mm),
      itemWidthMm: Number(item.item_width_mm),
      itemLengthMm: Number(item.item_length_mm),
      lossRate: Number(item.loss_rate),
      unitPrice: Number(item.unit_price),
      unit: item.unit,
      calcMethod: (item.calc_method as BOQItem['calcMethod']) ?? 'area',
      lengthM: Number(item.length_m ?? 0),
      manualQty: Number(item.manual_qty ?? 0),
      exclusions: (item.boq_exclusions ?? []).map(ex => ({
        id: ex.id,
        type: ex.type as 'door' | 'window' | 'custom',
        label: ex.label,
        shapeId: ex.shape_id ?? undefined,
        widthMm: Number(ex.width_mm),
        heightMm: Number(ex.height_mm),
      })),
    })),
  }))

  return {
    projectId,
    tables: boqTables,
    updatedAt: new Date(po.updated_at).getTime(),
  }
}

// ── 발주서 저장 (클라이언트 모델 → Supabase) ──

/**
 * 클라이언트 PurchaseOrder를 RPC가 기대하는 JSONB 형태로 변환.
 * snake_case 키 + sort_order 자동 부여.
 */
function toRpcTables(po: PurchaseOrder) {
  return po.tables.map((table, ti) => ({
    id: table.id,
    template_id: table.templateId,
    label: table.label,
    sort_order: ti,
    items: table.items.map((item, ii) => ({
      id: item.id,
      name: item.name,
      material: item.material,
      width_mm: item.widthMm,
      height_mm: item.heightMm,
      item_width_mm: item.itemWidthMm,
      item_length_mm: item.itemLengthMm,
      loss_rate: item.lossRate,
      unit_price: item.unitPrice,
      unit: item.unit,
      calc_method: item.calcMethod ?? 'area',
      length_m: item.lengthM ?? 0,
      manual_qty: item.manualQty ?? 0,
      sort_order: ii,
      exclusions: item.exclusions.map(ex => ({
        id: ex.id,
        type: ex.type,
        label: ex.label,
        shape_id: ex.shapeId ?? null,
        width_mm: ex.widthMm,
        height_mm: ex.heightMm,
      })),
    })),
  }))
}

/**
 * RPC 기반 트랜잭션 동기화.
 *
 * 성공하면 true. **함수가 아직 배포되지 않은 경우에만** false 를 돌려 폴백으로
 * 넘긴다. 권한 오류나 제약 위반까지 폴백으로 흘리면, 서버가 "안 된다" 고 한
 * 작업을 파괴적인 경로로 다시 시도하게 된다.
 */
async function syncViaRpc(po: PurchaseOrder): Promise<boolean> {
  const { error } = await supabase.rpc('sync_purchase_order', {
    p_project_id: po.projectId,
    p_tables: toRpcTables(po),
  })
  if (!error) return true
  if (isMissingFunction(error)) {
    console.warn('[PO sync] RPC 미배포 → 순차 방식으로 폴백:', error.message)
    return false
  }
  throw new Error(`발주서 동기화 실패 (RPC): ${error.message}`)
}

/**
 * "함수가 없다" 인지. PostgREST 는 스키마 캐시에 없는 함수를 PGRST202 로,
 * Postgres 는 undefined_function 을 42883 으로 보고한다.
 */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  if (error.code === 'PGRST202' || error.code === '42883') return true
  return /could not find the function|does not exist/i.test(error.message ?? '')
}

/** 한 번의 요청에 넣는 id 개수. URL 길이 제한(보통 8KB)에 걸리지 않게 끊는다. */
const ID_CHUNK = 100

function chunked<T>(items: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** id 가 있는 행들을 끊어서 upsert. 한 덩이라도 실패하면 올려보낸다. */
async function upsertAll(table: string, rows: Array<Record<string, unknown>>): Promise<void> {
  for (const chunk of chunked(rows, 500)) {
    const { error } = await supabase.from(table).upsert(chunk)
    if (error) throw error
  }
}

/**
 * `parentCol` 이 `parentIds` 중 하나인 행 가운데 `keepIds` 에 없는 것을 지운다.
 *
 * "NOT IN (keep…)" 로 한 방에 보내지 않는다. keep 쪽이 수천 개면 URL 이 터지고,
 * 무엇보다 **지울 것만 명시적으로 지우는** 쪽이 사고가 적다. 먼저 서버에 뭐가
 * 있는지 읽고 차집합만 삭제한다.
 */
async function pruneRows(
  table: string, parentCol: string, parentIds: string[], keepIds: string[],
): Promise<void> {
  if (parentIds.length === 0) return
  const keep = new Set(keepIds)
  const stale: string[] = []

  for (const ids of chunked(parentIds)) {
    const { data, error } = await supabase.from(table).select('id').in(parentCol, ids)
    if (error) throw error
    for (const row of data ?? []) {
      if (!keep.has(row.id)) stale.push(row.id)
    }
  }

  for (const ids of chunked(stale)) {
    const { error } = await supabase.from(table).delete().in('id', ids)
    if (error) throw error
  }
}

/**
 * RPC 가 아직 배포되지 않은 환경용 폴백.
 *
 * 예전엔 boq_tables 를 **먼저 DELETE 하고** 테이블·품목·제외항목을 하나씩
 * 넣었다. 게다가 각 쿼리의 error 를 보지 않고 `if (!row) continue` 로 넘겼다.
 * 중간에 하나만 실패해도 서버에는 반쪽 발주서가 남고, 실패했다는 사실조차
 * 아무도 몰랐다 — 호출부는 성공으로 알고 로컬 더티 플래그를 내린다.
 *
 * 그래서 순서를 뒤집었다. **upsert 를 먼저, 삭제를 마지막에** 한다. 중간에
 * 끊기면 서버에는 옛 데이터와 새 데이터가 섞여 남을 뿐 사라지는 건 없고,
 * 모든 단계에서 error 를 올려보내므로 호출부가 재시도한다 (로컬 캐시가
 * 원본을 들고 있다).
 */
async function syncSequential(po: PurchaseOrder): Promise<void> {
  const { data: poRow, error: poErr } = await supabase
    .from('purchase_orders')
    .upsert({
      project_id: po.projectId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id' })
    .select('id')
    .single()
  if (poErr) throw poErr
  if (!poRow) throw new Error('발주서 행을 만들지 못했습니다')

  const tableRows = po.tables.map((table, ti) => ({
    id: table.id,
    purchase_order_id: poRow.id,
    template_id: table.templateId,
    label: table.label,
    sort_order: ti,
  }))

  const itemRows = po.tables.flatMap(table => table.items.map((item, ii) => ({
    id: item.id,
    boq_table_id: table.id,
    name: item.name,
    material: item.material,
    width_mm: item.widthMm,
    height_mm: item.heightMm,
    item_width_mm: item.itemWidthMm,
    item_length_mm: item.itemLengthMm,
    loss_rate: item.lossRate,
    unit_price: item.unitPrice,
    unit: item.unit,
    calc_method: item.calcMethod ?? 'area',
    length_m: item.lengthM ?? 0,
    manual_qty: item.manualQty ?? 0,
    sort_order: ii,
  })))

  const exclusionRows = po.tables.flatMap(table => table.items.flatMap(item =>
    item.exclusions.map(ex => ({
      id: ex.id,
      boq_item_id: item.id,
      type: ex.type,
      label: ex.label,
      shape_id: ex.shapeId ?? null,
      width_mm: ex.widthMm,
      height_mm: ex.heightMm,
    }))))

  // ── 1) 넣기/갱신 (부모 → 자식 순서, FK 때문에) ──
  await upsertAll('boq_tables', tableRows)
  await upsertAll('boq_items', itemRows)
  await upsertAll('boq_exclusions', exclusionRows)

  // ── 2) 사라진 행 지우기 (자식 → 부모 순서) ──
  const tableIds = tableRows.map(r => r.id)
  const itemIds = itemRows.map(r => r.id)
  await pruneRows('boq_exclusions', 'boq_item_id', itemIds, exclusionRows.map(r => r.id))
  await pruneRows('boq_items', 'boq_table_id', tableIds, itemIds)
  await pruneRows('boq_tables', 'purchase_order_id', [poRow.id], tableIds)
}

/**
 * 발주서 동기화 (메인 진입점).
 * 1차: RPC 트랜잭션 (원자적, 안전)
 * 2차: 순차 방식 (RPC 미배포 시에만)
 */
export async function syncPurchaseOrder(po: PurchaseOrder): Promise<void> {
  const ok = await syncViaRpc(po)
  if (!ok) {
    await syncSequential(po)
  }
}

// ── 프로젝트 CRUD ──
//
// 여기 함수들은 실패를 삼키지 않고 throw 한다. 예전엔 error 를 버리고
// `data ?? []` / `data` 를 돌려줬다 — 네트워크가 끊겼는데도 "프로젝트가 0개"
// 로 보이고, 생성이 실패했는데 아무 일도 없었던 것처럼 넘어갔다.
// 호출부(ProjectsPage, App)는 이미 try/catch + 토스트를 갖추고 있다.

export async function fetchProjects(userId: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, thumbnail, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createProject(userId: string, name: string) {
  const { data, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, name })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * 스냅샷 저장 (optimistic locking).
 *
 * lastKnownUpdatedAt 을 주면 **그 값이 아직 서버의 updated_at 인 동안에만**
 * 쓴다. 조건을 UPDATE 문 자체에 붙이므로(`.eq('updated_at', …)`) 확인과 쓰기
 * 사이에 남이 끼어들 틈이 없다. 예전엔 SELECT 로 확인한 뒤 UPDATE 를 따로
 * 보냈는데, 그 사이에 다른 세션이 저장하면 검사를 통과한 채로 덮어썼다.
 *
 * 덤으로 타임스탬프 형식 문제도 사라진다. 우리가 보내는 건 JS 의
 * `…T09:07:33.218Z` 인데 Postgres 는 `…+00:00` 으로 돌려준다 — 글자로
 * 비교하면 **내가 방금 쓴 것을 남이 쓴 것으로** 오해했다 (5초마다 충돌 토스트).
 * 이제 비교는 Postgres 가 timestamptz 값으로 하므로 표기는 무관하다.
 *
 * 조건에 걸려 한 행도 안 바뀌면 충돌이다. 그때 서버 현재 값을 읽어
 * { conflict: true, serverUpdatedAt } 으로 알려준다.
 *
 * thumbnail 을 **생략하면 서버 썸네일은 그대로 둔다**. 예전엔
 * `thumbnail ?? null` 로 매번 써서, 썸네일을 넘기지 않는 5초 동기화가
 * 올려둔 썸네일을 바로 지워버렸다 (대시보드 카드가 항상 빈 상태).
 */
export async function saveProjectSnapshot(
  projectId: string,
  snapshot: unknown,
  thumbnail?: string,
  lastKnownUpdatedAt?: string,
): Promise<{ conflict: boolean; serverUpdatedAt?: string }> {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { snapshot, updated_at: now }
  if (thumbnail !== undefined) patch.thumbnail = thumbnail

  let q = supabase.from('projects').update(patch).eq('id', projectId)
  if (lastKnownUpdatedAt) q = q.eq('updated_at', lastKnownUpdatedAt)

  // 저장한 뒤 **서버가 들고 있는 값 그대로** 돌려받는다. 우리가 보낸 문자열을
  // 다음 번 기준값으로 삼으면 형식이 어긋난다.
  // maybeSingle: 조건에 안 맞아 0행이면 에러가 아니라 data null 이다.
  const { data: saved, error } = await q.select('updated_at').maybeSingle()
  if (error) throw error
  if (saved) return { conflict: false, serverUpdatedAt: saved.updated_at }

  // 0행 — 기준값이 어긋났거나(충돌) 프로젝트가 사라졌다.
  const { data: current, error: readErr } = await supabase
    .from('projects')
    .select('updated_at')
    .eq('id', projectId)
    .maybeSingle()
  if (readErr) throw readErr
  if (!current) throw new Error(`프로젝트를 찾을 수 없습니다: ${projectId}`)
  return { conflict: true, serverUpdatedAt: current.updated_at }
}

export async function loadProjectSnapshot(projectId: string): Promise<{ snapshot: unknown; updatedAt?: string } | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('snapshot, updated_at')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw error
  if (!data?.snapshot) return null
  return { snapshot: data.snapshot, updatedAt: data.updated_at }
}

export async function deleteProject(projectId: string) {
  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  if (error) throw error
}

export async function renameProject(projectId: string, name: string) {
  // updated_at 은 **일부러** 건드리지 않는다. 이건 스냅샷 저장의 optimistic
  // lock 기준값이자 "서버 쪽이 더 최신인가" 판정 기준이라(resolveSnapshot),
  // 이름만 바꿨는데 올리면 열려 있는 에디터가 남의 저장으로 오해해 충돌 복구에
  // 들어가고, 아직 안 올라간 로컬 작업이 서버의 옛 도면에 밀린다.
  const { error } = await supabase
    .from('projects')
    .update({ name })
    .eq('id', projectId)
  if (error) throw error
}

// ── 프로젝트 버전 히스토리 동기화 ──
//
// 여기 함수들은 실패를 삼키지 않고 throw 한다 — 호출부(versionSync)가
// "서버 버전을 못 불러왔다" 를 사용자에게 알려줘야 하기 때문이다.
// 단, 환경변수가 없으면 서버 기능 자체가 없는 것이므로 조용히 넘어간다.

import type { Version } from './versions'

/** 버전 목록 항목 — 스냅샷은 들어있지 않다. */
export type RemoteVersionMeta = { id: string; timestamp: number; label?: string }

/**
 * 서버 버전 목록 (스냅샷 제외, 최신순 30개).
 *
 * snapshot 을 일부러 빼고 받는다. 스냅샷 하나가 수 MB 라서 30개를 한꺼번에
 * 받으면 패널을 여는 것만으로 수십 MB 를 내려받게 된다.
 * 스냅샷은 복원/비교할 때 fetchProjectVersionSnapshot 으로 따로 받는다.
 */
export async function fetchProjectVersionMetas(projectId: string): Promise<RemoteVersionMeta[]> {
  if (!supabaseConfigured) return []
  const { data, error } = await supabase
    .from('project_versions')
    .select('id, label, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return (data ?? []).map(v => ({
    id: v.id,
    timestamp: new Date(v.created_at).getTime(),
    label: v.label ?? undefined,
  }))
}

/** 버전 하나의 스냅샷만 받아온다. */
export async function fetchProjectVersionSnapshot(versionId: string): Promise<object | null> {
  if (!supabaseConfigured) return null
  const { data, error } = await supabase
    .from('project_versions')
    .select('snapshot')
    .eq('id', versionId)
    .single()
  if (error) throw error
  return (data?.snapshot as object) ?? null
}

export async function saveProjectVersion(
  projectId: string,
  version: Version,
): Promise<void> {
  if (!supabaseConfigured) return
  const { error } = await supabase
    .from('project_versions')
    .insert({
      id: version.id,
      project_id: projectId,
      label: version.label ?? null,
      snapshot: version.snapshot,
      created_at: new Date(version.timestamp).toISOString(),
    })
  if (error) throw error
}

export async function deleteProjectVersion(versionId: string): Promise<void> {
  if (!supabaseConfigured) return
  const { error } = await supabase
    .from('project_versions')
    .delete()
    .eq('id', versionId)
  if (error) throw error
}

/** 버전 라벨 변경. 서버에만 있는 버전도 이름을 고칠 수 있어야 한다. */
export async function renameProjectVersion(versionId: string, label: string | null): Promise<void> {
  if (!supabaseConfigured) return
  const { error } = await supabase
    .from('project_versions')
    .update({ label })
    .eq('id', versionId)
  if (error) throw error
}
