// Supabase ↔ 발주서 동기화
// localStorage를 1차 캐시로, Supabase를 영속 저장소로 사용
import { supabase } from './supabase'
import type {
  PurchaseOrder, BOQTable, BOQItem,
} from './purchaseOrder'

// ── 발주서 로드 (Supabase → 클라이언트 모델) ──

export async function fetchPurchaseOrder(projectId: string): Promise<PurchaseOrder | null> {
  // 1. purchase_order 가져오기
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('project_id', projectId)
    .single()

  if (!po) return null

  // 2. boq_tables
  const { data: tables } = await supabase
    .from('boq_tables')
    .select('*')
    .eq('purchase_order_id', po.id)
    .order('sort_order')

  if (!tables) return { projectId, tables: [], updatedAt: Date.now() }

  // 3. 각 테이블의 items + exclusions
  const boqTables: BOQTable[] = []
  for (const t of tables) {
    const { data: items } = await supabase
      .from('boq_items')
      .select('*')
      .eq('boq_table_id', t.id)
      .order('sort_order')

    const boqItems: BOQItem[] = []
    for (const item of (items ?? [])) {
      const { data: exclusions } = await supabase
        .from('boq_exclusions')
        .select('*')
        .eq('boq_item_id', item.id)

      boqItems.push({
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
        exclusions: (exclusions ?? []).map(ex => ({
          id: ex.id,
          type: ex.type as 'door' | 'window' | 'custom',
          label: ex.label,
          shapeId: ex.shape_id ?? undefined,
          widthMm: Number(ex.width_mm),
          heightMm: Number(ex.height_mm),
        })),
      })
    }

    boqTables.push({
      id: t.id,
      templateId: t.template_id as BOQTable['templateId'],
      label: t.label,
      items: boqItems,
      createdAt: new Date(t.created_at).getTime(),
    })
  }

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
 * 서버에 sync_purchase_order 함수가 배포되어 있으면 단일 트랜잭션으로 처리.
 * 실패 시 false를 반환하여 fallback으로 전환.
 */
async function syncViaRpc(po: PurchaseOrder): Promise<boolean> {
  const { error } = await supabase.rpc('sync_purchase_order', {
    p_project_id: po.projectId,
    p_tables: toRpcTables(po),
  })
  if (error) {
    // RPC 함수가 아직 배포되지 않았거나 오류 발생 → fallback
    console.warn('[PO sync] RPC failed, falling back to sequential:', error.message)
    return false
  }
  return true
}

/**
 * 기존 순차 방식 동기화 (fallback).
 * DELETE + INSERT를 개별 쿼리로 실행하므로 중간 실패 시 데이터 손실 위험 있음.
 */
async function syncSequential(po: PurchaseOrder): Promise<void> {
  // 1. purchase_order upsert
  const { data: poRow } = await supabase
    .from('purchase_orders')
    .upsert({
      project_id: po.projectId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id' })
    .select()
    .single()

  if (!poRow) return

  // 2. 기존 boq_tables 삭제 후 재삽입 (cascade로 items/exclusions도 삭제됨)
  await supabase
    .from('boq_tables')
    .delete()
    .eq('purchase_order_id', poRow.id)

  // 3. 테이블 + 품목 + 제외 항목 삽입
  for (let ti = 0; ti < po.tables.length; ti++) {
    const table = po.tables[ti]
    const { data: tableRow } = await supabase
      .from('boq_tables')
      .insert({
        id: table.id,
        purchase_order_id: poRow.id,
        template_id: table.templateId,
        label: table.label,
        sort_order: ti,
      })
      .select()
      .single()

    if (!tableRow) continue

    for (let ii = 0; ii < table.items.length; ii++) {
      const item = table.items[ii]
      const { data: itemRow } = await supabase
        .from('boq_items')
        .insert({
          id: item.id,
          boq_table_id: tableRow.id,
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
        })
        .select()
        .single()

      if (!itemRow || item.exclusions.length === 0) continue

      await supabase
        .from('boq_exclusions')
        .insert(item.exclusions.map(ex => ({
          id: ex.id,
          boq_item_id: itemRow.id,
          type: ex.type,
          label: ex.label,
          shape_id: ex.shapeId ?? null,
          width_mm: ex.widthMm,
          height_mm: ex.heightMm,
        })))
    }
  }
}

/**
 * 발주서 동기화 (메인 진입점).
 * 1차: RPC 트랜잭션 (원자적, 안전)
 * 2차: 순차 방식 (RPC 미배포 시 fallback)
 */
export async function syncPurchaseOrder(po: PurchaseOrder): Promise<void> {
  const ok = await syncViaRpc(po)
  if (!ok) {
    await syncSequential(po)
  }
}

// ── 프로젝트 CRUD ──

export async function fetchProjects(userId: string) {
  const { data } = await supabase
    .from('projects')
    .select('id, name, thumbnail, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  return data ?? []
}

export async function createProject(userId: string, name: string) {
  const { data } = await supabase
    .from('projects')
    .insert({ user_id: userId, name })
    .select()
    .single()
  return data
}

/**
 * 스냅샷 저장 (optimistic locking).
 * lastKnownUpdatedAt를 전달하면 서버의 updated_at과 비교하여
 * 다른 세션에서 먼저 저장했을 경우 충돌을 감지한다.
 * 충돌 시 { conflict: true, serverUpdatedAt } 반환.
 */
export async function saveProjectSnapshot(
  projectId: string,
  snapshot: unknown,
  thumbnail?: string,
  lastKnownUpdatedAt?: string,
): Promise<{ conflict: boolean; serverUpdatedAt?: string }> {
  // 충돌 확인: lastKnownUpdatedAt가 있으면 서버 타임스탬프와 비교
  if (lastKnownUpdatedAt) {
    const { data: current } = await supabase
      .from('projects')
      .select('updated_at')
      .eq('id', projectId)
      .single()

    if (current && current.updated_at !== lastKnownUpdatedAt) {
      return { conflict: true, serverUpdatedAt: current.updated_at }
    }
  }

  const now = new Date().toISOString()
  await supabase
    .from('projects')
    .update({
      snapshot,
      thumbnail: thumbnail ?? null,
      updated_at: now,
    })
    .eq('id', projectId)

  return { conflict: false, serverUpdatedAt: now }
}

export async function loadProjectSnapshot(projectId: string) {
  const { data } = await supabase
    .from('projects')
    .select('snapshot')
    .eq('id', projectId)
    .single()
  return data?.snapshot ?? null
}

export async function deleteProject(projectId: string) {
  await supabase.from('projects').delete().eq('id', projectId)
}

export async function renameProject(projectId: string, name: string) {
  await supabase
    .from('projects')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', projectId)
}

// ── 재질 프리셋 동기화 ──

import type { MaterialPreset } from './materialPresets'

export async function fetchMaterialPresets(userId: string): Promise<MaterialPreset[] | null> {
  const { data } = await supabase
    .from('material_presets')
    .select('presets')
    .eq('user_id', userId)
    .single()
  if (!data?.presets) return null
  return data.presets as MaterialPreset[]
}

export async function syncMaterialPresets(userId: string, presets: MaterialPreset[]): Promise<void> {
  await supabase
    .from('material_presets')
    .upsert({
      user_id: userId,
      presets,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
}

// ── 프로젝트 버전 히스토리 동기화 ──

import type { Version } from './versions'

export async function fetchProjectVersions(projectId: string): Promise<Version[]> {
  const { data } = await supabase
    .from('project_versions')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (!data) return []
  return data.map(v => ({
    id: v.id,
    timestamp: new Date(v.created_at).getTime(),
    label: v.label ?? undefined,
    snapshot: v.snapshot as object,
  }))
}

export async function saveProjectVersion(
  projectId: string,
  version: Version,
): Promise<void> {
  await supabase
    .from('project_versions')
    .insert({
      id: version.id,
      project_id: projectId,
      label: version.label ?? null,
      snapshot: version.snapshot,
      created_at: new Date(version.timestamp).toISOString(),
    })
}

export async function deleteProjectVersion(versionId: string): Promise<void> {
  await supabase
    .from('project_versions')
    .delete()
    .eq('id', versionId)
}
