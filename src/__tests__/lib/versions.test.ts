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

// ── 저장 공간 부족 ──
//
// 회귀: writeList 가 scopedSet 을 try/catch 로 감쌌는데 scopedSet 은 quota
// 초과를 예외로 올리지 않고 false 를 돌려준다. 그래서 가지치기가 한 번도
// 안 돌았고, 용량이 차면 그 뒤로 버전이 조용히 하나도 안 쌓였다.
describe('writeList: 저장 공간 부족', () => {
  /** 저장되는 값이 limit 바이트를 넘으면 QuotaExceededError 를 던지게 한다 */
  function capStorage(limit: number): () => void {
    const real = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (key: string, value: string) => {
      if (value.length > limit) {
        const err = new Error('quota')
        err.name = 'QuotaExceededError'
        throw err
      }
      real(key, value)
    }
    return () => { localStorage.setItem = real }
  }

  it('목록이 안 들어가면 절반씩 줄여서라도 최신 버전을 남긴다', () => {
    for (let i = 0; i < 8; i++) saveVersion(PID, SNAPSHOT, `v${i}`)
    const full = JSON.stringify(listVersions(PID)).length

    // 8개는 안 들어가고 절반(4개)은 들어가는 크기
    const restore = capStorage(Math.floor(full * 0.6))
    try {
      saveVersion(PID, SNAPSHOT, '최신')
    } finally {
      restore()
    }

    const list = listVersions(PID)
    expect(list.length).toBeGreaterThan(0)
    expect(list.length).toBeLessThan(9)
    expect(list[0].label).toBe('최신')   // 최신은 반드시 살아남는다
  })

  it('한 개도 안 들어가면 버전 기록을 비운다', () => {
    saveVersion(PID, SNAPSHOT, '옛것')
    const restore = capStorage(1)
    try {
      saveVersion(PID, SNAPSHOT, '최신')
    } finally {
      restore()
    }
    // 들어가지도 않은 낡은 목록을 들고 있지 않는다
    expect(listVersions(PID)).toEqual([])
  })

  it('용량이 다시 나면 그 다음 저장은 정상으로 돌아온다', () => {
    const restore = capStorage(1)
    try { saveVersion(PID, SNAPSHOT, '실패') } finally { restore() }

    saveVersion(PID, SNAPSHOT, '성공')
    expect(listVersions(PID).map(v => v.label)).toEqual(['성공'])
  })
})
