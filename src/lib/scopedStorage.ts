// 사용자별 localStorage 키 분리
// 로그인 시 setCurrentUserId()로 설정, 이후 모든 get/set에 자동 접두사 추가
// 기존 키 마이그레이션 포함

let _userId: string | null = null

/** 현재 로그인 유저 ID 설정 (AuthProvider에서 호출) */
export function setCurrentUserId(id: string | null) {
  _userId = id
  if (id) migrateOldKeys(id)
}

export function getCurrentUserId(): string | null {
  return _userId
}

/** 유저 스코프된 키 생성 */
function scopedKey(key: string): string {
  return _userId ? `u:${_userId}:${key}` : key
}

/** 스코프된 localStorage.getItem */
export function scopedGet(key: string): string | null {
  return localStorage.getItem(scopedKey(key))
}

/** 스코프된 localStorage.setItem */
export function scopedSet(key: string, value: string): void {
  try { localStorage.setItem(scopedKey(key), value) } catch { /* storage full */ }
}

/** 스코프된 localStorage.removeItem */
export function scopedRemove(key: string): void {
  localStorage.removeItem(scopedKey(key))
}

// ── 기존 데이터 마이그레이션 ──
// 로그인 시 한 번만 실행: 기존 글로벌 키 → 유저 스코프 키로 복사

const MIGRATE_FLAG = (uid: string) => `bimove_migrated_${uid}`

const MIGRATABLE_KEYS = [
  'bimove_projects_v1',
  'bimove_price_config_v1',
  'bimove_materials_v2',
  'bimove_wall_thickness_mm',
  'bimove_wall_height_mm',
  'bimove_show_wall_lengths',
  'bimove_show_room_areas',
  'bimove_snap_enabled',
  'bimove_grayscale',
  'bimove_room_names',
]

function migrateOldKeys(uid: string) {
  if (localStorage.getItem(MIGRATE_FLAG(uid))) return

  for (const key of MIGRATABLE_KEYS) {
    const old = localStorage.getItem(key)
    const scoped = `u:${uid}:${key}`
    // 스코프 키가 아직 없고, 글로벌 키에 데이터가 있으면 복사
    if (old !== null && localStorage.getItem(scoped) === null) {
      try { localStorage.setItem(scoped, old) } catch { /* full */ }
    }
  }

  // 프로젝트별 키도 마이그레이션 (snapshot, po, versions)
  const projectsRaw = localStorage.getItem('bimove_projects_v1')
  if (projectsRaw) {
    try {
      const projects = JSON.parse(projectsRaw) as { id: string }[]
      for (const p of projects) {
        for (const prefix of ['bimove_project_', 'bimove_po_', 'bimove_versions_']) {
          const oldKey = prefix + p.id
          const scopedKey = `u:${uid}:${oldKey}`
          const val = localStorage.getItem(oldKey)
          if (val !== null && localStorage.getItem(scopedKey) === null) {
            try { localStorage.setItem(scopedKey, val) } catch { /* full */ }
          }
        }
      }
    } catch { /* ignore */ }
  }

  localStorage.setItem(MIGRATE_FLAG(uid), '1')
}
