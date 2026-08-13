import { describe, it, expect } from 'vitest'
import {
  saveVersion, listVersions, getVersion,
  deleteVersion, clearVersions, renameVersion,
} from '../../lib/versions'

const PID = 'test-project-1'
const SNAPSHOT = { shapes: [{ id: '1', type: 'wall' }] }

describe('saveVersion', () => {
  it('creates version with unique id', () => {
    const v = saveVersion(PID, SNAPSHOT, '수동저장')
    expect(v.id).toBeTruthy()
    expect(v.label).toBe('수동저장')
    expect(v.snapshot).toEqual(SNAPSHOT)
    expect(v.timestamp).toBeGreaterThan(0)
  })

  it('prepends to list (newest first)', () => {
    saveVersion(PID, SNAPSHOT, '첫번째')
    saveVersion(PID, SNAPSHOT, '두번째')
    const list = listVersions(PID)
    expect(list.length).toBe(2)
    expect(list[0].label).toBe('두번째')
    expect(list[1].label).toBe('첫번째')
  })

  it('trims label whitespace', () => {
    const v = saveVersion(PID, SNAPSHOT, '  공백  ')
    expect(v.label).toBe('공백')
  })

  it('sets label to undefined for empty string', () => {
    const v = saveVersion(PID, SNAPSHOT, '')
    expect(v.label).toBeUndefined()
  })

  it('caps at 30 versions', () => {
    for (let i = 0; i < 35; i++) {
      saveVersion(PID, SNAPSHOT, `v${i}`)
    }
    const list = listVersions(PID)
    expect(list.length).toBe(30)
    expect(list[0].label).toBe('v34') // newest
  })
})

describe('listVersions', () => {
  it('returns empty array for unknown project', () => {
    expect(listVersions('nonexistent')).toEqual([])
  })

  it('handles corrupted localStorage', () => {
    localStorage.setItem('bimova_versions_bad', 'NOT_JSON')
    expect(listVersions('bad')).toEqual([])
  })
})

describe('getVersion', () => {
  it('finds version by id', () => {
    const v = saveVersion(PID, SNAPSHOT, '찾기')
    const found = getVersion(PID, v.id)
    expect(found).not.toBeNull()
    expect(found!.label).toBe('찾기')
  })

  it('returns null for unknown id', () => {
    saveVersion(PID, SNAPSHOT)
    expect(getVersion(PID, 'nonexistent')).toBeNull()
  })
})

describe('deleteVersion', () => {
  it('removes specific version', () => {
    saveVersion(PID, SNAPSHOT, 'keep')
    const v2 = saveVersion(PID, SNAPSHOT, 'delete')
    deleteVersion(PID, v2.id)
    const list = listVersions(PID)
    expect(list.length).toBe(1)
    expect(list[0].label).toBe('keep')
  })

  it('no-op for unknown id', () => {
    saveVersion(PID, SNAPSHOT)
    const before = listVersions(PID).length
    deleteVersion(PID, 'fake')
    expect(listVersions(PID).length).toBe(before)
  })
})

describe('clearVersions', () => {
  it('removes all versions for project', () => {
    saveVersion(PID, SNAPSHOT)
    saveVersion(PID, SNAPSHOT)
    clearVersions(PID)
    expect(listVersions(PID)).toEqual([])
  })

  it('does not affect other projects', () => {
    saveVersion('proj-a', SNAPSHOT)
    saveVersion('proj-b', SNAPSHOT)
    clearVersions('proj-a')
    expect(listVersions('proj-a')).toEqual([])
    expect(listVersions('proj-b').length).toBe(1)
  })
})

describe('renameVersion', () => {
  it('updates label', () => {
    const v = saveVersion(PID, SNAPSHOT, '이전이름')
    renameVersion(PID, v.id, '새이름')
    const updated = getVersion(PID, v.id)
    expect(updated!.label).toBe('새이름')
  })

  it('sets undefined for empty label', () => {
    const v = saveVersion(PID, SNAPSHOT, '있음')
    renameVersion(PID, v.id, '  ')
    const updated = getVersion(PID, v.id)
    expect(updated!.label).toBeUndefined()
  })
})
