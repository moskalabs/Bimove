export type Project = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

const LIST_KEY = 'bimove_projects_v1'
const snapshotKey = (id: string) => `bimove_project_${id}`

export function getProjects(): Project[] {
  try { return JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]') } catch { return [] }
}

function saveProjectList(projects: Project[]) {
  localStorage.setItem(LIST_KEY, JSON.stringify(projects))
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
  localStorage.removeItem(snapshotKey(id))
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
    const raw = localStorage.getItem(snapshotKey(id))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveSnapshot(id: string, snapshot: object) {
  try { localStorage.setItem(snapshotKey(id), JSON.stringify(snapshot)) } catch { /* storage full */ }
}

/** One-time migration: moves old single-project data into project list. */
export function migrateOldData() {
  const OLD_KEY = 'bimove_snapshot_v1'
  const old = localStorage.getItem(OLD_KEY)
  if (!old || getProjects().length > 0) return
  const project = createProject('기존 프로젝트')
  localStorage.setItem(snapshotKey(project.id), old)
  localStorage.removeItem(OLD_KEY)
}
