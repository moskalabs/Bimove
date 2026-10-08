import { scopedGet, scopedSet, scopedRemove } from './scopedStorage'
import { clearVersions } from './versions'
import { idbGet, idbSet, idbDelete, requestPersistentStorage } from './idb'
import { deleteRecords } from './snapshotRecords'

export type Project = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  thumbnail?: string
}

const LIST_KEY = 'bimova_projects_v1'

// 프로젝트 **목록**은 계속 localStorage 다. 수십 KB 밖에 안 되고, 동기로
// 읽을 수 있는 게 UI 에서 훨씬 편하다 (getProjects() 호출부가 수십 군데다).
// IndexedDB 로 옮긴 건 **도면 본문** 뿐이다 — 거기만 수 MB 라 터졌다.
//
// 레거시 localStorage 키. 이제 읽기 전용 폴백이다 — loadSnapshot 이 여기서
// 찾으면 IndexedDB 로 옮기고 치운다. 새로 쓰는 일은 없다.
const legacySnapshotKey = (id: string) => `bimova_project_${id}`

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
  scopedRemove(legacySnapshotKey(id))
  // 도면 본문도 정리. 비동기지만 기다리지 않는다 — 프로젝트는 이미 목록에서
  // 빠졌고, 남은 스냅샷 레코드는 아무도 못 찾는다.
  void idbDelete('snapshots', id)
  void deleteRecords(id)
  // 버전 히스토리도 함께 정리. IndexedDB 라 비동기지만 기다리지 않는다 —
  // 프로젝트는 이미 목록에서 빠졌고, 남은 버전 레코드는 아무도 못 찾는다.
  // (clearVersions 가 레거시 localStorage 키도 같이 치운다.)
  void clearVersions(id)
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

/**
 * 도면 본문 읽기. IndexedDB 우선, 없으면 레거시 localStorage.
 *
 * 레거시에서 찾았으면 그 자리에서 IndexedDB 로 옮긴다 — **복사 → 확인 →
 * 그 다음에만 삭제**. 복사가 실패하면 localStorage 쪽을 그대로 두고 값은
 * 돌려준다. 다음에 또 시도하면 된다. 순서를 반대로 하면 옮기다 만 상태에서
 * 도면이 통째로 사라진다.
 */
export async function loadSnapshot(id: string): Promise<object | null> {
  const stored = await idbGet<object>('snapshots', id)
  if (stored) return stored

  const raw = scopedGet(legacySnapshotKey(id))
  if (!raw) return null
  let parsed: object
  try {
    parsed = JSON.parse(raw) as object
  } catch {
    // 깨진 JSON 은 되살릴 방법이 없다. 자리만 차지하므로 치운다.
    console.warn(`[projectStore] 옛 스냅샷이 깨져 있어 버린다 (${id})`)
    scopedRemove(legacySnapshotKey(id))
    return null
  }
  if (await idbSet('snapshots', id, parsed)) {
    scopedRemove(legacySnapshotKey(id))
    console.log(`[projectStore] 옛 스냅샷을 IndexedDB 로 옮겼다 (${id})`)
  }
  return parsed
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

/**
 * 스냅샷 저장. 실패하면 false — 호출한 쪽에서 알려줄 수 있게.
 *
 * IndexedDB 라 JSON.stringify 가 없다 (structured clone). 한의 37.5MB DXF 는
 * 스냅샷이 수 MB 였는데, 전엔 저장할 때마다 그걸 메인 스레드에서 동기로
 * 문자열로 만들었다가 5MB 한도에 걸려 QuotaExceededError 가 났다.
 */
export async function saveSnapshot(id: string, snapshot: object): Promise<boolean> {
  void requestPersistentStorage()
  return idbSet('snapshots', id, snapshot)
}

/**
 * 옛 통짜 스냅샷을 치운다.
 *
 * 레코드 단위 저장(snapshotRecords.ts)이 자리잡으면 이 blob 은 더 이상 읽히지
 * 않는데, 큰 도면은 혼자 수 MB 를 차지한다. 레코드 **전체 쓰기가 성공한 뒤에만**
 * 부른다 — 레코드가 아직 없는데 이걸 지우면 오프라인 캐시가 통째로 사라진다.
 */
export async function dropLegacySnapshot(id: string): Promise<boolean> {
  return idbDelete('snapshots', id)
}

export function saveThumbnail(id: string, dataUrl: string) {
  const projects = getProjects()
  const updated = projects.map(p => p.id === id ? { ...p, thumbnail: dataUrl } : p)
  saveProjectList(updated)
}

/** One-time migration: moves old single-project data into project list.
 *
 *  레거시 키로 그대로 옮긴다 — 동기라서 여기서 가장 단순하고, 첫 로드 때
 *  loadSnapshot 이 알아서 IndexedDB 로 옮겨준다. */
export function migrateOldData() {
  const OLD_KEY = 'bimova_snapshot_v1'
  const old = localStorage.getItem(OLD_KEY)
  if (!old || getProjects().length > 0) return
  const project = createProject('기존 프로젝트')
  scopedSet(legacySnapshotKey(project.id), old)
  localStorage.removeItem(OLD_KEY)
}
