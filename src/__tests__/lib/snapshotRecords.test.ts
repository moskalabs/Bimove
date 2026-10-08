/**
 * 레코드 단위 스냅샷 저장.
 *
 * fake-indexeddb 로 진짜 IDB 를 돌린다 (idb.test.ts 와 같은 이유). 여기서
 * 못 박아두는 건 두 가지다 — **반쪽짜리 도면을 절대 돌려주지 않는 것**,
 * 그리고 **손대지 않은 레코드는 다시 쓰지 않는 것**.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readRecordSnapshot, writeFullRecords, writeRecordDiff, deleteRecords,
  type SnapshotLike,
} from '../../lib/snapshotRecords'
import { idbBatch, idbGetRange } from '../../lib/idb'
import { setCurrentUserId } from '../../lib/scopedStorage'

// DB 비우기는 전역 setup.ts 가 한다 (매 테스트마다 deleteDatabase).
beforeEach(() => {
  setCurrentUserId(null)
})

const SCHEMA = { schemaVersion: 2, sequences: { 'com.tldraw.shape': 1 } }

function snap(store: Record<string, unknown>, session: unknown = { currentPageId: 'page:a' }): SnapshotLike {
  return { document: { store, schema: SCHEMA }, session }
}

describe('writeFullRecords / readRecordSnapshot', () => {
  it('쓴 걸 그대로 돌려준다', async () => {
    const s = snap({
      'shape:a': { id: 'shape:a', typeName: 'shape', x: 1 },
      'page:p': { id: 'page:p', typeName: 'page', name: '1층' },
    })
    expect(await writeFullRecords('p1', s)).toBe(true)
    expect(await readRecordSnapshot('p1')).toEqual(s)
  })

  it('저장된 적 없으면 null', async () => {
    expect(await readRecordSnapshot('nope')).toBeNull()
  })

  // 전체 쓰기는 기존 레코드를 같은 트랜잭션에서 치운다. 안 치우면 지운
  // 셰이프가 디스크에 남아 다음 로드에서 되살아난다.
  it('전체 쓰기는 옛 레코드를 남기지 않는다', async () => {
    await writeFullRecords('p1', snap({
      'shape:a': { id: 'shape:a', typeName: 'shape' },
      'shape:b': { id: 'shape:b', typeName: 'shape' },
    }))
    await writeFullRecords('p1', snap({ 'shape:a': { id: 'shape:a', typeName: 'shape', x: 9 } }))
    const got = await readRecordSnapshot('p1')
    expect(Object.keys(got!.document.store)).toEqual(['shape:a'])
    expect(got!.document.store['shape:a']).toEqual({ id: 'shape:a', typeName: 'shape', x: 9 })
  })

  it('프로젝트끼리 섞이지 않는다', async () => {
    await writeFullRecords('p1', snap({ 'shape:a': { v: 1 } }))
    await writeFullRecords('p10', snap({ 'shape:a': { v: 10 } }))
    expect((await readRecordSnapshot('p1'))!.document.store['shape:a']).toEqual({ v: 1 })
    expect((await readRecordSnapshot('p10'))!.document.store['shape:a']).toEqual({ v: 10 })
  })

  it('유저가 다르면 서로 안 보인다', async () => {
    setCurrentUserId('u1')
    await writeFullRecords('p1', snap({ 'shape:a': { v: 1 } }))
    setCurrentUserId('u2')
    expect(await readRecordSnapshot('p1')).toBeNull()
    setCurrentUserId('u1')
    expect(await readRecordSnapshot('p1')).not.toBeNull()
  })
})

// meta 와 레코드는 늘 같은 트랜잭션에서 쓰인다. 그러므로 한쪽만 있는 건
// "쓰이다 만 것" 이고, 반쪽 도면을 띄우는 것보다 서버/옛 스냅샷으로
// 폴백하는 쪽이 낫다.
describe('반쪽짜리 저장본은 무효', () => {
  it('meta 가 없으면 레코드가 있어도 null', async () => {
    await idbBatch('docrecords', [
      { type: 'put', key: 'p1/r/shape:a', value: { id: 'shape:a' } },
      { type: 'put', key: 'p1/r/shape:b', value: { id: 'shape:b' } },
    ])
    expect(await readRecordSnapshot('p1')).toBeNull()
  })

  it('레코드가 없으면 meta 가 있어도 null', async () => {
    await idbBatch('docrecords', [
      { type: 'put', key: 'p1/meta', value: { schema: SCHEMA, session: {} } },
    ])
    expect(await readRecordSnapshot('p1')).toBeNull()
  })
})

describe('writeRecordDiff', () => {
  it('손대지 않은 레코드는 그대로 두고 추가/수정/삭제만 반영한다', async () => {
    await writeFullRecords('p1', snap({
      'shape:keep': { id: 'shape:keep', typeName: 'shape', big: 'x'.repeat(50) },
      'shape:edit': { id: 'shape:edit', typeName: 'shape', x: 1 },
      'shape:gone': { id: 'shape:gone', typeName: 'shape' },
    }))

    const ok = await writeRecordDiff(
      'p1',
      new Map<string, unknown>([
        ['shape:edit', { id: 'shape:edit', typeName: 'shape', x: 2 }],
        ['shape:new', { id: 'shape:new', typeName: 'shape' }],
      ]),
      new Set(['shape:gone']),
      { schema: SCHEMA, session: { currentPageId: 'page:b' } },
    )
    expect(ok).toBe(true)

    const got = await readRecordSnapshot('p1')
    expect(Object.keys(got!.document.store).sort()).toEqual(['shape:edit', 'shape:keep', 'shape:new'])
    expect(got!.document.store['shape:edit']).toEqual({ id: 'shape:edit', typeName: 'shape', x: 2 })
    expect(got!.document.store['shape:keep']).toEqual({ id: 'shape:keep', typeName: 'shape', big: 'x'.repeat(50) })
    expect(got!.session).toEqual({ currentPageId: 'page:b' })
  })

  // 같은 틱에 지웠다 다시 넣는 경우 — 삭제가 먼저 돌아야 추가가 살아남는다.
  it('같은 id 가 삭제와 추가에 다 있으면 추가가 이긴다', async () => {
    await writeFullRecords('p1', snap({ 'shape:a': { v: 0 } }))
    await writeRecordDiff(
      'p1',
      new Map<string, unknown>([['shape:a', { v: 1 }]]),
      new Set(['shape:a']),
      { schema: SCHEMA },
    )
    expect((await readRecordSnapshot('p1'))!.document.store['shape:a']).toEqual({ v: 1 })
  })

  // 바뀐 게 세션(카메라)뿐일 때도 meta 는 써야 한다 — "meta 가 있으면 유효한
  // 캐시" 라는 규약이 깨지면 안 되기 때문이다.
  it('변경이 없어도 meta 는 갱신된다', async () => {
    await writeFullRecords('p1', snap({ 'shape:a': { v: 1 } }))
    await writeRecordDiff('p1', new Map(), new Set(), { schema: SCHEMA, session: { z: 2 } })
    const got = await readRecordSnapshot('p1')
    expect(got!.session).toEqual({ z: 2 })
    expect(got!.document.store['shape:a']).toEqual({ v: 1 })
  })
})

describe('deleteRecords', () => {
  it('프로젝트의 레코드와 meta 를 전부 치운다', async () => {
    await writeFullRecords('p1', snap({ 'shape:a': { v: 1 } }))
    await writeFullRecords('p2', snap({ 'shape:a': { v: 2 } }))
    expect(await deleteRecords('p1')).toBe(true)
    expect(await readRecordSnapshot('p1')).toBeNull()
    expect(await idbGetRange('docrecords', 'p1/')).toEqual(new Map())
    expect(await readRecordSnapshot('p2')).not.toBeNull()
  })
})
