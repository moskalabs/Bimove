// 도면을 들고 있는 것 — **tldraw 자리에 들어갈 알맹이.**
//
// tldraw 2.4.6 은 상업적 사용이 금지돼 있다 (v2.4.6 태그의 LICENSE.md:
// "You may not use or distribute this Software or any derivative works in
// any form for commercial purposes."). 금지 대상이 *use* 라서 화면에 안
// 그리고 저장소로만 써도 쓰는 것이다 — 그래서 통째로 걷어내야 한다.
//
// 포맷은 **이미 우리 것이다** (`lib/bimoveDoc.ts`, 1단계). 없던 건 **쓰기** 다.
// 여기가 그 자리다.
//
// ── 무엇을 흉내 내고 무엇을 안 하나 ──
//
// 앱이 실제로 쓰는 tldraw 에디터 API 는 44가지인데, 그 바닥은 도형 CRUD ·
// 장 · meta · 되돌리기 넷뿐이다. 카메라·선택·도구는 **화면의 일**이라 여기
// 두지 않는다 — 저장되지도 않고(tldraw 도 세션 상태로 뒀다), 섞어 두면
// "도형을 고르는 것" 과 "도면을 바꾸는 것" 이 같은 되돌리기에 들어간다.
//
// ── 되돌리기는 **스냅샷이 아니라 역패치** 다 ──
//
// 한 번 고칠 때마다 도면 전체를 베끼면 12MB 짜리에서 못 쓴다. 바뀐 레코드의
// **이전 값만** 들고 있는다. `undefined` 는 "그때는 없었다" 는 뜻이라,
// 만들기·고치기·지우기가 같은 모양으로 들어간다.

import type { BimoveDocument, BimovePage, BimoveShape } from '../lib/bimoveDoc'

/** 한 번의 되돌리기 단위. 바뀐 도형의 전/후를 짝으로 들고 있는다. */
type Patch = {
  /** 도형 id → 바뀌기 **전** 값. 없었으면 `undefined`. */
  before: Map<string, BimoveShape | undefined>
  /** 도형 id → 바뀐 **후** 값. 지웠으면 `undefined`. */
  after: Map<string, BimoveShape | undefined>
  /** 장 목록이 바뀌었으면 전/후. 안 바뀌었으면 `undefined`. */
  pages?: { before: BimovePage[]; after: BimovePage[] }
  /** 문서 meta 가 바뀌었으면 전/후. */
  meta?: { before: Record<string, unknown>; after: Record<string, unknown> }
}

/** 도형을 만들 때 주는 값. `id` 를 안 주면 만들어 준다. */
export type ShapeInit = Omit<Partial<BimoveShape>, 'type'> & { type: string }

/** 도형을 고칠 때 주는 값. 준 칸만 바뀐다. */
export type ShapePatch = Partial<Omit<BimoveShape, 'id'>> & { id: string }

/** 되돌릴 수 있는 깊이. 넘으면 오래된 것부터 버린다. */
const MAX_HISTORY = 100

function newId(prefix: string): string {
  try {
    return `${prefix}:${crypto.randomUUID()}`
  } catch {
    return `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  }
}

/**
 * 쌓임 순서를 만든다.
 *
 * tldraw 의 분수 인덱스를 그대로 이어받는다 — **사전순**으로 비교하므로
 * 'a2' 와 'a10' 을 숫자로 보면 뒤집힌다. 새 도형은 맨 위에 얹으면 되니
 * 지금 가장 큰 것 뒤에 글자를 하나 붙인다.
 */
function indexAbove(top: string | undefined): string {
  return top ? `${top}V` : 'a1'
}

export class BimoveStore {
  /** 도형을 id 로 — 배열로 들고 있으면 `getShape` 가 O(n) 이 된다. */
  private shapes = new Map<string, BimoveShape>()
  private pages: BimovePage[] = []
  private currentPageId = ''
  private meta: Record<string, unknown> = {}
  /** 도형·장이 아닌 레코드 (asset·binding…). **손대지 않고 들고만 간다.** */
  private records: Record<string, unknown> = {}

  private undoStack: Patch[] = []
  private redoStack: Patch[] = []
  /** `run` 안에서 모으는 중인 패치. 없으면 한 번에 하나씩 쌓는다. */
  private batch: Patch | null = null
  /** 되돌리는 중 — 그때 생기는 패치는 반대쪽 더미로 간다. */
  private undoing = false

  private listeners = new Set<() => void>()
  /** 바뀐 횟수. 화면이 "달라졌나" 만 보고 싶을 때 쓴다. */
  private rev = 0

  // ── 열고 닫기 ──

  /** 저장본을 올린다. **되돌리기 기록은 지운다** — 다른 도면이다. */
  load(doc: BimoveDocument): void {
    this.shapes = new Map(doc.shapes.map(s => [s.id, s]))
    this.pages = [...doc.pages]
    this.currentPageId = doc.pages[0]?.id ?? ''
    this.records = { ...doc.records }
    const docRec = doc.records['document:document']
    this.meta = isRecord(docRec) && isRecord(docRec.meta) ? { ...docRec.meta } : {}
    this.undoStack = []
    this.redoStack = []
    this.batch = null
    this.bump()
  }

  /** 지금 상태를 저장본 모양으로. `load` 로 되돌릴 수 있어야 한다. */
  toDocument(source: BimoveDocument['source']): BimoveDocument {
    const records = { ...this.records }
    const docRec = records['document:document']
    records['document:document'] = {
      ...(isRecord(docRec) ? docRec : { id: 'document:document', typeName: 'document' }),
      meta: { ...this.meta },
    }
    return {
      version: 1,
      pages: [...this.pages],
      // 쌓임 순서를 고정해 둔다 — 그리는 차례이기도 하다.
      shapes: this.allShapes(),
      records,
      source,
      skipped: 0,
    }
  }

  // ── 읽기 ──

  revision(): number { return this.rev }

  getPages(): BimovePage[] { return [...this.pages] }
  getCurrentPageId(): string { return this.currentPageId }

  getShape(id: string): BimoveShape | undefined { return this.shapes.get(id) }

  /** 쌓임 순서대로 전부. */
  allShapes(): BimoveShape[] {
    return [...this.shapes.values()].sort(byStacking)
  }

  /**
   * 한 장의 도형 — **그 장에 직접 붙은 것만**.
   *
   * 그룹 안에 든 도형은 부모가 도형이라 여기 안 걸린다 (`shapesOfPage` 와
   * 같은 규칙). 그룹째 다루는 쪽이 자연스럽고, 안 그러면 같은 도형이 두 번
   * 세어진다.
   */
  getPageShapes(pageId = this.currentPageId): BimoveShape[] {
    return this.allShapes().filter(s => s.parentId === pageId)
  }

  getMeta(): Record<string, unknown> { return this.meta }

  // ── 쓰기 ──

  /**
   * 여러 번 고치는 걸 **한 번의 되돌리기**로 묶는다.
   *
   * 벽 하나를 그리면 도형이 여럿 생긴다 — 되돌리기 한 번에 다 사라져야지,
   * 열 번 눌러야 하면 쓸 수가 없다. 겹쳐 불러도 가장 바깥에서만 묶는다.
   */
  run<T>(fn: () => T): T {
    if (this.batch) return fn()
    this.batch = { before: new Map(), after: new Map() }
    try {
      return fn()
    } finally {
      const patch = this.batch
      this.batch = null
      if (patch.before.size > 0 || patch.pages || patch.meta) this.commit(patch)
    }
  }

  createShapes(inits: ShapeInit[]): BimoveShape[] {
    return this.run(() => {
      let top = this.allShapes().at(-1)?.index
      const made: BimoveShape[] = []
      for (const init of inits) {
        const index = init.index ?? (top = indexAbove(top))
        const shape: BimoveShape = {
          id: init.id ?? newId('shape'),
          type: init.type,
          x: init.x ?? 0,
          y: init.y ?? 0,
          rotation: init.rotation ?? 0,
          index,
          parentId: init.parentId ?? this.currentPageId,
          props: init.props ?? {},
          ...(init.opacity !== undefined ? { opacity: init.opacity } : {}),
          ...(init.isLocked ? { isLocked: true } : {}),
          ...(init.meta ? { meta: init.meta } : {}),
        }
        this.put(shape.id, shape)
        made.push(shape)
      }
      return made
    })
  }

  createShape(init: ShapeInit): BimoveShape {
    return this.createShapes([init])[0]
  }

  /**
   * 준 칸만 바꾼다. **`props` 는 얕게 합친다** — tldraw 의 `updateShape` 와
   * 같은 규칙이라, 부르는 쪽이 통째로 다시 만들지 않아도 된다.
   */
  updateShape(patch: ShapePatch): void {
    const old = this.shapes.get(patch.id)
    if (!old) return
    this.run(() => {
      this.put(patch.id, {
        ...old,
        ...patch,
        props: patch.props ? { ...old.props, ...patch.props } : old.props,
        meta: patch.meta ? { ...old.meta, ...patch.meta } : old.meta,
      })
    })
  }

  deleteShapes(ids: string[]): void {
    this.run(() => {
      for (const id of ids) {
        // 지운 도형의 **자식도 같이** 지운다. 안 그러면 부모 없는 도형이
        // 남아 어느 장에도 안 보이면서 저장본에는 실린다.
        for (const child of this.descendants(id)) this.put(child, undefined)
        this.put(id, undefined)
      }
    })
  }

  deleteShape(id: string): void { this.deleteShapes([id]) }

  setCurrentPage(pageId: string): void {
    // **되돌리기에 안 넣는다.** 보고 있는 자리는 도면이 아니라 화면이다.
    if (!this.pages.some(p => p.id === pageId) || pageId === this.currentPageId) return
    this.currentPageId = pageId
    this.bump()
  }

  createPage(name: string, id = newId('page')): BimovePage {
    return this.run(() => {
      const before = [...this.pages]
      const page: BimovePage = { id, name, index: indexAbove(this.pages.at(-1)?.index) }
      this.pages = [...this.pages, page]
      this.notePages(before)
      return page
    })
  }

  /** 문서 meta 의 키 하나. **다른 키는 그대로 둔다** (docMeta.ts 와 같은 규칙). */
  setMeta(key: string, value: unknown): void {
    this.run(() => {
      const before = { ...this.meta }
      this.meta = { ...this.meta, [key]: value }
      if (!this.batch!.meta) this.batch!.meta = { before, after: this.meta }
      else this.batch!.meta.after = this.meta
    })
  }

  // ── 되돌리기 ──

  canUndo(): boolean { return this.undoStack.length > 0 }
  canRedo(): boolean { return this.redoStack.length > 0 }

  undo(): void { this.step(this.undoStack, this.redoStack, 'before') }
  redo(): void { this.step(this.redoStack, this.undoStack, 'after') }

  // ── 구독 ──

  /** 바뀔 때마다 부른다. 돌려주는 걸 부르면 끊긴다. */
  listen(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  // ── 안쪽 ──

  /** 한 도형을 놓거나(`shape`) 지운다(`undefined`). 전/후를 패치에 적는다. */
  private put(id: string, shape: BimoveShape | undefined): void {
    const patch = this.batch
    if (patch && !patch.before.has(id)) patch.before.set(id, this.shapes.get(id))
    if (shape) this.shapes.set(id, shape)
    else this.shapes.delete(id)
    patch?.after.set(id, shape)
  }

  private notePages(before: BimovePage[]): void {
    const patch = this.batch
    if (!patch) return
    if (!patch.pages) patch.pages = { before, after: [...this.pages] }
    else patch.pages.after = [...this.pages]
  }

  private commit(patch: Patch): void {
    if (this.undoing) return
    this.undoStack.push(patch)
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
    // 새로 고치면 **앞으로 가기는 버린다.** 갈라진 역사를 들고 있으면
    // 다시 실행이 엉뚱한 것을 되살린다.
    this.redoStack = []
    this.bump()
  }

  private step(from: Patch[], to: Patch[], side: 'before' | 'after'): void {
    const patch = from.pop()
    if (!patch) return
    this.undoing = true
    try {
      for (const [id, shape] of patch[side]) {
        if (shape) this.shapes.set(id, shape)
        else this.shapes.delete(id)
      }
      if (patch.pages) this.pages = [...patch.pages[side]]
      if (patch.meta) this.meta = { ...patch.meta[side] }
      // 보고 있던 장이 사라졌으면 첫 장으로. 없는 장을 가리킨 채 두면
      // 화면이 통째로 빈다.
      if (!this.pages.some(p => p.id === this.currentPageId)) {
        this.currentPageId = this.pages[0]?.id ?? ''
      }
    } finally {
      this.undoing = false
    }
    to.push(patch)
    this.bump()
  }

  /** 이 도형 아래에 달린 것 전부 (그룹·프레임). */
  private descendants(id: string): string[] {
    const out: string[] = []
    const stack = [id]
    while (stack.length) {
      const parent = stack.pop()!
      for (const s of this.shapes.values()) {
        if (s.parentId === parent) { out.push(s.id); stack.push(s.id) }
      }
    }
    return out
  }

  private bump(): void {
    this.rev++
    for (const fn of this.listeners) fn()
  }
}

function byStacking(a: BimoveShape, b: BimoveShape): number {
  // 분수 인덱스는 **사전순**이다 (BimoveShape.index 주석).
  return a.index < b.index ? -1 : a.index > b.index ? 1 : 0
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
