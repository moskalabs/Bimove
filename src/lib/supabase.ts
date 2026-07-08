// Supabase 클라이언트 설정
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://fwcfewemptnpbeclmkov.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2Zld2VtcHRucGJlY2xta292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NzM2MDEsImV4cCI6MjA5OTA0OTYwMX0.D2HeUF4uYVUiGGL17yUHOvGmD9dnzsixMVBB6n-h_RE'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

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
