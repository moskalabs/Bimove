// Supabase 클라이언트 설정
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다.')
}

export const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '')

// ── DB 타입 ──

export type DBProfile = {
  id: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export type DBProject = {
  id: string
  user_id: string
  name: string
  thumbnail: string | null
  snapshot: unknown | null
  created_at: string
  updated_at: string
}

export type DBPurchaseOrder = {
  id: string
  project_id: string
  updated_at: string
}

export type DBBOQTable = {
  id: string
  purchase_order_id: string
  template_id: string
  label: string
  sort_order: number
  created_at: string
}

export type DBBOQItem = {
  id: string
  boq_table_id: string
  name: string
  material: string
  width_mm: number
  height_mm: number
  item_width_mm: number
  item_length_mm: number
  loss_rate: number
  unit_price: number
  unit: string
  calc_method: string
  length_m: number
  manual_qty: number
  sort_order: number
  created_at: string
}

export type DBBOQExclusion = {
  id: string
  boq_item_id: string
  type: string
  label: string
  shape_id: string | null
  width_mm: number
  height_mm: number
}

export type DBPriceConfig = {
  id: string
  user_id: string
  wall_per_m: number
  door_per_ea: number
  window_per_ea: number
  floor_per_m2: number
  ceiling_per_m2: number
  blocks: Record<string, number>
  updated_at: string
}

export type DBMaterialPreset = {
  id: string
  user_id: string
  presets: Record<string, unknown>[]
  updated_at: string
}

export type DBProjectVersion = {
  id: string
  project_id: string
  label: string | null
  snapshot: unknown
  created_at: string
}
