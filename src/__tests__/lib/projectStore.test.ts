import { describe, it, expect } from 'vitest'
import {
  getProjects, createProject, deleteProject,
  renameProject, touchProject,
  loadSnapshot, saveSnapshot,
  migrateOldData,
} from '../../lib/projectStore'

describe('getProjects', () => {
  it('returns empty array when no projects', () => {
    expect(getProjects()).toEqual([])
  })

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('bimova_projects_v1', 'INVALID')
    expect(getProjects()).toEqual([])
  })
})

describe('createProject', () => {
  it('creates project with given name', () => {
    const p = createProject('My House')
    expect(p.name).toBe('My House')
  })

  it('trims whitespace from name', () => {
    const p = createProject('  Kitchen  ')
    expect(p.name).toBe('Kitchen')
  })

  it('uses default name for empty string', () => {
    const p = createProject('')
    expect(p.name).toBe('새 프로젝트')
  })

  it('uses default name for whitespace-only input', () => {
    const p = createProject('   ')
    expect(p.name).toBe('새 프로젝트')
  })

  it('assigns a unique id', () => {
    const a = createProject('A')
    const b = createProject('B')
    expect(a.id).not.toBe(b.id)
  })

  it('sets createdAt and updatedAt timestamps', () => {
    const before = Date.now()
    const p = createProject('test')
    const after = Date.now()
    expect(p.createdAt).toBeGreaterThanOrEqual(before)
    expect(p.createdAt).toBeLessThanOrEqual(after)
    expect(p.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('prepends new project to list (most recent first)', () => {
    createProject('First')
    createProject('Second')
    const list = getProjects()
    expect(list[0].name).toBe('Second')
    expect(list[1].name).toBe('First')
  })

  it('persists project across calls', () => {
    const p = createProject('Persist me')
    const list = getProjects()
    expect(list.find(x => x.id === p.id)).toBeDefined()
  })
})

describe('deleteProject', () => {
  it('removes project from list', () => {
    const p = createProject('Delete me')
    deleteProject(p.id)
    expect(getProjects().find(x => x.id === p.id)).toBeUndefined()
  })

  it('also removes snapshot data', async () => {
    const p = createProject('Snap')
    await saveSnapshot(p.id, { data: 'test' })
    deleteProject(p.id)
    // deleteProject 는 스냅샷 삭제를 기다리지 않는다 (void) — 한 틱 넘긴다
    await Promise.resolve()
    expect(await loadSnapshot(p.id)).toBeNull()
  })

  it('is a no-op for non-existent id', () => {
    createProject('Keep me')
    deleteProject('non-existent-id')
    expect(getProjects()).toHaveLength(1)
  })
})

describe('renameProject', () => {
  it('renames existing project', () => {
    const p = createProject('Old Name')
    renameProject(p.id, 'New Name')
    expect(getProjects().find(x => x.id === p.id)?.name).toBe('New Name')
  })

  it('trims name whitespace', () => {
    const p = createProject('test')
    renameProject(p.id, '  Living Room  ')
    expect(getProjects().find(x => x.id === p.id)?.name).toBe('Living Room')
  })

  it('keeps original name when renamed to empty string', () => {
    const p = createProject('Keep')
    renameProject(p.id, '')
    expect(getProjects().find(x => x.id === p.id)?.name).toBe('Keep')
  })

  it('updates updatedAt', () => {
    const p = createProject('test')
    const before = Date.now()
    renameProject(p.id, 'renamed')
    const updated = getProjects().find(x => x.id === p.id)!.updatedAt
    expect(updated).toBeGreaterThanOrEqual(before)
  })
})

describe('touchProject', () => {
  it('updates updatedAt timestamp', () => {
    const p = createProject('Touch me')
    const before = Date.now()
    touchProject(p.id)
    const updated = getProjects().find(x => x.id === p.id)!.updatedAt
    expect(updated).toBeGreaterThanOrEqual(before)
  })
})

describe('loadSnapshot / saveSnapshot', () => {
  it('returns null for non-existent project', async () => {
    expect(await loadSnapshot('no-such-id')).toBeNull()
  })

  it('saves and loads snapshot', async () => {
    const p = createProject('snap test')
    const data = { shapes: [{ id: '1' }], version: 2 }
    await saveSnapshot(p.id, data)
    expect(await loadSnapshot(p.id)).toEqual(data)
  })

  // 레거시 폴백 경로. 깨진 JSON 은 되살릴 수 없으니 자리만 차지하지 않게 치운다.
  it('handles corrupted snapshot gracefully', async () => {
    localStorage.setItem('bimova_project_bad-id', 'INVALID JSON')
    expect(await loadSnapshot('bad-id')).toBeNull()
    expect(localStorage.getItem('bimova_project_bad-id')).toBeNull()
  })

  it('overwrites previous snapshot', async () => {
    const p = createProject('overwrite')
    await saveSnapshot(p.id, { v: 1 })
    await saveSnapshot(p.id, { v: 2 })
    expect(await loadSnapshot(p.id)).toEqual({ v: 2 })
  })

  // JSON 왕복이 없는 게 IndexedDB 로 간 이유 중 하나다. tldraw 스냅샷은
  // 중첩이 깊어서, 직렬화 한 번이 수 MB 짜리 문자열을 만들었다.
  it('중첩 구조를 JSON 왕복 없이 보존한다', async () => {
    const p = createProject('deep')
    const data = { store: { 'shape:a': { props: { segs: [[0, 1], [2, 3]] } } } }
    await saveSnapshot(p.id, data)
    expect(await loadSnapshot(p.id)).toEqual(data)
  })
})

describe('migrateOldData', () => {
  it('migrates old snapshot to new project', () => {
    localStorage.setItem('bimova_snapshot_v1', JSON.stringify({ shapes: [] }))
    migrateOldData()
    const projects = getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('기존 프로젝트')
  })

  it('does not migrate when projects already exist', () => {
    createProject('Existing')
    localStorage.setItem('bimova_snapshot_v1', JSON.stringify({ shapes: [] }))
    migrateOldData()
    expect(getProjects()).toHaveLength(1) // still just 1
  })

  it('does nothing when no old data', () => {
    migrateOldData()
    expect(getProjects()).toHaveLength(0)
  })

  it('removes old key after migration', () => {
    localStorage.setItem('bimova_snapshot_v1', JSON.stringify({ shapes: [] }))
    migrateOldData()
    expect(localStorage.getItem('bimova_snapshot_v1')).toBeNull()
  })
})
