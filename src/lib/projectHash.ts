// 지금 열어둔 프로젝트를 URL 에 남긴다 — `#project=<id>`.
//
// 전엔 **쓰기만 했다.** 주소창에는 id 가 보이는데 읽는 데가 없어서, 새로고침
// 하면 대시보드로 떨어졌다. 작업하다 F5 한 번에 목록으로 튕기고, 그 주소를
// 복사해 보내도 받는 쪽은 목록만 봤다.
//
// hash 를 쓰는 이유는 정적 호스팅(Vercel)이라 `/project/<id>` 같은 경로를
// 받아줄 서버 라우팅이 없기 때문이다. hash 는 서버에 가지 않는다.
//
// 공유 링크(`#share=`)와 한 자리를 쓰므로 **접두사를 엄격하게** 본다.

/** `#project=` 뒤에 올 수 있는 건 UUID 뿐이다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PREFIX = '#project='

/**
 * URL 에 실린 프로젝트 id. 없거나 형식이 아니면 null.
 *
 * 모양을 걸러내는 건 멋이 아니다 — 이 값은 Supabase 쿼리(`id` 가 uuid 컬럼)와
 * localStorage·IndexedDB 키로 그대로 들어간다. 주소창에 손으로 쓴 쓰레기가
 * 거기까지 가면 Postgres 가 타입 에러를 던지고, 로컬엔 아무도 못 찾는
 * 항목이 남는다.
 */
export function readProjectHash(): string | null {
  const hash = window.location.hash
  if (!hash.startsWith(PREFIX)) return null
  const id = hash.slice(PREFIX.length)
  return UUID_RE.test(id) ? id : null
}

/** 프로젝트를 **열었다** — 뒤로가기로 목록에 돌아올 수 있게 쌓는다. */
export function pushProjectHash(id: string): void {
  history.pushState({ view: 'editor', id }, '', `${PREFIX}${id}`)
}

/**
 * 새로고침으로 **되살렸다** — 쌓지 않고 지금 항목을 덮어쓴다.
 *
 * 여기서 push 를 하면 이미 그 주소에 서 있는데 항목이 하나 더 생겨서,
 * 뒤로가기를 두 번 눌러야 목록으로 나간다.
 */
export function replaceProjectHash(id: string): void {
  history.replaceState({ view: 'editor', id }, '', `${PREFIX}${id}`)
}

/** 프로젝트 hash 만 치운다 (`#share=` 같은 남의 hash 는 건드리지 않는다). */
export function clearProjectHash(): void {
  if (!window.location.hash.startsWith(PREFIX)) return
  history.replaceState(null, '', window.location.pathname + window.location.search)
}
