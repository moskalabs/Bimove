// 도면 위 코멘트 — 핀 하나에 글타래 하나.
//
// ── 왜 도형이 아닌가 ──
//
// 벽·공간·치수처럼 tldraw 도형으로 만들 수도 있었다. 셋 다 안 되는 이유가
// 있어서 **문서 meta** 에 둔다 (축척과 같은 칸, docMeta.ts).
//
//  - 도형이면 **내보내기에 섞인다.** DXF·PNG·리포트는 페이지 도형을 훑어
//    만든다. 현장에 넘기는 도면에 "여기 치수 확인해 주세요" 가 찍혀 나가면
//    안 된다. 내보내기마다 "코멘트는 빼고" 를 기억해 붙이는 건 언젠가 빠진다.
//  - 도형이면 **Ctrl+A → Delete 에 같이 지워진다.** 코멘트는 도면이 아니라
//    도면에 **관한 말**이라, 도면을 고치는 손놀림에 쓸려서는 안 된다.
//  - tldraw 를 걷어내는 중이다 (bimoveDoc.ts 머리말). 도형을 하나 더 만들면
//    엔진으로 옮길 것이 하나 더 는다. meta 는 이미 통째로 실려 간다.
//
// 저장·서버 동기화·버전 기록·공유 링크는 전부 공짜로 따라온다 —
// `document:document` 은 document 스코프 레코드라 App.tsx 의 저장 구독에
// 그대로 걸린다.
//
// ── 읽는 값을 믿지 않는다 ──
//
// 이 값은 공유 링크(URL hash)를 타고 들어올 수 있다. shareLink.ts 가 그
// 입력을 **신뢰할 수 없는 것**으로 다루는 것과 같은 이유로, 여기서도 모양과
// 개수를 확인하고 자른다. 모양이 틀린 글타래는 통째로 버리는 게 아니라
// **그것만** 버린다 — 하나가 깨졌다고 나머지 코멘트를 잃을 이유가 없다.

import type { Editor } from 'tldraw'
import { readDocMeta, writeDocMeta } from './docMeta'
import { scopedGet, scopedSet } from './scopedStorage'
import { CHAT_AUTHOR_KEY } from './chatStore'

const DOC_META_KEY = 'comments'

export type CommentMessage = {
  id: string
  author: string
  text: string
  /** epoch ms */
  ts: number
}

export type CommentThread = {
  id: string
  /**
   * **어느 장(page)에 달린 것인가.**
   *
   * 도면은 여러 장일 수 있다 (배치 패널에서 장을 만들고 넘긴다). 자리만
   * 적어두면 1장에 꽂은 핀이 2장에도 같은 좌표에 뜬다 — 같은 코멘트가 장마다
   * 복제돼 보이고, 어느 장 이야기인지 알 수가 없다.
   *
   * 이 칸이 생기기 전에 달린 글타래는 빈 문자열이다. 그건 **첫 장**의 것으로
   * 친다 (`threadsOnPage`) — 모든 장에 띄우면 복제가 되고, 아무 데도 안 띄우면
   * 쓴 글이 사라진 것처럼 보인다.
   */
  pageId: string
  /** 핀이 꽂힌 자리 — **page 좌표**다. 화면 좌표로 두면 확대만 해도 어긋난다. */
  x: number
  y: number
  resolved: boolean
  /** 첫 글이 원글, 나머지가 답글. 빈 글타래는 만들지 않는다. */
  messages: CommentMessage[]
}

/**
 * 상한들.
 *
 * meta 는 도면 스냅샷에 통째로 실려 서버로도 가고 **공유 링크 URL 에도**
 * 들어간다. 코멘트가 도면 본문보다 커지는 일은 없어야 한다. 넘으면 조용히
 * 자르는 게 아니라 **더 못 달게** 막는다 — 쓴 글이 사라지는 쪽이 더 나쁘다.
 */
export const MAX_THREADS = 500
export const MAX_MESSAGES_PER_THREAD = 200
export const MAX_TEXT = 2000
const MAX_AUTHOR = 60

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * `at` 은 **읽기를 순수하게** 만들려고 받는다.
 *
 * 전엔 id 가 없으면 `newId()` 를 불렀다. 그러면 같은 문서를 두 번 읽을 때
 * 값이 달라진다 — React 키가 매번 바뀌어 줄이 통째로 다시 그려지고, 열어 둔
 * 글타래는 재읽기 한 번에 `openId` 가 가리킬 데를 잃는다. 자리에서 뽑으면
 * 몇 번을 읽어도 같은 값이다.
 */
function cleanMessage(raw: unknown, at: string): CommentMessage | null {
  if (!isRecord(raw)) return null
  const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT) : ''
  if (!text.trim()) return null
  const ts = finite(raw.ts)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : at,
    author: (typeof raw.author === 'string' ? raw.author : '').slice(0, MAX_AUTHOR) || '익명',
    text,
    // 시각이 없으면 **0** 이다. 지금 시각을 넣으면 옛 코멘트가 전부 "방금"
    // 으로 보인다 — 없는 걸 그럴듯하게 지어내는 쪽이 더 나쁘다.
    ts: ts !== null ? ts : 0,
  }
}

function cleanThread(raw: unknown, at: number): CommentThread | null {
  if (!isRecord(raw)) return null
  const x = finite(raw.x)
  const y = finite(raw.y)
  // 자리가 없으면 핀을 찍을 데가 없다. 화면 어딘가에 NaN 으로 떠 있는 것보다
  // 없는 편이 낫다.
  if (x === null || y === null) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id : `c${at}`
  const messages = (Array.isArray(raw.messages) ? raw.messages : [])
    .map((m, i) => cleanMessage(m, `${id}:m${i}`))
    .filter((m): m is CommentMessage => m !== null)
    .slice(0, MAX_MESSAGES_PER_THREAD)
  if (messages.length === 0) return null
  return {
    id,
    pageId: typeof raw.pageId === 'string' ? raw.pageId : '',
    x,
    y,
    resolved: raw.resolved === true,
    messages,
  }
}

/** crypto.randomUUID 가 없는 환경(옛 사파리·일부 테스트 목)도 있다. */
function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  }
}

/**
 * 문서 meta 한 칸에서 글타래를 꺼낸다 — **에디터가 없어도 된다.**
 *
 * tldraw 를 걷어내는 중이라(bimoveDoc.ts 머리말) 읽는 쪽이 둘이 된다:
 * 지금 화면은 `Editor` 를 들고 있고, 엔진 경로는 `BimoveDocument` 만 있다.
 * 거르는 규칙은 **하나**여야 하므로 meta 를 받는 이쪽을 바닥에 두고,
 * 에디터 쪽은 얇게 감싸기만 한다.
 */
export function threadsFromMeta(meta: Record<string, unknown> | undefined | null): CommentThread[] {
  const raw = meta?.[DOC_META_KEY]
  if (!Array.isArray(raw)) return []
  return raw
    .map((t, i) => cleanThread(t, i))
    .filter((t): t is CommentThread => t !== null)
    .slice(0, MAX_THREADS)
}

/**
 * 그 meta 에서 **한 장**의 것만. 장이 안 적힌 옛 글타래는 첫 장으로 간다
 * (CommentThread.pageId 주석).
 *
 * `pageId` 가 비면 거르지 않는다 — 장 개념이 없는 쪽(얕은 목, DXF 로 연
 * 도면)에서는 전부 보여주는 게 맞다.
 */
export function threadsOnPageOf(
  meta: Record<string, unknown> | undefined | null,
  pageId: string,
  firstPageId: string,
): CommentThread[] {
  const all = threadsFromMeta(meta)
  if (!pageId) return all
  return all.filter(t => (t.pageId ? t.pageId === pageId : pageId === firstPageId))
}

export function getThreads(editor: Editor): CommentThread[] {
  return threadsFromMeta(readDocMeta(editor))
}

/**
 * **지금 보고 있는 장**에 달린 글타래만.
 *
 * 화면(핀·목록·배지)은 전부 이쪽을 쓴다. 다른 장의 핀을 지금 장에 띄우면
 * 도면과 상관없는 자리에 핀이 꽂혀 있는 꼴이 된다.
 *
 * 장이 없는 옛 글타래는 **첫 장**의 것으로 친다 (CommentThread.pageId 주석).
 */
export function threadsOnPage(editor: Editor): CommentThread[] {
  let pageId = ''
  let firstId = ''
  try {
    pageId = editor.getCurrentPageId?.() ?? ''
    firstId = editor.getPages?.()[0]?.id ?? ''
  } catch { /* 목이 얕은 에디터 — 그러면 전부 보여준다 */ }
  return threadsOnPageOf(readDocMeta(editor), pageId, firstId)
}

/**
 * 날것 그대로의 코멘트 칸. **바뀌었는지만** 보려는 쪽을 위한 것이다.
 *
 * 화면은 store 가 울릴 때마다 (카메라를 조금만 움직여도) 다시 읽는데, 매번
 * 500 개를 훑어 거르면 팬이 뻑뻑해진다. 참조가 그대로면 거를 것도 없다.
 */
export function rawThreads(editor: Editor): unknown {
  return readDocMeta(editor)[DOC_META_KEY]
}

function save(editor: Editor, threads: CommentThread[]): void {
  writeDocMeta(editor, DOC_META_KEY, threads)
}

/** 글쓴이 이름 — 로그인 이름이 먼저, 없으면 현장 메모에 쓰던 그 이름. */
export function authorName(displayName?: string | null): string {
  const fromAuth = (displayName ?? '').trim()
  if (fromAuth) return fromAuth.slice(0, MAX_AUTHOR)
  const saved = (scopedGet(CHAT_AUTHOR_KEY) ?? '').trim()
  return saved ? saved.slice(0, MAX_AUTHOR) : '익명'
}

/** 로그인 이름이 없을 때 쓸 이름을 기억해 둔다 (현장 메모와 같은 칸). */
export function rememberAuthor(name: string): void {
  const n = name.trim().slice(0, MAX_AUTHOR)
  if (n) scopedSet(CHAT_AUTHOR_KEY, n)
}

export class CommentLimitError extends Error {}

/**
 * 핀을 하나 찍는다. 돌려주는 건 만들어진 글타래.
 *
 * @throws {CommentLimitError} 글타래가 상한에 닿았을 때
 */
export function addThread(
  editor: Editor,
  at: { x: number; y: number },
  author: string,
  text: string,
): CommentThread {
  const threads = getThreads(editor)
  if (threads.length >= MAX_THREADS) {
    throw new CommentLimitError(`코멘트는 ${MAX_THREADS}개까지 달 수 있습니다`)
  }
  let pageId = ''
  try { pageId = editor.getCurrentPageId?.() ?? '' } catch { /* 얕은 목 */ }
  const thread: CommentThread = {
    id: newId(),
    pageId,
    x: at.x,
    y: at.y,
    resolved: false,
    messages: [{ id: newId(), author, text: text.slice(0, MAX_TEXT), ts: Date.now() }],
  }
  save(editor, [...threads, thread])
  return thread
}

/**
 * 답글. 없는 글타래면 아무 일도 안 한다.
 *
 * @throws {CommentLimitError} 그 글타래가 상한에 닿았을 때
 */
export function addReply(editor: Editor, threadId: string, author: string, text: string): void {
  const threads = getThreads(editor)
  const target = threads.find(t => t.id === threadId)
  if (!target) return
  if (target.messages.length >= MAX_MESSAGES_PER_THREAD) {
    throw new CommentLimitError(`한 코멘트에 답글은 ${MAX_MESSAGES_PER_THREAD}개까지입니다`)
  }
  const msg: CommentMessage = { id: newId(), author, text: text.slice(0, MAX_TEXT), ts: Date.now() }
  save(editor, threads.map(t => (t.id === threadId ? { ...t, messages: [...t.messages, msg] } : t)))
}

export function setResolved(editor: Editor, threadId: string, resolved: boolean): void {
  save(editor, getThreads(editor).map(t => (t.id === threadId ? { ...t, resolved } : t)))
}

/** 핀을 끌어 옮긴다 (page 좌표). */
export function moveThread(editor: Editor, threadId: string, to: { x: number; y: number }): void {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return
  save(editor, getThreads(editor).map(t => (t.id === threadId ? { ...t, x: to.x, y: to.y } : t)))
}

export function deleteThread(editor: Editor, threadId: string): void {
  save(editor, getThreads(editor).filter(t => t.id !== threadId))
}

/** 아직 해결되지 않은 글타래 수 — 레일 아이콘의 배지용. */
export function unresolvedCount(threads: CommentThread[]): number {
  return threads.reduce((n, t) => n + (t.resolved ? 0 : 1), 0)
}

// ── 보여주는 쪽이 같이 쓰는 것들 ──
//
// 핀(CommentOverlay)과 목록(CommentsPanel)이 **같은 사람을 같은 색·같은 글자**
// 로 그려야 한다. 양쪽에 따로 적어두면 언젠가 한쪽만 바뀌어 목록과 도면의
// 동그라미 색이 달라진다. 그래서 여기 한 벌만 둔다.

/** 이름에서 동그라미에 넣을 글자 하나. */
export function initialOf(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}

/**
 * 해결된 글타래의 회색.
 *
 * `#c7cbd1` 이었는데 **흰 ✓ 가 안 보였다** — 흐리게(0.62) 깔린 위에 흰 글자라
 * 동그라미가 비어 보인다. 글자가 읽힐 만큼 어둡게 내린다.
 */
export const RESOLVED_COLOR = '#7e858f'

/** 이름마다 고정된 색 — 같은 사람은 늘 같은 동그라미다. */
export function pinColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return `hsl(${((h % 360) + 360) % 360}, 62%, 48%)`
}

/**
 * "방금 / 12분 전 / 3시간 전 / 10. 21."
 *
 * 시각이 없는(0) 옛 글은 **빈 문자열**이다. 1970년을 보여주거나 "방금" 이라고
 * 지어내는 쪽이 아무것도 안 쓰는 것보다 나쁘다.
 */
export function formatWhen(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '방금'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
}
