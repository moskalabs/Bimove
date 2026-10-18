// Bimove 의 **우리 것인** 문서 포맷.
//
// 지금 저장된 도면은 전부 tldraw 스냅샷이다. tldraw 2.4.6 의 라이선스가
// 비상업 전용이라 걷어내야 하는데, 그러면 저장된 도면을 아무도 못 읽는다.
// 그래서 **먼저 포맷을 우리 것으로 옮긴다.** 화면은 그대로 두고 데이터만
// 안전한 곳으로 빼는 단계다.
//
// ── 설계: 도형을 다시 모델링하지 않는다 ──
//
// 벽체·문·공간·치수를 타입마다 새 모델로 옮겨 적을 수도 있다. 하지만 그러면
// **빠뜨린 필드가 조용히 사라진다** — 이전의 목적이 정확히 그 반대다.
// 그래서 `props` 를 통째로 그대로 싣는다. 새 엔진이 읽을 때 해석하면 된다.
//
// 모르는 타입(tldraw 기본 도형 geo/line/arrow/text, 나중에 생길 우리 도형)도
// 같은 규칙으로 실린다. 변환기가 타입 목록을 알 필요가 없다는 뜻이고, 그게
// 유실을 막는 가장 확실한 방법이다.

/** 문서 포맷 판번호. 읽는 쪽이 이걸 보고 갈린다. */
export const BIMOVE_DOC_VERSION = 1

export interface BimoveShape {
  id: string
  /** 'wall' | 'dxfgroup' | 'zone' | 'geo' … 해석은 읽는 쪽이 한다. */
  type: string
  x: number
  y: number
  rotation: number
  /** 쌓임 순서 (tldraw 의 분수 인덱스). 사전순으로 비교한다. */
  index: string
  /** 어느 페이지에 있는지. */
  pageId: string
  opacity?: number
  isLocked?: boolean
  /** 도형 고유 값 **그대로**. 해석하지 않는다. */
  props: Record<string, unknown>
  meta?: Record<string, unknown>
}

export interface BimovePage {
  id: string
  name: string
  index: string
}

export interface BimoveDocument {
  version: number
  pages: BimovePage[]
  shapes: BimoveShape[]
  /** 어디서 왔는지. 뭔가 이상할 때 되짚을 단서다. */
  source: { from: string; at: number }
  /**
   * 옮기다 **못 읽은 레코드** 수. 0 이 아니면 유실이다.
   *
   * 조용히 0 으로 두면 "다 옮겼다" 로 보이므로 반드시 남긴다 — 저장하기 전에
   * 호출부가 이 값을 보고 막을 수 있다.
   */
  skipped: number
}

/** tldraw 스냅샷의 모양 중 우리가 읽는 부분만. */
interface SnapshotLike {
  document?: { store?: Record<string, unknown> }
  store?: Record<string, unknown>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

/**
 * 스냅샷에서 레코드 맵을 꺼낸다.
 *
 * 저장된 모양이 두 가지다 — `getSnapshot()` 이 준 `{document:{store}}` 와,
 * 레코드 단위 저장이 되살린 같은 모양. 옛 통짜 저장본 중에는 `{store}` 만
 * 있는 것도 있다. 셋 다 받는다.
 */
function storeOf(snapshot: unknown): Record<string, unknown> | null {
  if (!isRecord(snapshot)) return null
  const s = snapshot as SnapshotLike
  if (isRecord(s.document?.store)) return s.document.store
  if (isRecord(s.store)) return s.store
  return null
}

/**
 * tldraw 스냅샷을 Bimove 문서로 옮긴다.
 *
 * **아무것도 버리지 않는다.** 모르는 도형 타입도 props 째로 실린다. 못 읽은
 * 레코드는 `skipped` 로 센다 — 0 이 아니면 호출부가 멈출 수 있게.
 */
export function fromTldrawSnapshot(snapshot: unknown): BimoveDocument {
  const store = storeOf(snapshot)
  const pages: BimovePage[] = []
  const shapes: BimoveShape[] = []
  let skipped = 0

  if (!store) {
    return { version: BIMOVE_DOC_VERSION, pages, shapes, source: { from: 'tldraw', at: Date.now() }, skipped: 0 }
  }

  for (const [key, rec] of Object.entries(store)) {
    if (!isRecord(rec)) { skipped++; continue }
    // typeName 이 권위다. 키 접두사(`shape:`)는 거들 뿐 — 옛 저장본에
    // 섞여 있을 수 있어 둘 다 본다.
    const typeName = str(rec.typeName) || key.split(':')[0]

    if (typeName === 'page') {
      pages.push({
        id: str(rec.id, key),
        name: str(rec.name, '페이지'),
        index: str(rec.index, 'a1'),
      })
      continue
    }
    if (typeName !== 'shape') continue   // camera, instance, asset … 은 도면이 아니다

    const type = str(rec.type)
    if (!type) { skipped++; continue }

    shapes.push({
      id: str(rec.id, key),
      type,
      x: num(rec.x),
      y: num(rec.y),
      rotation: num(rec.rotation),
      index: str(rec.index, 'a1'),
      pageId: str(rec.parentId),
      ...(typeof rec.opacity === 'number' ? { opacity: rec.opacity } : {}),
      ...(rec.isLocked === true ? { isLocked: true } : {}),
      props: isRecord(rec.props) ? rec.props : {},
      ...(isRecord(rec.meta) && Object.keys(rec.meta).length > 0 ? { meta: rec.meta } : {}),
    })
  }

  // 쌓임 순서를 고정해 둔다. 분수 인덱스는 **사전순**으로 비교한다 —
  // 숫자로 보면 'a2' 와 'a10' 이 뒤집힌다.
  shapes.sort((a, b) => (a.pageId === b.pageId
    ? (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)
    : (a.pageId < b.pageId ? -1 : 1)))
  pages.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))

  return {
    version: BIMOVE_DOC_VERSION,
    pages,
    shapes,
    source: { from: 'tldraw', at: Date.now() },
    skipped,
  }
}

/** 한 페이지의 도형만. */
export function shapesOfPage(doc: BimoveDocument, pageId: string): BimoveShape[] {
  return doc.shapes.filter(s => s.pageId === pageId)
}

/** 타입별 개수 — 옮긴 뒤 "맞게 왔나" 를 눈으로 보는 용도. */
export function countByType(doc: BimoveDocument): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of doc.shapes) out[s.type] = (out[s.type] ?? 0) + 1
  return out
}
