/**
 * 저장된 도면을 우리 포맷으로 옮기기.
 *
 * 여기서 보는 건 **안 잃는가** 와 **반쪽을 남기지 않는가** 다. 반쪽을 남기면
 * 나중에 그걸 "옮겨진 것" 으로 믿고 원본을 지우게 되고, 그때 진짜로 잃는다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { migrateProject, loadBimoveDoc } from '../../lib/docMigration'
import { _resetIdbForTest } from '../../lib/idb'

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
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

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
})
