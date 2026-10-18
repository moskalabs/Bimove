/**
 * 저장된 도면을 우리 포맷으로 읽기.
 *
 * 처음엔 한 번 변환해 따로 저장하는 **이전(migration)** 이었다. 그게 세 가지를
 * 못 풀었다 — 안 연 프로젝트는 안 옮겨지고, 옮긴 뒤에 더 편집하면 낡고, 이
 * 기기에만 있다. 그래서 **읽을 때마다 변환**하고 저장해 둔 건 캐시로만 쓴다.
 *
 * 여기서 보는 건 세 가지다.
 *   1. 캐시가 낡았으면 **안 쓴다** (이게 셋 중 가장 중요하다)
 *   2. 유실이 있으면 도면을 **내주지 않는다**
 *   3. 캐시가 없거나 못 써도 결과는 같다
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadDocument, readDocCache, docCacheKey } from '../../lib/bimoveDocStore'
import { _resetIdbForTest, idbSet } from '../../lib/idb'
import { setCurrentUserId } from '../../lib/scopedStorage'
import { writeFullRecords, type SnapshotLike } from '../../lib/snapshotRecords'
import { fromTldrawSnapshot } from '../../lib/bimoveDoc'

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
    expect(r.from).toBe('converted')
    expect(r.doc.shapes).toHaveLength(2)
    expect(r.doc.shapes.find(s => s.type === 'wall')?.props)
      .toEqual({ x2: 200, y2: 0, thickness: 20 })
  })

  it('변환한 뒤에는 캐시에 남는다', async () => {
    await loadDocument('p1', good)
    // 쓰기는 기다리지 않는다 — 한 틱 흘려준다
    await new Promise(res => setTimeout(res, 0))
    expect((await readDocCache('p1'))?.shapes).toHaveLength(2)
  })

  it('같은 스냅샷이면 두 번째는 캐시에서 온다', async () => {
    await loadDocument('p1', good)
    await new Promise(res => setTimeout(res, 0))
    const again = await loadDocument('p1', good)
    expect(again.kind === 'ok' && again.from).toBe('cache')
  })

  it('스냅샷이 바뀌면 **낡은 캐시를 버리고** 다시 변환한다', async () => {
    // 이게 이전 방식의 핵심 결함이었다. 한 번 옮겨 두면 그 뒤의 편집이
    // 반영되지 않아서, 나중에 그 사본을 믿고 원본을 지우면 **편집한 만큼
    // 통째로 사라진다.** 날짜로는 못 가린다 — 낡은 쪽이 더 나중에 쓰였을
    // 수도 있다. 그래서 원본의 지문을 본다.
    await loadDocument('p1', good)
    await new Promise(res => setTimeout(res, 0))

    const edited = snap([
      page('page:main', '모형'),
      shape('shape:w', 'wall', { x2: 200, y2: 0, thickness: 20 }),
      shape('shape:g', 'dxfgroup', { pathData: 'M0,0L10,0', textsJson: '[]' }),
      shape('shape:z', 'zone', { label: '거실' }),
    ])
    const r = await loadDocument('p1', edited)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.from).toBe('converted')               // 캐시를 안 썼다
    expect(r.doc.shapes).toHaveLength(3)
    expect(r.doc.shapes.some(s => s.type === 'zone')).toBe(true)
  })

  it('도형을 옮기기만 해도 캐시가 낡은 걸 알아챈다', async () => {
    // 개수로 가리면 "옮기기/회전" 같은 편집은 안 걸린다. 지문은 좌표·회전·
    // 쌓임 순서까지 섞는다.
    await loadDocument('p1', good)
    await new Promise(res => setTimeout(res, 0))

    const moved = snap([
      page('page:main', '모형'),
      shape('shape:w', 'wall', { x2: 200, y2: 0, thickness: 20 }, { x: 999 }),
      shape('shape:g', 'dxfgroup', { pathData: 'M0,0L10,0', textsJson: '[]' }),
    ])
    const r = await loadDocument('p1', moved)
    expect(r.kind === 'ok' && r.from).toBe('converted')
    expect(r.kind === 'ok' && r.doc.shapes.find(s => s.id === 'shape:w')?.x).toBe(999)
  })

  it('남의 프로젝트 캐시를 집어오지 않는다', async () => {
    await loadDocument('A', good)
    await loadDocument('B', snap([page('page:main', 'p'), shape('shape:z', 'zone')]))
    await new Promise(res => setTimeout(res, 0))
    expect((await readDocCache('A'))?.shapes).toHaveLength(2)
    expect((await readDocCache('B'))?.shapes).toHaveLength(1)
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
    await new Promise(res => setTimeout(res, 0))
    expect(await readDocCache('p3')).toBeNull()   // 캐시에도 안 남는다
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

  it('캐시가 손상돼 있어도 읽기는 된다', async () => {
    // 지문이 없는(또는 엉뚱한) 캐시는 그냥 안 맞는 캐시다. 거기서 멈추면
    // 캐시 하나 깨진 걸로 도면을 못 열게 된다.
    await idbSet('bimovedocs', docCacheKey('p6'), { 이상한것: true })
    const r = await loadDocument('p6', good)
    expect(r.kind === 'ok' && r.from).toBe('converted')
    expect(r.kind === 'ok' && r.doc.shapes).toHaveLength(2)
  })

  it('지문이 맞으면 캐시 **내용**을 그대로 준다 — 다시 변환하지 않는다', async () => {
    // 캐시가 실제로 읽히는지 확인한다. 같은 지문의 캐시에 표식을 심어두고
    // 그게 나오는지 본다 (안 나오면 캐시를 쓰는 척만 하는 것이다).
    const doc = fromTldrawSnapshot(good)
    await idbSet('bimovedocs', docCacheKey('p7'), {
      ...doc,
      shapes: [...doc.shapes, { ...doc.shapes[0], id: 'shape:표식' }],
    })
    const r = await loadDocument('p7', good)
    expect(r.kind === 'ok' && r.from).toBe('cache')
    expect(r.kind === 'ok' && r.doc.shapes.some(s => s.id === 'shape:표식')).toBe(true)
  })
})

describe('계정 전환', () => {
  it('읽는 중에 계정이 바뀌면 캐시에 쓰지 않는다', async () => {
    // 캐시 쓰기는 기다리지 않는 작업이다. 그 사이에 로그아웃·계정 전환이
    // 일어나면 IndexedDB 키의 사용자 스코프가 바뀌고, A 가 시작한 쓰기가
    // B 의 칸에 A 의 도면을 넣는다. 사무실에서 계정을 돌려 쓰면 금방 겹친다.
    setCurrentUserId('userA')
    await writeFullRecords('p8', good as SnapshotLike)

    // await 하지 않고 시작해서, 저장소를 읽는 사이에 계정을 바꾼다.
    const pending = loadDocument('p8')
    setCurrentUserId('userB')
    const r = await pending
    await new Promise(res => setTimeout(res, 0))

    // 읽기 자체는 된다 — 원본이 진실이니 막을 이유가 없다.
    expect(r.kind).toBe('ok')
    // 다만 B 의 칸에는 아무것도 안 남는다
    expect(await readDocCache('p8')).toBeNull()
  })

  it('계정이 그대로면 그 계정 칸에만 남는다', async () => {
    setCurrentUserId('userA')
    expect((await loadDocument('p9', good)).kind).toBe('ok')
    await new Promise(res => setTimeout(res, 0))
    expect((await readDocCache('p9'))?.shapes).toHaveLength(2)
    setCurrentUserId('userB')
    expect(await readDocCache('p9')).toBeNull()
  })
})
