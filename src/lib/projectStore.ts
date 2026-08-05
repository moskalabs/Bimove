import { scopedGet, scopedSet, scopedRemove } from './scopedStorage'

export type Project = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  thumbnail?: string
}

const LIST_KEY = 'bimove_projects_v1'
const snapshotKey = (id: string) => `bimove_project_${id}`

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
    const versionsKey = `bimove_versions_${id}`
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

export function saveSnapshot(id: string, snapshot: object) {
  try { scopedSet(snapshotKey(id), JSON.stringify(snapshot)) } catch { /* storage full */ }
}

export function saveThumbnail(id: string, dataUrl: string) {
  const projects = getProjects()
  const updated = projects.map(p => p.id === id ? { ...p, thumbnail: dataUrl } : p)
  saveProjectList(updated)
}

/** One-time migration: moves old single-project data into project list. */
export function migrateOldData() {
  const OLD_KEY = 'bimove_snapshot_v1'
  const old = localStorage.getItem(OLD_KEY)
  if (!old || getProjects().length > 0) return
  const project = createProject('기존 프로젝트')
  scopedSet(snapshotKey(project.id), old)
  localStorage.removeItem(OLD_KEY)
}
