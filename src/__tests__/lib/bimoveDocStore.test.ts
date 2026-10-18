/**
 * 저장된 도면을 우리 포맷으로 읽기.
 *
 * 처음엔 한 번 변환해 따로 저장하는 **이전(migration)** 이었다. 그게 세 가지를
 * 못 풀었다 — 안 연 프로젝트는 안 옮겨지고, 옮긴 뒤에 더 편집하면 낡고, 이
 * 기기에만 있다. 그래서 **읽을 때마다 변환**한다.
 *
 * 변환 결과를 캐시하던 때도 있었는데 걷어냈다. 캐시가 낡았는지 보는 지문이
 * props 의 키 개수만 봐서 **값만 바뀌는 편집(벽 길이, pathData)을 못 잡았고**,
 * 제대로 고치려면 수 MB 를 훑어야 해서 캐시가 아껴주는 것보다 비쌌다.
 * 그래서 여기 테스트에도 캐시가 없다 — 매번 변환한 결과만 본다.
 *
 * 여기서 보는 건 두 가지다.
 *   1. **아무것도 안 잃는가** (모르는 타입도, 값이 바뀐 것도)
 *   2. 유실이 있으면 도면을 **내주지 않는가**
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadDocument } from '../../lib/bimoveDocStore'
import { _resetIdbForTest } from '../../lib/idb'
import { setCurrentUserId } from '../../lib/scopedStorage'
import { writeFullRecords, type SnapshotLike } from '../../lib/snapshotRecords'

const page = (id: string, name: string) => ({ id, typeName: 'page', name, index: 'a1' })
const shape = (id: string, type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id, typeName: 'shape', type, parentId: 'page:main',
  x: 0, y: 0, rotation: 0, index: 'a1', props, ...extra,
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
afterEach(() => { setCurrentUserId(null) })

describe('loadDocument', () => {
  it('캐시가 없으면 그 자리에서 변환해서 준다', async () => {
    const r = await loadDocument('p1', good)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.doc.shapes).toHaveLength(2)
    expect(r.doc.shapes.find(s => s.type === 'wall')?.props)
      .toEqual({ x2: 200, y2: 0, thickness: 20 })
  })

  it('**값만** 바뀐 편집도 그대로 나온다', async () => {
    // 캐시를 쓰던 때 여기가 깨졌다. 지문이 props 의 **키 개수**만 봐서
    // 벽 길이(x2)나 DXF pathData 처럼 키는 그대로고 값만 달라지는 편집을
    // 못 잡았다 — 낡은 도면을 최신이라고 내줬다는 뜻이다.
    const before = await loadDocument('p1', good)
    expect(before.kind === 'ok' && before.doc.shapes.find(s => s.type === 'wall')?.props.x2).toBe(200)

    const edited = snap([
      page('page:main', '모형'),
      shape('shape:w', 'wall', { x2: 777, y2: 0, thickness: 20 }),
      shape('shape:g', 'dxfgroup', { pathData: 'M0,0L99,0', textsJson: '[]' }),
    ])
    const after = await loadDocument('p1', edited)
    expect(after.kind === 'ok' && after.doc.shapes.find(s => s.type === 'wall')?.props.x2).toBe(777)
    expect(after.kind === 'ok' && after.doc.shapes.find(s => s.type === 'dxfgroup')?.props.pathData)
      .toBe('M0,0L99,0')
  })

  it('프로젝트끼리 섞이지 않는다', async () => {
    const a = await loadDocument('A', good)
    const b = await loadDocument('B', snap([page('page:main', 'p'), shape('shape:z', 'zone')]))
    expect(a.kind === 'ok' && a.doc.shapes).toHaveLength(2)
    expect(b.kind === 'ok' && b.doc.shapes).toHaveLength(1)
  })

  it('스냅샷을 안 주면 저장소에서 읽는다', async () => {
    await writeFullRecords('p2', good as SnapshotLike)
    const r = await loadDocument('p2')
    expect(r.kind === 'ok' && r.doc.shapes).toHaveLength(2)
  })

  it('저장된 도면이 없으면 이유를 말한다', async () => {
    const r = await loadDocument('없는프로젝트')
    expect(r.kind).toBe('fail')
    if (r.kind !== 'fail') return
    expect(r.reason).toContain('없다')
  })

  it('못 읽은 레코드가 있으면 **도면을 내주지 않는다**', async () => {
    // 반쪽을 "읽었다" 고 넘기면 그 위에 저장이 돌아 원본을 덮는다.
    const broken = snap([
      page('page:main', '모형'),
      shape('shape:w', 'wall'),
      { id: 'shape:bad', typeName: 'shape' },   // type 이 없다
    ])
    const r = await loadDocument('p3', broken)
    expect(r.kind).toBe('fail')
    expect(r.kind === 'fail' && r.skipped).toBe(1)
  })

  it('빈 결과는 내주지 않는다', async () => {
    // 진짜 빈 도면인지 못 읽은 건지 구분이 안 된다.
    const r = await loadDocument('p4', snap([]))
    expect(r.kind).toBe('fail')
  })

  it('말이 안 되는 스냅샷에도 터지지 않는다', async () => {
    for (const bad of [42, 'x', [], { nope: 1 }]) {
      expect((await loadDocument('p5', bad)).kind).toBe('fail')
    }
  })


})
