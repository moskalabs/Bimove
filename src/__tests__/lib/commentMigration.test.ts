import { describe, it, expect } from 'vitest'
import { migrateCommentShapes } from '../../lib/commentMigration'
import { getThreads, threadsOnPage, type CommentThread } from '../../lib/commentStore'

/** `{document:{store}}` 모양 — `getSnapshot()` 이 주는 그것. */
function snap(records: Record<string, unknown>) {
  return { document: { store: records, schema: { v: 1 } }, session: { x: 1 } }
}

function commentShape(id: string, over: Record<string, unknown> = {}) {
  return {
    id, typeName: 'shape', type: 'comment',
    x: 100, y: 200, rotation: 0, index: 'a1', parentId: 'page:main',
    props: { text: '여기 확인', resolved: false, author: '김반장' },
    ...over,
  }
}

const wall = {
  id: 'shape:w1', typeName: 'shape', type: 'wall',
  x: 0, y: 0, rotation: 0, index: 'a1', parentId: 'page:main',
  props: { x2: 100, y2: 0, thickness: 20 },
}

/** 옮긴 결과를 `commentStore` 로 읽어 본다 — 저장 포맷이 맞는지 보려면 그게 맞다. */
function readBack(snapshot: unknown, pageId = 'page:main'): CommentThread[] {
  const store = (snapshot as { document: { store: Record<string, unknown> } }).document.store
  const settings = store['document:document'] as { meta?: unknown }
  const editor = {
    getDocumentSettings: () => settings,
    updateDocumentSettings: () => {},
    getCurrentPageId: () => pageId,
    getPages: () => [{ id: 'page:main' }, { id: 'page:two' }],
  } as never
  return threadsOnPage(editor)
}

describe('migrateCommentShapes', () => {
  it('옮길 게 없으면 **원본 그대로** 돌려준다', () => {
    // 후보를 차례로 시도하는 쪽이라, 손대지 않은 건 참조까지 그대로여야
    // 쓸데없는 재직렬화가 안 생긴다.
    const s = snap({ 'shape:w1': wall })
    const r = migrateCommentShapes(s)
    expect(r).toEqual({ snapshot: s, moved: 0, dropped: 0 })
    expect(r.snapshot).toBe(s)
  })

  it('도형을 **빼내고** meta 로 옮긴다', () => {
    // 이게 안 되면 tldraw 가 모르는 타입이라며 loadSnapshot 을 거부하고,
    // 후보가 전부 같은 이유로 실패해 그 프로젝트는 영영 안 열린다.
    const r = migrateCommentShapes(snap({ 'shape:w1': wall, 'shape:c1': commentShape('shape:c1') }))
    const store = (r.snapshot as { document: { store: Record<string, unknown> } }).document.store

    expect(r.moved).toBe(1)
    expect(store['shape:c1']).toBeUndefined()
    expect(store['shape:w1']).toBeDefined()

    const [t] = readBack(r.snapshot)
    expect(t.messages[0]).toMatchObject({ author: '김반장', text: '여기 확인', ts: 0 })
    expect(t.resolved).toBe(false)
  })

  it('가리키던 자리를 되찾는다 — 도형 자리가 아니라', () => {
    // CommentTool 이 클릭 지점에서 (x-16, y-42) 에 만들었다.
    const r = migrateCommentShapes(snap({ 'shape:c1': commentShape('shape:c1', { x: 100, y: 200 }) }))
    expect(readBack(r.snapshot)[0]).toMatchObject({ x: 116, y: 242 })
  })

  it('어느 장의 것인지 들고 간다', () => {
    const r = migrateCommentShapes(snap({
      'shape:c1': commentShape('shape:c1', { parentId: 'page:two' }),
    }))
    expect(readBack(r.snapshot, 'page:two')).toHaveLength(1)
    expect(readBack(r.snapshot, 'page:main')).toHaveLength(0)
  })

  it('그룹 안에 있던 것은 장을 모른다 → 첫 장으로', () => {
    const r = migrateCommentShapes(snap({
      'shape:c1': commentShape('shape:c1', { parentId: 'shape:group1' }),
    }))
    expect(readBack(r.snapshot, 'page:main')).toHaveLength(1)
    expect(readBack(r.snapshot, 'page:two')).toHaveLength(0)
  })

  it('글이 빈 핀은 버린다 — 만들기만 하고 안 쓴 것이다', () => {
    const r = migrateCommentShapes(snap({
      'shape:c1': commentShape('shape:c1', { props: { text: '  ', resolved: false, author: '한' } }),
      'shape:c2': commentShape('shape:c2'),
    }))
    expect(r).toMatchObject({ moved: 1, dropped: 1 })
    const store = (r.snapshot as { document: { store: Record<string, unknown> } }).document.store
    // 버린 것도 **스냅샷에서는 빠져야** 한다. 남으면 로드가 또 거부된다.
    expect(store['shape:c1']).toBeUndefined()
    expect(store['shape:c2']).toBeUndefined()
  })

  it('해결된 것은 해결된 채로', () => {
    const r = migrateCommentShapes(snap({
      'shape:c1': commentShape('shape:c1', { props: { text: '끝', resolved: true, author: '한' } }),
    }))
    expect(readBack(r.snapshot)[0].resolved).toBe(true)
  })

  it('이미 있는 글타래를 **지우지 않는다**', () => {
    const existing = { id: 'old', pageId: 'page:main', x: 1, y: 2, resolved: false,
      messages: [{ id: 'm', author: '한', text: '먼저 있던 것', ts: 5 }] }
    const r = migrateCommentShapes(snap({
      'document:document': { id: 'document:document', typeName: 'document', gridSize: 10, name: '',
        meta: { comments: [existing], scale: { pxPerMm: 0.02, unit: 'm' } } },
      'shape:c1': commentShape('shape:c1'),
    }))
    const got = readBack(r.snapshot)
    expect(got.map(t => t.messages[0].text)).toEqual(['먼저 있던 것', '여기 확인'])

    // 축척도 같이 실려 있다 — meta 를 통째로 덮으면 안 된다.
    const store = (r.snapshot as { document: { store: Record<string, unknown> } }).document.store
    const meta = (store['document:document'] as { meta: Record<string, unknown> }).meta
    expect(meta.scale).toEqual({ pxPerMm: 0.02, unit: 'm' })
  })

  it('문서 레코드가 없어도 만든다', () => {
    const r = migrateCommentShapes(snap({ 'shape:c1': commentShape('shape:c1') }))
    const store = (r.snapshot as { document: { store: Record<string, unknown> } }).document.store
    expect(store['document:document']).toMatchObject({ typeName: 'document' })
    expect(getThreads({
      getDocumentSettings: () => store['document:document'],
      updateDocumentSettings: () => {},
    } as never)).toHaveLength(1)
  })

  it('원본을 건드리지 않는다 — 뒤 후보까지 오염되면 안 된다', () => {
    const records = { 'shape:w1': wall, 'shape:c1': commentShape('shape:c1') }
    const s = snap(records)
    migrateCommentShapes(s)
    expect(s.document.store['shape:c1']).toBeDefined()
  })

  it('`{store}` 만 있는 옛 통짜 저장본도 받는다', () => {
    const r = migrateCommentShapes({ store: { 'shape:c1': commentShape('shape:c1') } })
    const store = (r.snapshot as { store: Record<string, unknown> }).store
    expect(r.moved).toBe(1)
    expect(store['shape:c1']).toBeUndefined()
  })

  it('스냅샷이 아닌 것은 그냥 돌려준다', () => {
    for (const bad of [null, undefined, 0, 'x', { nope: 1 }]) {
      expect(migrateCommentShapes(bad)).toEqual({ snapshot: bad, moved: 0, dropped: 0 })
    }
  })

  it('session·schema 를 잃지 않는다 — 카메라와 마이그레이션 정보다', () => {
    const r = migrateCommentShapes(snap({ 'shape:c1': commentShape('shape:c1') }))
    const s = r.snapshot as { document: { schema: unknown }; session: unknown }
    expect(s.document.schema).toEqual({ v: 1 })
    expect(s.session).toEqual({ x: 1 })
  })
})
