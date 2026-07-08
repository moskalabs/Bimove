// Supabase ↔ 발주서 동기화
// localStorage를 1차 캐시로, Supabase를 영속 저장소로 사용
import { supabase } from './supabase'
import type {
  PurchaseOrder, BOQTable, BOQItem, Exclusion,
} from './purchaseOrder'
import { uid } from './purchaseOrder'

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

export async function syncPurchaseOrder(po: PurchaseOrder): Promise<void> {
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

export async function saveProjectSnapshot(projectId: string, snapshot: unknown, thumbnail?: string) {
  await supabase
    .from('projects')
    .update({
      snapshot,
      thumbnail: thumbnail ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)
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
