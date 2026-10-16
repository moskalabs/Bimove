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

// ── 서버에서 만든 프로젝트의 로컬 등록 ──
//
// 프로젝트를 만드는 자리는 이제 대시보드(서버)뿐이라, 로컬 목록에 들어가는
// 경로가 **아예 없었다.** 그러면 touchProject() 가 갱신할 항목을 못 찾고
// isLocalNewer() 는 늘 false 를 돌려준다 — "로컬이 더 최신이면 로컬을 쓴다"
// 는 장치가 통째로 죽는다. 네트워크가 끊겼다 돌아온 뒤 다시 열면, 이 기기에
// 남은 최근 작업을 놔두고 서버의 옛 도면이 올라온다.

import { ensureProjectEntry, isLocalNewer, resolveSnapshot } from '../../lib/projectStore'

describe('ensureProjectEntry', () => {
  it('없으면 넣는다', () => {
    ensureProjectEntry('p1', '리모델링')
    expect(getProjects().map(p => p.id)).toContain('p1')
  })

  it('updatedAt 은 서버 시각으로 넣는다 (지금 시각이 아니다)', () => {
    // 여기서 Date.now() 를 쓰면 여는 순간 로컬이 서버보다 최신으로 보여서,
    // 정작 낡은 로컬 스냅샷을 고르게 된다.
    const serverAt = '2026-10-01T00:00:00.000Z'
    ensureProjectEntry('p1', '리모델링', serverAt)
    const entry = getProjects().find(p => p.id === 'p1')!
    expect(entry.updatedAt).toBe(Date.parse(serverAt))
  })

  it('서버 시각이 없으면 0 — 로컬이 이기지 않는다', () => {
    ensureProjectEntry('p1', '리모델링')
    expect(getProjects().find(p => p.id === 'p1')!.updatedAt).toBe(0)
  })

  it('이미 있으면 updatedAt 을 건드리지 않는다', () => {
    // 그게 이 판정의 전부다. 다시 열 때마다 초기화되면 로컬 저장 기록이 날아간다.
    ensureProjectEntry('p1', '리모델링', '2026-10-01T00:00:00.000Z')
    touchProject('p1')
    const after = getProjects().find(p => p.id === 'p1')!.updatedAt
    ensureProjectEntry('p1', '리모델링', '2026-10-01T00:00:00.000Z')
    expect(getProjects().find(p => p.id === 'p1')!.updatedAt).toBe(after)
  })

  it('이름은 서버 쪽으로 맞춘다', () => {
    ensureProjectEntry('p1', '옛이름')
    ensureProjectEntry('p1', '새이름')
    expect(getProjects().find(p => p.id === 'p1')!.name).toBe('새이름')
  })
})

describe('등록 뒤의 최신 판정', () => {
  const SERVER_AT = '2026-10-01T00:00:00.000Z'

  it('열자마자는 서버가 이긴다', () => {
    ensureProjectEntry('p1', 'x', SERVER_AT)
    expect(isLocalNewer('p1', SERVER_AT)).toBe(false)
    expect(resolveSnapshot('p1', { snapshot: { s: 1 }, updatedAt: SERVER_AT }, { l: 1 }))
      .toEqual({ s: 1 })
  })

  it('로컬 저장이 성공하면 그 뒤로는 로컬이 이긴다', () => {
    // 이게 안 되면 네트워크 장애 직후 작업이 옛 서버 도면에 덮인다.
    ensureProjectEntry('p1', 'x', SERVER_AT)
    touchProject('p1')
    expect(isLocalNewer('p1', SERVER_AT)).toBe(true)
    expect(resolveSnapshot('p1', { snapshot: { s: 1 }, updatedAt: SERVER_AT }, { l: 1 }))
      .toEqual({ l: 1 })
  })

  it('등록이 안 돼 있으면 로컬 저장을 해도 서버가 이긴다 (고치기 전 모습)', () => {
    // touchProject 는 목록에 **있는** 항목만 갱신한다. 등록을 건너뛰면
    // 아무 일도 일어나지 않는다는 걸 못으로 박아둔다.
    touchProject('ghost')
    expect(getProjects().find(p => p.id === 'ghost')).toBeUndefined()
    expect(isLocalNewer('ghost', SERVER_AT)).toBe(false)
  })
})

// ── 프로젝트 삭제 시 딸린 표까지 ──
//
// 대시보드 삭제가 서버 행만 지우고 로컬 정리 함수를 부르지 않아서, 지워진
// 프로젝트의 도면·버전·발주서·물량이 이 기기에 계속 남았다.

import { savePurchaseOrder, loadPurchaseOrder } from '../../lib/purchaseOrder'
import { saveFinishingData, loadFinishingData, resetFinishingData } from '../../lib/finishingData'

describe('deleteProject 가 딸린 표까지 치운다', () => {
  it('발주서를 지운다', () => {
    savePurchaseOrder({ projectId: 'p9', tables: [], updatedAt: Date.now() })
    expect(localStorage.getItem('bimova_po_p9')).not.toBeNull()
    deleteProject('p9')
    expect(localStorage.getItem('bimova_po_p9')).toBeNull()
  })

  it('마감재 물량을 지운다', () => {
    saveFinishingData('p9', resetFinishingData())
    expect(localStorage.getItem('bimova_finishing_tables_v1_p9')).not.toBeNull()
    deleteProject('p9')
    expect(localStorage.getItem('bimova_finishing_tables_v1_p9')).toBeNull()
  })

  it('지운 뒤 읽으면 빈 값이다 (옛 데이터가 되살아나지 않는다)', () => {
    savePurchaseOrder({ projectId: 'p9', tables: [{ id: 't', title: 'x', items: [] }] as never, updatedAt: 1 })
    deleteProject('p9')
    expect(loadPurchaseOrder('p9').tables).toEqual([])
    expect(loadFinishingData('p9').categories.length).toBeGreaterThan(0)  // 기본값으로 돌아간다
  })
})
