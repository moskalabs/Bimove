import { scopedGet, scopedSet, scopedRemove } from './scopedStorage'

export type Project = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  thumbnail?: string
}

const LIST_KEY = 'bimova_projects_v1'
const snapshotKey = (id: string) => `bimova_project_${id}`

export function getProjects(): Project[] {
  try { return JSON.parse(scopedGet(LIST_KEY) ?? '[]') } catch { return [] }
}

function saveProjectList(projects: Project[]) {
  scopedSet(LIST_KEY, JSON.stringify(projects))
}

export function createProject(name: string): Project {
  const project: Project = {
    id: crypto.randomUUID(),
    name: name.trim() || '새 프로젝트',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  const list = getProjects()
  list.unshift(project)
  saveProjectList(list)
  return project
}

export function deleteProject(id: string) {
  saveProjectList(getProjects().filter(p => p.id !== id))
  scopedRemove(snapshotKey(id))
  // 버전 히스토리도 함께 정리
  try {
    const versionsKey = `bimova_versions_${id}`
    scopedRemove(versionsKey)
  } catch { /* ignore */ }
}

export function renameProject(id: string, name: string) {
  saveProjectList(getProjects().map(p =>
    p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p
  ))
}

export function touchProject(id: string) {
  saveProjectList(getProjects().map(p =>
    p.id === id ? { ...p, updatedAt: Date.now() } : p
  ))
}

export function loadSnapshot(id: string): object | null {
  try {
    const raw = scopedGet(snapshotKey(id))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/**
 * 로컬 저장본이 서버 스냅샷보다 최신인가?
 *
 * touchProject() 는 로컬 저장이 **성공했을 때만** updatedAt 을 올리고,
 * 서버의 updated_at 도 저장한 클라이언트 시계로 찍히므로 둘을 그대로 비교할 수 있다.
 * 같은 저장 라운드 안의 순서 차이로 로컬이 이기지 않도록 1초 여유를 둔다.
 */
export function isLocalNewer(id: string, serverUpdatedAt?: string): boolean {
  // 서버 타임스탬프가 없으면 비교할 수 없다 — 로컬을 믿는 쪽이 안전하다
  if (!serverUpdatedAt) return true
  const serverAt = Date.parse(serverUpdatedAt)
  if (Number.isNaN(serverAt)) return true
  const localAt = getProjects().find(p => p.id === id)?.updatedAt
  if (!localAt) return false
  return localAt > serverAt + 1000
}

/**
 * 서버/로컬 스냅샷 중 실제로 로드할 쪽을 고른다.
 *
 * 서버가 있으면 서버가 기본이지만, 로컬 저장이 더 최신이면 로컬을 쓴다.
 * 예전엔 서버에 뭐라도 있으면 무조건 서버였다 — 서버 쓰기가 실패했거나
 * (용량/네트워크/충돌) 동기화 틱 전에 화면을 떠난 작업을 낡은 서버
 * 스냅샷이 덮어써서, 불러온 CAD 도면이 대시보드 한 번 다녀오면 사라졌다.
 */
export function resolveSnapshot(
  id: string,
  server: { snapshot: object; updatedAt?: string } | null,
  local: object | null,
): object | null {
  if (!server) return local
  if (local && isLocalNewer(id, server.updatedAt)) return local
  return server.snapshot
}

/** 스냅샷 저장. 실패(용량 초과/직렬화 불가)하면 false — 호출한 쪽에서 알려줄 수 있게. */
export function saveSnapshot(id: string, snapshot: object): boolean {
  try { return scopedSet(snapshotKey(id), JSON.stringify(snapshot)) }
  catch { return false }
}

export function saveThumbnail(id: string, dataUrl: string) {
  const projects = getProjects()
  const updated = projects.map(p => p.id === id ? { ...p, thumbnail: dataUrl } : p)
  saveProjectList(updated)
}

/** One-time migration: moves old single-project data into project list. */
export function migrateOldData() {
  const OLD_KEY = 'bimova_snapshot_v1'
  const old = localStorage.getItem(OLD_KEY)
  if (!old || getProjects().length > 0) return
  const project = createProject('기존 프로젝트')
  scopedSet(snapshotKey(project.id), old)
  localStorage.removeItem(OLD_KEY)
}
