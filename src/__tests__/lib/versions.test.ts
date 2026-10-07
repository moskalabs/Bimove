/**
 * 버전 히스토리 — IndexedDB 저장.
 *
 * fake-indexeddb 로 진짜 IDB 를 돌린다. 메타/본문을 따로 쓰는 구조라
 * "목록에는 있는데 본문이 없는" 유령 레코드가 생기지 않는지가 핵심이다.
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveVersion, listVersions, getVersion,
  deleteVersion, clearVersions, renameVersion,
  _resetVersionMigrationForTest,
} from '../../lib/versions'
import { idbKeys, _resetIdbForTest } from '../../lib/idb'
import { setCurrentUserId } from '../../lib/scopedStorage'

const PID = 'test-project-1'
const SNAPSHOT = { shapes: [{ id: '1', type: 'wall' }] }

/** fake-indexeddb 는 테스트 간에 DB 가 남는다 — 직접 비운다. */
async function wipeIdb() {
  const keys = await idbKeys('versions')
  if (keys.length === 0) return
  await new Promise<void>(resolve => {
    const req = indexedDB.open('bimova')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('versions', 'readwrite')
      const os = tx.objectStore('versions')
      for (const k of keys) os.delete(k)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
    }
    req.onerror = () => resolve()
  })
}

beforeEach(async () => {
  setCurrentUserId(null)
  await wipeIdb()
  _resetIdbForTest()
  _resetVersionMigrationForTest()
})

describe('saveVersion', () => {
  it('creates version with unique id', async () => {
    const v = await saveVersion(PID, SNAPSHOT, '수동저장')
    expect(v!.id).toBeTruthy()
    expect(v!.label).toBe('수동저장')
    expect(v!.snapshot).toEqual(SNAPSHOT)
    expect(v!.timestamp).toBeGreaterThan(0)
  })

  it('prepends to list (newest first)', async () => {
    await saveVersion(PID, SNAPSHOT, '첫번째')
    await saveVersion(PID, SNAPSHOT, '두번째')
    const list = await listVersions(PID)
    expect(list.length).toBe(2)
    expect(list[0].label).toBe('두번째')
    expect(list[1].label).toBe('첫번째')
  })

  it('trims label whitespace', async () => {
    const v = await saveVersion(PID, SNAPSHOT, '  공백  ')
    expect(v!.label).toBe('공백')
  })

  it('sets label to undefined for empty string', async () => {
    const v = await saveVersion(PID, SNAPSHOT, '')
    expect(v!.label).toBeUndefined()
  })

  it('caps at 30 versions', async () => {
    for (let i = 0; i < 35; i++) await saveVersion(PID, SNAPSHOT, `v${i}`)
    const list = await listVersions(PID)
    expect(list.length).toBe(30)
    expect(list[0].label).toBe('v34') // newest
  })

  // 30개를 넘겨 밀려난 버전은 메타에서만 빠지는 게 아니라 본문도 지워져야
  // 한다. 안 지우면 아무도 못 찾는 수 MB 짜리 레코드가 영원히 쌓인다 —
  // 용량 때문에 IndexedDB 로 옮겼는데 그게 도루묵이 된다.
  it('30개를 넘겨 밀려난 버전은 본문도 지운다', async () => {
    for (let i = 0; i < 33; i++) await saveVersion(PID, SNAPSHOT, `v${i}`)
    const metas = await listVersions(PID)
    const alive = new Set(metas.map(m => `${PID}:${m.id}`))
    const bodies = (await idbKeys('versions')).filter(k => k.startsWith(`${PID}:`))
    expect(bodies.length).toBe(30)
    for (const k of bodies) expect(alive.has(k)).toBe(true)
  })
})

describe('listVersions', () => {
  it('returns empty array for unknown project', async () => {
    expect(await listVersions('nonexistent')).toEqual([])
  })

  // 목록은 메타만 — 스냅샷 하나가 수 MB 라 패널 여는 것만으로 다 읽으면 안 된다.
  it('스냅샷 본문을 들고 오지 않는다', async () => {
    await saveVersion(PID, SNAPSHOT, '본문있음')
    const [meta] = await listVersions(PID)
    expect(meta.label).toBe('본문있음')
    expect('snapshot' in meta).toBe(false)
  })
})

describe('getVersion', () => {
  it('finds version by id', async () => {
    const v = await saveVersion(PID, SNAPSHOT, '찾기')
    const found = await getVersion(PID, v!.id)
    expect(found).not.toBeNull()
    expect(found!.label).toBe('찾기')
    expect(found!.snapshot).toEqual(SNAPSHOT)
  })

  it('returns null for unknown id', async () => {
    await saveVersion(PID, SNAPSHOT)
    expect(await getVersion(PID, 'nonexistent')).toBeNull()
  })
})

describe('deleteVersion', () => {
  it('removes specific version', async () => {
    await saveVersion(PID, SNAPSHOT, 'keep')
    const v2 = await saveVersion(PID, SNAPSHOT, 'delete')
    await deleteVersion(PID, v2!.id)
    const list = await listVersions(PID)
    expect(list.length).toBe(1)
    expect(list[0].label).toBe('keep')
  })

  it('본문도 같이 지운다', async () => {
    const v = await saveVersion(PID, SNAPSHOT, 'bye')
    await deleteVersion(PID, v!.id)
    expect(await idbKeys('versions')).not.toContain(`${PID}:${v!.id}`)
  })

  it('no-op for unknown id', async () => {
    await saveVersion(PID, SNAPSHOT)
    const before = (await listVersions(PID)).length
    await deleteVersion(PID, 'fake')
    expect((await listVersions(PID)).length).toBe(before)
  })
})

describe('clearVersions', () => {
  it('removes all versions for project', async () => {
    await saveVersion(PID, SNAPSHOT)
    await saveVersion(PID, SNAPSHOT)
    await clearVersions(PID)
    expect(await listVersions(PID)).toEqual([])
  })

  it('남은 레코드가 하나도 없다', async () => {
    await saveVersion(PID, SNAPSHOT)
    await saveVersion(PID, SNAPSHOT)
    await clearVersions(PID)
    expect((await idbKeys('versions')).filter(k => k.startsWith(PID))).toEqual([])
  })

  it('does not affect other projects', async () => {
    await saveVersion('proj-a', SNAPSHOT)
    await saveVersion('proj-b', SNAPSHOT)
    await clearVersions('proj-a')
    expect(await listVersions('proj-a')).toEqual([])
    expect((await listVersions('proj-b')).length).toBe(1)
  })
})

describe('renameVersion', () => {
  it('updates label', async () => {
    const v = await saveVersion(PID, SNAPSHOT, '이전이름')
    await renameVersion(PID, v!.id, '새이름')
    expect((await getVersion(PID, v!.id))!.label).toBe('새이름')
  })

  it('sets undefined for empty label', async () => {
    const v = await saveVersion(PID, SNAPSHOT, '있음')
    await renameVersion(PID, v!.id, '  ')
    expect((await getVersion(PID, v!.id))!.label).toBeUndefined()
  })

  it('이름만 바꾸고 스냅샷은 그대로 둔다', async () => {
    const v = await saveVersion(PID, SNAPSHOT, '원래')
    await renameVersion(PID, v!.id, '바뀜')
    expect((await getVersion(PID, v!.id))!.snapshot).toEqual(SNAPSHOT)
  })
})

// ── 레거시 localStorage 마이그레이션 ──
//
// 순서가 핵심이다 — 복사 → 확인 → 그 다음에만 삭제. 반대로 하면 옮기다 만
// 상태에서 기록이 통째로 사라진다.
describe('레거시 마이그레이션', () => {
  const LEGACY = 'bimova_versions_' + PID

  it('옛 localStorage 기록을 읽어서 IndexedDB 로 옮긴다', async () => {
    localStorage.setItem(LEGACY, JSON.stringify([
      { id: 'old-1', timestamp: 1000, label: '옛것1', snapshot: { a: 1 } },
      { id: 'old-2', timestamp: 900, snapshot: { b: 2 } },
    ]))

    const list = await listVersions(PID)
    expect(list.map(v => v.id)).toEqual(['old-1', 'old-2'])
    expect(list[0].label).toBe('옛것1')
    // 본문도 따라왔다
    expect((await getVersion(PID, 'old-2'))!.snapshot).toEqual({ b: 2 })
  })

  it('옮기고 나면 localStorage 쪽을 비운다', async () => {
    localStorage.setItem(LEGACY, JSON.stringify([
      { id: 'old-1', timestamp: 1000, snapshot: { a: 1 } },
    ]))
    await listVersions(PID)
    expect(localStorage.getItem(LEGACY)).toBeNull()
  })

  it('깨진 JSON 은 버리고 빈 목록을 돌려준다', async () => {
    localStorage.setItem('bimova_versions_bad', 'NOT_JSON')
    expect(await listVersions('bad')).toEqual([])
    expect(localStorage.getItem('bimova_versions_bad')).toBeNull()
  })

  // 이미 IndexedDB 에 기록이 있으면 옛 데이터가 끼어들면 안 된다.
  it('IndexedDB 에 이미 있으면 옛 기록을 끌어오지 않는다', async () => {
    await saveVersion(PID, SNAPSHOT, '새것')
    localStorage.setItem(LEGACY, JSON.stringify([
      { id: 'old-1', timestamp: 1000, label: '옛것', snapshot: { a: 1 } },
    ]))
    const list = await listVersions(PID)
    expect(list.map(v => v.label)).toEqual(['새것'])
  })

  it('clearVersions 후에 옛 기록이 되살아나지 않는다', async () => {
    localStorage.setItem(LEGACY, JSON.stringify([
      { id: 'old-1', timestamp: 1000, snapshot: { a: 1 } },
    ]))
    await listVersions(PID)          // 마이그레이션
    await clearVersions(PID)
    expect(await listVersions(PID)).toEqual([])
  })
})
