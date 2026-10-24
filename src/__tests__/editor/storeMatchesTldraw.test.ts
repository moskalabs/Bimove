/**
 * **우리 저장소가 tldraw 와 같은 답을 내나.**
 *
 * 갈아끼울 때 조용히 달라지는 게 제일 무섭다 — 쌓임 순서가 뒤집히거나,
 * `updateShape` 이 props 를 덮어쓰거나, 되돌리기 묶음이 다르게 쪼개지면
 * 화면에서는 한참 뒤에나 보인다. 그래서 **같은 일을 둘에게 시키고 결과를
 * 견준다.**
 *
 * tldraw 는 여기서만 쓴다 (걷어낼 때 이 파일도 같이 지운다). 비교할 상대가
 * 사라지면 이 테스트도 할 일이 없다.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createTLStore, createShapeId, defaultShapeUtils, Editor, defaultTools, Box } from 'tldraw'
import { BimoveStore } from '../../editor/store'
import { BimoveView } from '../../editor/view'
import { fromTldrawSnapshot } from '../../lib/bimoveDoc'

// tldraw 의 Editor 는 만들 때 `matchMedia` 를 본다 (사용자 환경 설정 —
// 다크 모드·모션 줄이기). jsdom 에는 없어서 그대로 두면 생성자가 터진다.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})

/** 머리 없는 tldraw 에디터. 캔버스를 안 만든다. */
function tld() {
  const store = createTLStore({ shapeUtils: defaultShapeUtils })
  const editor = new Editor({
    store,
    shapeUtils: defaultShapeUtils,
    tools: defaultTools,
    bindingUtils: [],
    getContainer: () => document.createElement('div'),
  })
  return editor
}

/** 우리 저장소를 그 에디터의 지금 상태로 올린다. */
function mirror(editor: Editor): BimoveStore {
  const s = new BimoveStore()
  s.load(fromTldrawSnapshot(editor.getSnapshot()))
  return s
}

const ids = (xs: { id: string }[]) => xs.map(x => x.id)

describe('우리 저장소 vs tldraw', () => {
  it('쌓임 순서가 같다 — 분수 인덱스는 **사전순**이다', () => {
    const editor = tld()
    const made = Array.from({ length: 12 }, () => createShapeId())
    editor.createShapes(made.map(id => ({ id, type: 'geo' as const, x: 0, y: 0 })))

    const ours = mirror(editor)
    const theirs = editor.getCurrentPageShapes()
    // tldraw 가 'a1'…'a10' 을 만들었을 때 숫자로 보면 뒤집힌다.
    expect(ids(ours.getPageShapes())).toEqual(ids(theirs))
  })

  it('updateShape — props 를 **합치지 덮지 않는다**', () => {
    const editor = tld()
    const id = createShapeId()
    editor.createShape({ id, type: 'geo', x: 0, y: 0, props: { w: 100, h: 50 } })
    const ours = mirror(editor)

    editor.updateShape({ id, type: 'geo', props: { w: 200 } })
    ours.updateShape({ id, props: { w: 200 } })

    const t = editor.getShape(id)!.props as { w: number; h: number }
    const o = ours.getShape(id)!.props as { w: number; h: number }
    expect(o.w).toBe(t.w)
    // h 가 살아 있어야 한다 — 덮어쓰면 도형이 납작해진다.
    expect(o.h).toBe(t.h)
  })

  it('x·y·rotation 을 같은 자리에 둔다', () => {
    const editor = tld()
    const id = createShapeId()
    editor.createShape({ id, type: 'geo', x: 12, y: -34, rotation: 1.2 })
    const ours = mirror(editor)
    const t = editor.getShape(id)!
    expect(ours.getShape(id)).toMatchObject({ x: t.x, y: t.y, rotation: t.rotation })
  })

  it('지우면 자식도 같이 — tldraw 와 같다', () => {
    const editor = tld()
    const parent = createShapeId()
    const child = createShapeId()
    editor.createShape({ id: parent, type: 'frame', x: 0, y: 0 })
    editor.createShape({ id: child, type: 'geo', x: 10, y: 10, parentId: parent })

    const ours = mirror(editor)
    editor.deleteShape(parent)
    ours.deleteShape(parent)

    expect(editor.getShape(child)).toBeUndefined()
    expect(ours.getShape(child)).toBeUndefined()
    expect(ids(ours.allShapes())).toEqual(ids(editor.getCurrentPageShapes()))
  })

  it('되돌리기 한 번에 **묶음 전체**가 돌아간다', () => {
    const editor = tld()
    const made = [createShapeId(), createShapeId(), createShapeId()]
    const ours = mirror(editor)

    editor.run(() => {
      editor.createShapes(made.map(id => ({ id, type: 'geo' as const, x: 0, y: 0 })))
    })
    ours.run(() => {
      ours.createShapes(made.map(id => ({ id, type: 'geo', x: 0, y: 0 })))
    })
    expect(ours.allShapes()).toHaveLength(editor.getCurrentPageShapes().length)

    editor.undo()
    ours.undo()
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
    expect(ours.allShapes()).toHaveLength(0)
  })

  it('한 장의 도형 — 그룹 안에 든 건 양쪽 다 안 센다', () => {
    const editor = tld()
    const frame = createShapeId()
    editor.createShape({ id: frame, type: 'frame', x: 0, y: 0 })
    editor.createShape({ id: createShapeId(), type: 'geo', x: 1, y: 1, parentId: frame })
    editor.createShape({ id: createShapeId(), type: 'geo', x: 2, y: 2 })

    const ours = mirror(editor)
    const pageId = editor.getCurrentPageId()
    const theirs = editor.getCurrentPageShapes().filter(s => s.parentId === pageId)
    expect(ids(ours.getPageShapes(pageId))).toEqual(ids(theirs))
  })
})

describe('우리 카메라 vs tldraw', () => {
  // 좌표가 어긋나면 **클릭이 엉뚱한 도형을 집는다.** 화면에서는 "가끔 안
  // 눌린다" 로만 보여서 찾기가 아주 어렵다.
  const BOX = { w: 800, h: 600 }

  /** tldraw 에디터의 카메라를 우리 것에 옮긴다. */
  function sameCamera(editor: Editor): BimoveView {
    const v = new BimoveView()
    v.setBox(BOX)
    editor.updateViewportScreenBounds(new Box(0, 0, BOX.w, BOX.h))
    const c = editor.getCamera()
    v.setZoom(c.z)
    // tldraw 의 화면 한가운데가 보는 page 좌표
    v.setCenter(editor.screenToPage({ x: BOX.w / 2, y: BOX.h / 2 }))
    return v
  }

  it('화면 ↔ 도면 변환이 같다', () => {
    const editor = tld()
    const v = sameCamera(editor)
    for (const s of [{ x: 0, y: 0 }, { x: 800, y: 600 }, { x: 137, y: 412 }]) {
      const t = editor.screenToPage(s)
      const o = v.screenToPage(s)
      expect(o.x).toBeCloseTo(t.x, 6)
      expect(o.y).toBeCloseTo(t.y, 6)
    }
  })

  it('확대해도 같다', () => {
    const editor = tld()
    editor.updateViewportScreenBounds(new Box(0, 0, BOX.w, BOX.h))
    editor.setCamera({ x: 120, y: -45, z: 3.5 })
    const v = sameCamera(editor)
    for (const s of [{ x: 10, y: 10 }, { x: 790, y: 590 }]) {
      const t = editor.screenToPage(s)
      const o = v.screenToPage(s)
      expect(o.x).toBeCloseTo(t.x, 5)
      expect(o.y).toBeCloseTo(t.y, 5)
    }
  })

  it('page → 화면도 같다', () => {
    const editor = tld()
    editor.updateViewportScreenBounds(new Box(0, 0, BOX.w, BOX.h))
    editor.setCamera({ x: -300, y: 200, z: 0.4 })
    const v = sameCamera(editor)
    for (const p of [{ x: 0, y: 0 }, { x: 1000, y: -500 }]) {
      const t = editor.pageToViewport(p)
      const o = v.pageToScreen(p)
      expect(o.x).toBeCloseTo(t.x, 5)
      expect(o.y).toBeCloseTo(t.y, 5)
    }
  })
})
