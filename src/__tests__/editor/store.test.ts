/**
 * tldraw 자리에 들어갈 문서 저장소.
 *
 * 여기가 틀리면 **도면이 조용히 상한다** — 되돌리기가 반만 돌아가거나, 지운
 * 도형의 자식이 남아 저장본에만 실리거나, 묶어야 할 것이 열 번으로 쪼개진다.
 * 전부 화면에서는 한참 뒤에야 보이는 것들이라 여기서 못 박는다.
 */
import { describe, it, expect, vi } from 'vitest'
import { BimoveStore } from '../../editor/store'
import type { BimoveDocument } from '../../lib/bimoveDoc'

function doc(over: Partial<BimoveDocument> = {}): BimoveDocument {
  return {
    version: 1,
    pages: [{ id: 'page:a', name: '모형', index: 'a1' }],
    shapes: [],
    records: {},
    source: { from: 'test', at: 0, shapeCount: 0 },
    skipped: 0,
    ...over,
  }
}

const SOURCE = { from: 'test', at: 0, shapeCount: 0 }

function loaded(over: Partial<BimoveDocument> = {}) {
  const s = new BimoveStore()
  s.load(doc(over))
  return s
}

describe('BimoveStore — 열고 닫기', () => {
  it('저장본을 올리고 그대로 돌려준다', () => {
    const d = doc({
      pages: [{ id: 'page:a', name: '모형', index: 'a1' }, { id: 'page:b', name: '배치', index: 'a2' }],
      shapes: [{ id: 'shape:1', type: 'wall', x: 1, y: 2, rotation: 0, index: 'a1', parentId: 'page:a', props: { x2: 10 } }],
      records: { 'document:document': { typeName: 'document', meta: { scale: { pxPerMm: 0.02 } } } },
    })
    const s = new BimoveStore()
    s.load(d)
    const out = s.toDocument(SOURCE)
    expect(out.pages).toEqual(d.pages)
    expect(out.shapes).toEqual(d.shapes)
    expect(out.records['document:document']).toMatchObject({ meta: { scale: { pxPerMm: 0.02 } } })
  })

  it('도형·장이 아닌 레코드를 **들고 간다** — asset 에 이미지 본문이 있다', () => {
    const s = loaded({ records: { 'asset:img': { typeName: 'asset', src: 'data:...' } } })
    expect(s.toDocument(SOURCE).records['asset:img']).toEqual({ typeName: 'asset', src: 'data:...' })
  })

  it('다른 도면을 올리면 되돌리기 기록이 지워진다', () => {
    const s = loaded()
    s.createShape({ type: 'wall' })
    expect(s.canUndo()).toBe(true)
    s.load(doc())
    expect(s.canUndo()).toBe(false)
  })
})

describe('BimoveStore — 도형', () => {
  it('만들면 id 와 쌓임 순서가 붙는다', () => {
    const s = loaded()
    const a = s.createShape({ type: 'wall' })
    const b = s.createShape({ type: 'zone' })
    expect(a.id).toMatch(/^shape:/)
    expect(a.parentId).toBe('page:a')
    // 나중에 만든 게 위다 — **사전순**으로 비교한다.
    expect(a.index < b.index).toBe(true)
    expect(s.allShapes().map(x => x.id)).toEqual([a.id, b.id])
  })

  it('updateShape 은 준 칸만 바꾸고 props 는 **얕게 합친다**', () => {
    const s = loaded()
    const a = s.createShape({ type: 'wall', x: 1, y: 2, props: { x2: 10, thickness: 20 } })
    s.updateShape({ id: a.id, x: 5, props: { thickness: 30 } })
    expect(s.getShape(a.id)).toMatchObject({
      x: 5, y: 2, props: { x2: 10, thickness: 30 },
    })
  })

  it('없는 도형을 고치면 아무 일도 안 난다', () => {
    const s = loaded()
    s.updateShape({ id: 'shape:없음', x: 1 })
    expect(s.allShapes()).toHaveLength(0)
    expect(s.canUndo()).toBe(false)
  })

  it('지우면 **자식도 같이** 사라진다', () => {
    // 안 그러면 부모 없는 도형이 남아 어느 장에도 안 보이면서 저장본에는 실린다.
    const s = loaded()
    const g = s.createShape({ type: 'group' })
    const child = s.createShape({ type: 'wall', parentId: g.id })
    const grand = s.createShape({ type: 'wall', parentId: child.id })
    s.deleteShape(g.id)
    expect(s.allShapes()).toHaveLength(0)
    expect(s.getShape(grand.id)).toBeUndefined()
  })

  it('한 장의 도형만 — 그룹 안에 든 건 안 걸린다', () => {
    const s = loaded({ pages: [{ id: 'page:a', name: 'A', index: 'a1' }, { id: 'page:b', name: 'B', index: 'a2' }] })
    const g = s.createShape({ type: 'group' })
    s.createShape({ type: 'wall', parentId: g.id })
    s.createShape({ type: 'wall', parentId: 'page:b' })
    expect(s.getPageShapes('page:a').map(x => x.type)).toEqual(['group'])
    expect(s.getPageShapes('page:b').map(x => x.type)).toEqual(['wall'])
  })
})

describe('BimoveStore — 되돌리기', () => {
  it('만들기 → 되돌리기 → 다시 실행', () => {
    const s = loaded()
    const a = s.createShape({ type: 'wall' })
    s.undo()
    expect(s.getShape(a.id)).toBeUndefined()
    s.redo()
    expect(s.getShape(a.id)).toBeDefined()
  })

  it('고치기를 되돌리면 **옛 값**으로 돌아간다', () => {
    const s = loaded()
    const a = s.createShape({ type: 'wall', x: 1, props: { thickness: 20 } })
    s.updateShape({ id: a.id, x: 99, props: { thickness: 30 } })
    s.undo()
    expect(s.getShape(a.id)).toMatchObject({ x: 1, props: { thickness: 20 } })
  })

  it('지우기를 되돌리면 자식까지 살아난다', () => {
    const s = loaded()
    const g = s.createShape({ type: 'group' })
    const child = s.createShape({ type: 'wall', parentId: g.id })
    s.deleteShape(g.id)
    s.undo()
    expect(s.getShape(g.id)).toBeDefined()
    expect(s.getShape(child.id)).toBeDefined()
  })

  it('`run` 으로 묶은 건 **한 번에** 되돌아간다', () => {
    // 벽 하나에 도형이 여럿 생기는데 열 번 눌러야 하면 쓸 수가 없다.
    const s = loaded()
    s.run(() => {
      s.createShape({ type: 'wall' })
      s.createShape({ type: 'door' })
      s.createShape({ type: 'window' })
    })
    expect(s.allShapes()).toHaveLength(3)
    s.undo()
    expect(s.allShapes()).toHaveLength(0)
    expect(s.canUndo()).toBe(false)
  })

  it('`run` 을 겹쳐 불러도 가장 바깥에서만 묶는다', () => {
    const s = loaded()
    s.run(() => {
      s.createShape({ type: 'wall' })
      s.run(() => { s.createShape({ type: 'door' }) })
    })
    s.undo()
    expect(s.allShapes()).toHaveLength(0)
  })

  it('되돌린 뒤 새로 고치면 **앞으로 가기는 버린다**', () => {
    // 갈라진 역사를 들고 있으면 다시 실행이 엉뚱한 것을 되살린다.
    const s = loaded()
    const a = s.createShape({ type: 'wall' })
    s.undo()
    s.createShape({ type: 'zone' })
    expect(s.canRedo()).toBe(false)
    s.redo()
    expect(s.getShape(a.id)).toBeUndefined()
  })

  it('되돌릴 게 없으면 아무 일도 안 난다', () => {
    const s = loaded()
    s.undo(); s.undo(); s.redo()
    expect(s.allShapes()).toHaveLength(0)
  })

  it('장을 보는 자리는 **되돌리기에 안 들어간다**', () => {
    // 도면이 아니라 화면이다. 섞이면 "뒤로" 가 엉뚱하게 장을 넘긴다.
    const s = loaded({ pages: [{ id: 'page:a', name: 'A', index: 'a1' }, { id: 'page:b', name: 'B', index: 'a2' }] })
    s.createShape({ type: 'wall' })
    s.setCurrentPage('page:b')
    s.undo()
    expect(s.getCurrentPageId()).toBe('page:b')
    expect(s.allShapes()).toHaveLength(0)
  })

  it('장 만들기를 되돌리면 **보던 자리가 살아남는다**', () => {
    const s = loaded()
    const p = s.createPage('배치1')
    s.setCurrentPage(p.id)
    s.undo()
    expect(s.getPages()).toHaveLength(1)
    // 없는 장을 가리킨 채 두면 화면이 통째로 빈다.
    expect(s.getCurrentPageId()).toBe('page:a')
  })
})

describe('BimoveStore — meta', () => {
  it('키 하나만 바꾸고 나머지는 둔다', () => {
    const s = loaded({ records: { 'document:document': { typeName: 'document', meta: { scale: 1, comments: [] } } } })
    s.setMeta('scale', 2)
    expect(s.getMeta()).toEqual({ scale: 2, comments: [] })
  })

  it('meta 도 되돌아간다', () => {
    const s = loaded()
    s.setMeta('scale', { pxPerMm: 0.02 })
    s.setMeta('scale', { pxPerMm: 0.1 })
    s.undo()
    expect(s.getMeta().scale).toEqual({ pxPerMm: 0.02 })
  })

  it('저장본에 실린다', () => {
    const s = loaded()
    s.setMeta('comments', [{ id: 'c1' }])
    const rec = s.toDocument(SOURCE).records['document:document'] as { meta: Record<string, unknown> }
    expect(rec.meta.comments).toEqual([{ id: 'c1' }])
  })
})

describe('BimoveStore — 구독', () => {
  it('바뀌면 알린다', () => {
    const s = loaded()
    const fn = vi.fn()
    s.listen(fn)
    s.createShape({ type: 'wall' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('묶으면 **한 번만** 알린다 — 안 그러면 큰 도면에서 화면이 수십 번 돈다', () => {
    const s = loaded()
    const fn = vi.fn()
    s.listen(fn)
    s.run(() => {
      s.createShape({ type: 'wall' })
      s.createShape({ type: 'door' })
      s.createShape({ type: 'window' })
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('끊으면 안 온다', () => {
    const s = loaded()
    const fn = vi.fn()
    s.listen(fn)()
    s.createShape({ type: 'wall' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('revision 이 바뀐 걸 센다 — 화면이 참조 비교로 쓴다', () => {
    const s = loaded()
    const before = s.revision()
    s.createShape({ type: 'wall' })
    expect(s.revision()).toBeGreaterThan(before)
  })
})
