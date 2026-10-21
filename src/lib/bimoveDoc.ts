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

import type { ScaleConfig, ScaleUnit } from './scaleConfig'

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
  /**
   * 부모 레코드 id — **페이지일 수도, 다른 도형(그룹·프레임)일 수도 있다.**
   *
   * 전엔 `pageId` 라 부르고 페이지로만 취급했다. 그러면 그룹 안에 든 도형의
   * 부모 관계가 통째로 사라진다. 이름을 사실대로 바꾼다.
   */
  parentId: string
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
  /**
   * 도형·페이지가 아닌 레코드 **원형 그대로**.
   *
   * 처음엔 "도면이 아니다" 며 버렸다. 그게 틀렸다 —
   * - `asset` 에 **이미지·PDF 본문**이 들어 있다. image 도형은 `assetId` 만
   *   들고 있어서, asset 을 버리면 그림이 통째로 사라진다. 한의 도면에서
   *   실제로 스캔 이미지 하나가 그렇게 날아갔다.
   * - `binding` 에 화살표가 무엇에 붙었는지가 들어 있다. 버리면 연결이 끊긴다.
   *
   * 무엇이 중요한지 **미리 알 수 없으므로** 모르는 건 버리지 말고 들고 간다.
   * 읽는 쪽이 나중에 해석하면 된다. 그게 유실을 막는 유일한 방법이다.
   */
  records: Record<string, unknown>
  /**
   * 어디서 왔는지.
   *
   * 한때 원본의 지문(`sourceHash`)도 같이 남겼다. 캐시가 낡았는지 보려던
   * 것인데, **지문이 props 의 키 개수만 봐서** 벽 길이나 pathData 처럼 값만
   * 바뀌는 편집을 못 잡았다 — 낡은 캐시를 최신으로 내줬다는 뜻이다.
   *
   * 제대로 고치려면 수 MB 짜리 문자열을 전부 훑어야 하는데, 그건 캐시가
   * 아껴주는 변환보다 비싸다. 그래서 **캐시째로 없앴다** (bimoveDocStore 주석).
   * 틀린 값을 남겨두면 언젠가 누가 믿는다.
   */
  source: { from: string; at: number; shapeCount: number }
  /**
   * 도면의 축척 — 캔버스 1px 이 몇 mm 인가, 그리고 길이를 어느 단위로 쓰나.
   *
   * **없을 수 있다.** 축척을 문서 레코드에 넣기 전에 저장된 도면에는 아무
   * 자리에도 안 들어 있다 (그때는 tldraw 세션 상태에만 있었다). 읽는 쪽이
   * 없는 걸 **없다고 알려야** 한다 — 조용히 1 로 두면 2000mm 짜리 벽에
   * "200mm" 가 찍히고 아무도 모른다. 엔진은 그래서 `notes` 에 적는다
   * (`crates/bimove-wasm/src/dim.rs`).
   */
  scale?: ScaleConfig
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
 * 문서 레코드의 meta 에서 축척을 꺼낸다. 없거나 못 쓰는 값이면 `undefined`.
 *
 * `pxPerMm` 이 0 이나 음수면 **버린다.** 그걸 넘기면 엔진이 `1/0 = Infinity`
 * 를 DIMLFAC 으로 쓰고 치수 숫자가 통째로 깨진다. 없는 것과 같이 다루는
 * 편이 낫다 — 그 쪽은 적어도 `notes` 에 올라온다.
 */
function scaleOf(records: Record<string, unknown>): ScaleConfig | undefined {
  const doc = records['document:document']
  if (!isRecord(doc) || !isRecord(doc.meta)) return undefined
  const raw = doc.meta.scale
  if (!isRecord(raw)) return undefined
  const pxPerMm = typeof raw.pxPerMm === 'number' ? raw.pxPerMm : NaN
  if (!(pxPerMm > 0) || !Number.isFinite(pxPerMm)) return undefined
  const unit = raw.unit
  return {
    pxPerMm,
    unit: unit === 'cm' || unit === 'm' ? (unit as ScaleUnit) : 'mm',
  }
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
  const records: Record<string, unknown> = {}
  let skipped = 0

  if (!store) {
    return {
      version: BIMOVE_DOC_VERSION, pages, shapes, records,
      source: { from: 'tldraw', at: Date.now(), shapeCount: 0 }, skipped: 0,
    }
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
    if (typeName !== 'shape') {
      // **버리지 않는다.** asset 에 이미지 본문이, binding 에 화살표 연결이
      // 들어 있다. 무엇이 중요한지 미리 알 수 없으니 원형 그대로 들고 간다.
      // (camera·instance 처럼 안 쓸 것도 같이 오지만, 그 비용은 작고 유실은
      //  되돌릴 수 없다.)
      records[key] = rec
      continue
    }

    const type = str(rec.type)
    if (!type) { skipped++; continue }

    shapes.push({
      id: str(rec.id, key),
      type,
      x: num(rec.x),
      y: num(rec.y),
      rotation: num(rec.rotation),
      index: str(rec.index, 'a1'),
      parentId: str(rec.parentId),
      ...(typeof rec.opacity === 'number' ? { opacity: rec.opacity } : {}),
      ...(rec.isLocked === true ? { isLocked: true } : {}),
      props: isRecord(rec.props) ? rec.props : {},
      ...(isRecord(rec.meta) && Object.keys(rec.meta).length > 0 ? { meta: rec.meta } : {}),
    })
  }

  // 쌓임 순서를 고정해 둔다. 분수 인덱스는 **사전순**으로 비교한다 —
  // 숫자로 보면 'a2' 와 'a10' 이 뒤집힌다.
  shapes.sort((a, b) => (a.parentId === b.parentId
    ? (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)
    : (a.parentId < b.parentId ? -1 : 1)))
  pages.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))

  return {
    version: BIMOVE_DOC_VERSION,
    pages,
    shapes,
    records,
    scale: scaleOf(records),
    source: {
      from: 'tldraw',
      at: Date.now(),
      shapeCount: shapes.length,
    },
    skipped,
  }
}

/** 한 페이지의 도형만 (그룹 안에 든 것은 부모가 도형이라 여기 안 걸린다). */
export function shapesOfPage(doc: BimoveDocument, pageId: string): BimoveShape[] {
  return doc.shapes.filter(s => s.parentId === pageId)
}

/** 이 도면이 참조하는 asset 들 (이미지·PDF 본문). */
export function assetsOf(doc: BimoveDocument): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc.records)) {
    if (k.startsWith('asset:')) out[k] = v
  }
  return out
}

/** 타입별 개수 — 옮긴 뒤 "맞게 왔나" 를 눈으로 보는 용도. */
export function countByType(doc: BimoveDocument): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of doc.shapes) out[s.type] = (out[s.type] ?? 0) + 1
  return out
}
