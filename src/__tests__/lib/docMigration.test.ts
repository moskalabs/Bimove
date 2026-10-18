/**
 * 저장된 도면을 우리 포맷으로 옮기기.
 *
 * 여기서 보는 건 **안 잃는가** 와 **반쪽을 남기지 않는가** 다. 반쪽을 남기면
 * 나중에 그걸 "옮겨진 것" 으로 믿고 원본을 지우게 되고, 그때 진짜로 잃는다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { migrateProject, loadBimoveDoc } from '../../lib/docMigration'
import { _resetIdbForTest } from '../../lib/idb'
import { setCurrentUserId } from '../../lib/scopedStorage'
import { writeFullRecords, type SnapshotLike } from '../../lib/snapshotRecords'

const page = (id: string, name: string) => ({ id, typeName: 'page', name, index: 'a1' })
const shape = (id: string, type: string, props: Record<string, unknown> = {}) => ({
  id, typeName: 'shape', type, parentId: 'page:main',
  x: 0, y: 0, rotation: 0, index: 'a1', props,
})

function snap(records: Array<Record<string, unknown>>) {
  const store: Record<string, unknown> = {}
  for (const r of records) store[r.id as string] = r
  return { document: { store, schema: {} } }
}

const good = snap([
  page('page:main', '모형'),
  shape('shape:w', 'wall', { x2: 200, y2: 0, thickness: 20 }),
  shape('shape:g', 'dxfgroup', { pathData: 'M0,0L10,0', textsJson: '[]' }),
])

beforeEach(async () => {
  await _resetIdbForTest()
  setCurrentUserId(null)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// 스코프는 모듈 전역이다 — 남겨 두면 다음 파일의 테스트가 남의 칸을 본다
afterEach(() => { setCurrentUserId(null) })

describe('migrateProject', () => {
  it('옮기고 다시 읽을 수 있다', async () => {
    const r = await migrateProject('p1', good)
    expect(r.ok).toBe(true)
    expect(r.shapes).toBe(2)
    expect(r.pages).toBe(1)
    expect(r.byType).toEqual({ wall: 1, dxfgroup: 1 })

    const back = await loadBimoveDoc('p1')
    expect(back?.shapes).toHaveLength(2)
    expect(back?.shapes.find(s => s.type === 'wall')?.props)
      .toEqual({ x2: 200, y2: 0, thickness: 20 })
  })

  it('못 읽은 레코드가 있으면 **저장하지 않는다**', async () => {
    // 반쪽을 남기는 게 가장 나쁜 결말이다. 안 남기면 다음에 다시 시도한다.
    const broken = snap([
      page('page:main', '모형'),
      shape('shape:w', 'wall'),
      { id: 'shape:bad', typeName: 'shape' },   // type 이 없다
    ])
    const r = await migrateProject('p2', broken)
    expect(r.ok).toBe(false)
    expect(r.skipped).toBe(1)
    expect(await loadBimoveDoc('p2')).toBeNull()
  })

  it('빈 결과는 저장하지 않는다', async () => {
    // 진짜 빈 도면인지 못 읽은 건지 구분이 안 된다. 남기면 "옮겼다" 로 보인다.
    const r = await migrateProject('p3', snap([]))
    expect(r.ok).toBe(false)
    expect(await loadBimoveDoc('p3')).toBeNull()
  })

  it('저장된 도면이 없으면 이유를 말한다', async () => {
    const r = await migrateProject('없는프로젝트')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('없다')
  })

  it('말이 안 되는 스냅샷에도 터지지 않는다', async () => {
    for (const bad of [42, 'x', [], { nope: 1 }]) {
      const r = await migrateProject('p4', bad)
      expect(r.ok).toBe(false)
    }
  })

  it('다시 옮기면 덮어쓴다 — 도형이 늘어난 게 반영된다', async () => {
    await migrateProject('p5', good)
    const more = snap([
      page('page:main', '모형'),
      shape('shape:w', 'wall'),
      shape('shape:g', 'dxfgroup'),
      shape('shape:z', 'zone', { label: '거실', points: [{ x: 0, y: 0 }] }),
    ])
    const r = await migrateProject('p5', more)
    expect(r.ok).toBe(true)
    expect(r.shapes).toBe(3)
    expect((await loadBimoveDoc('p5'))?.shapes.some(s => s.type === 'zone')).toBe(true)
  })

  it('프로젝트끼리 섞이지 않는다', async () => {
    await migrateProject('A', good)
    await migrateProject('B', snap([page('page:main', 'p'), shape('shape:z', 'zone')]))
    expect((await loadBimoveDoc('A'))?.shapes).toHaveLength(2)
    expect((await loadBimoveDoc('B'))?.shapes).toHaveLength(1)
  })

  it('옮기는 중에 계정이 바뀌면 **쓰지 않는다**', async () => {
    // 이전은 기다리지 않는 배경 작업이다. 그 사이에 로그아웃·계정 전환이
    // 일어나면 IndexedDB 키의 사용자 스코프가 바뀌고, A 가 시작한 이전이
    // B 의 칸에 A 의 도면을 쓴다. 사무실에서 계정을 돌려 쓰는 데라면
    // 금방 겹친다 — 그리고 겹친 뒤엔 누구 것인지 가릴 길이 없다.
    setCurrentUserId('userA')
    await writeFullRecords('p6', good as SnapshotLike)

    // **await 하지 않고** 시작해서, 저장소를 읽는 사이에 계정을 바꾼다.
    // migrateProject 는 첫 await 까지 동기로 달리므로 owner 는 userA 로
    // 잡히고, 그 뒤 재개될 때는 이미 userB 다.
    const pending = migrateProject('p6')
    setCurrentUserId('userB')
    const r = await pending

    expect(r.ok).toBe(false)
    expect(r.reason).toContain('계정')

    // B 의 칸에도, A 의 칸에도 남지 않았다
    expect(await loadBimoveDoc('p6')).toBeNull()
    setCurrentUserId('userA')
    expect(await loadBimoveDoc('p6')).toBeNull()
  })

  it('계정이 그대로면 멀쩡히 쓴다', async () => {
    setCurrentUserId('userA')
    expect((await migrateProject('p7', good)).ok).toBe(true)
    expect((await loadBimoveDoc('p7'))?.shapes).toHaveLength(2)
    // 다른 계정에서는 보이지 않는다
    setCurrentUserId('userB')
    expect(await loadBimoveDoc('p7')).toBeNull()
  })
})
