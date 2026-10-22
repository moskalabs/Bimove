// 옛 tldraw `comment` 도형을 문서 meta 글타래로 옮긴다.
//
// ── 왜 필요한가 ──
//
// 코멘트가 두 벌 있었다. 하나는 tldraw 도형(`shapes/CommentShape.tsx` +
// `tools/CommentTool.ts`), 하나는 문서 meta(`commentStore.ts`). 도형 쪽은
// **툴바에 버튼이 없어서** 켤 수가 없었지만, 코드는 `SHAPE_UTILS` 에 등록돼
// 있었고 RBar 에 속성 패널까지 붙어 있었다.
//
// 그걸 지우는 게 이 변경인데, **그냥 지우면 안 된다.** 저장된 도면에
// `type: 'comment'` 인 도형이 하나라도 있으면 tldraw 가 모르는 타입이라며
// `loadSnapshot` 을 거부한다. App.tsx 는 후보(서버/로컬/예비)를 차례로
// 시도하는데 **전부 같은 이유로 실패**하므로, 그 프로젝트는 영영 안 열린다.
//
// 그래서 **tldraw 가 보기 전에** 스냅샷에서 빼내 meta 로 옮긴다. 도형이
// 없으면 아무 일도 안 한다 (대부분 그럴 것이다 — 켤 방법이 없었으니까).
//
// ── 언제 지울 수 있나 ──
//
// 이 파일은 **없어지는 게 목표다.** 다만 "모든 저장본이 한 번은 열렸다" 를
// 확인할 방법이 없으므로(오프라인 기기의 IndexedDB 사본, 옛 버전 기록,
// 공유 링크에 담긴 스냅샷) 당분간 둔다. 비용은 로드 한 번당 레코드 훑기
// 한 번이다.

import type { CommentThread } from './commentStore'

/**
 * 옛 도형의 **가리키던 자리**를 되찾는 보정값.
 *
 * `CommentTool` 은 클릭 지점에서 `(x - 16, y - 42)` 에 도형을 만들었다
 * (말풍선 꼬리 끝이 그 점에 오도록). 되돌리려면 그대로 더해 준다.
 */
const ANCHOR_DX = 16
const ANCHOR_DY = 42

export type MigrationResult = {
  /** 바뀐 스냅샷. 옮길 게 없으면 **원본 그대로**를 돌려준다. */
  snapshot: unknown
  /** 글타래로 옮긴 수 */
  moved: number
  /** 글이 비어 있어 버린 수 — 만들기만 하고 안 쓴 핀이다 */
  dropped: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 스냅샷에서 레코드 맵이 어디 있는지 — `bimoveDoc.storeOf` 와 같은 규칙. */
function storePath(snapshot: unknown): 'document' | 'store' | null {
  if (!isRecord(snapshot)) return null
  const doc = snapshot.document
  if (isRecord(doc) && isRecord(doc.store)) return 'document'
  if (isRecord(snapshot.store)) return 'store'
  return null
}

function storeOf(snapshot: Record<string, unknown>, path: 'document' | 'store'): Record<string, unknown> {
  return path === 'document'
    ? ((snapshot.document as Record<string, unknown>).store as Record<string, unknown>)
    : (snapshot.store as Record<string, unknown>)
}

/**
 * `comment` 도형을 문서 meta 로 옮기고 스냅샷에서 뺀다.
 *
 * **원본을 바꾸지 않는다.** App.tsx 는 후보를 차례로 시도하므로, 앞 후보를
 * 건드리면 뒤 후보까지 오염된다.
 */
export function migrateCommentShapes(snapshot: unknown): MigrationResult {
  const path = storePath(snapshot)
  if (!path || !isRecord(snapshot)) return { snapshot, moved: 0, dropped: 0 }

  const store = storeOf(snapshot, path)
  const victims: string[] = []
  for (const [key, rec] of Object.entries(store)) {
    if (isRecord(rec) && rec.type === 'comment' && (rec.typeName === 'shape' || key.startsWith('shape:'))) {
      victims.push(key)
    }
  }
  if (victims.length === 0) return { snapshot, moved: 0, dropped: 0 }

  const docRec = store['document:document']
  const existing = isRecord(docRec) && isRecord(docRec.meta) && Array.isArray(docRec.meta.comments)
    ? (docRec.meta.comments as unknown[])
    : []

  const threads: CommentThread[] = []
  let dropped = 0
  for (const key of victims) {
    const rec = store[key] as Record<string, unknown>
    const props = isRecord(rec.props) ? rec.props : {}
    const text = str(props.text).trim()
    if (!text) {
      // 만들기만 하고 글은 안 쓴 핀. 빈 글타래는 글타래가 아니다
      // (commentStore 의 `cleanThread` 와 같은 판단).
      dropped++
      continue
    }
    const parent = str(rec.parentId)
    threads.push({
      id: str(rec.id) || key,
      // 도형의 부모가 페이지면 그 장의 것이다. 그룹 안에 있었다면 어느
      // 장인지 알 수 없으므로 비워 둔다 — 그건 **첫 장**으로 간다
      // (commentStore 의 `threadsOnPage`).
      pageId: parent.startsWith('page:') ? parent : '',
      x: num(rec.x) + ANCHOR_DX,
      y: num(rec.y) + ANCHOR_DY,
      resolved: props.resolved === true,
      messages: [{
        id: `${str(rec.id) || key}:m`,
        author: str(props.author) || '익명',
        text,
        // 옛 도형은 시각을 안 들고 있었다. 지어내지 않는다 — 0 은 "모름"
        // 이고, 화면은 그걸 빈칸으로 그린다 (`formatWhen`).
        ts: 0,
      }],
    })
  }

  const nextStore: Record<string, unknown> = {}
  for (const [key, rec] of Object.entries(store)) {
    if (victims.includes(key)) continue
    nextStore[key] = rec
  }
  nextStore['document:document'] = {
    ...(isRecord(docRec) ? docRec : { id: 'document:document', typeName: 'document', gridSize: 10, name: '' }),
    meta: {
      ...(isRecord(docRec) && isRecord(docRec.meta) ? docRec.meta : {}),
      comments: [...existing, ...threads],
    },
  }

  const next = path === 'document'
    ? { ...snapshot, document: { ...(snapshot.document as Record<string, unknown>), store: nextStore } }
    : { ...snapshot, store: nextStore }

  return { snapshot: next, moved: threads.length, dropped }
}
