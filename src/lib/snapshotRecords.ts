// 도면을 **레코드 단위**로 IndexedDB 에 저장한다.
//
// 왜 통짜 스냅샷이 아닌가. tldraw 는 변경이 생길 때마다 HistoryEntry.changes
// (RecordsDiff) 를 넘겨준다 — 무엇이 추가/수정/삭제됐는지 정확히 들어 있다.
// 그런데 지금까지 그걸 전부 버리고, 1.5초마다 editor.getSnapshot() 으로 도면
// 전체를 다시 만들어 통째로 썼다. 큰 DXF 는 dxfgroup 하나가 수 MB 짜리
// pathData 를 들고 있어서, 화면을 **스크롤만 해도** 그 몇 MB 가 1.5초마다
// 다시 디스크로 간다. IndexedDB 로 옮겨 용량 문제는 풀렸지만 쓰기량은 그대로다.
//
// 레코드 단위로 쪼개 두면 바뀐 것만 쓴다. 손대지 않은 dxfgroup 은 디스크에
// 그대로 누워 있는다.
//
// 키 배치 (전부 docrecords 스토어):
//   <projectId>/meta    → { schema, session }
//   <projectId>/r/<id>  → 레코드 하나
//
// 한 프로젝트의 키가 모두 "<projectId>/" 로 시작하므로 커서 한 번으로 읽고
// 범위 삭제 한 번으로 치운다. ('/meta' 가 '/r/' 보다 앞에 오지만 Map 으로
// 받으니 순서는 상관없다.)

import { idbBatch, idbGetRange, idbDeleteRange, type IdbOp } from './idb'

const STORE = 'docrecords' as const

const projectPrefix = (projectId: string) => `${projectId}/`
const recordPrefix = (projectId: string) => `${projectId}/r/`
const metaKey = (projectId: string) => `${projectId}/meta`

/** 레코드 바깥에 따로 보관하는 것. schema 는 마이그레이션에 필요하고,
 *  session 은 카메라/선택 상태다 (수백 바이트라 매번 통째로 덮어쓴다). */
export type RecordMeta = {
  schema: unknown
  session?: unknown
}

/** tldraw 의 TLEditorSnapshot 중 이 모듈이 실제로 쓰는 부분만. */
export type SnapshotLike = {
  document: { store: Record<string, unknown>; schema: unknown }
  session?: unknown
}

/**
 * 레코드들을 모아 스냅샷 하나로 되돌린다.
 *
 * null 이면 "이 프로젝트는 레코드로 저장된 적이 없다" 또는 "읽다가 실패했다"
 * 다 — 둘 다 호출부는 통짜 스냅샷/서버로 폴백하면 된다. 중요한 건 **반쪽짜리
 * 도면을 돌려주지 않는** 것이다. 그래서 meta 가 없으면 레코드가 몇 개 있든
 * 무효로 본다 (meta 와 레코드는 늘 같은 트랜잭션에서 쓰이므로, meta 가 없다는
 * 건 제대로 쓰인 적이 없다는 뜻이다).
 */
export async function readRecordSnapshot(projectId: string): Promise<SnapshotLike | null> {
  const rows = await idbGetRange<unknown>(STORE, projectPrefix(projectId))
  if (!rows) return null
  const meta = rows.get('meta') as RecordMeta | undefined
  if (!meta) return null

  const store: Record<string, unknown> = {}
  for (const [key, value] of rows) {
    if (key.startsWith('r/')) store[key.slice(2)] = value
  }
  if (Object.keys(store).length === 0) return null

  return { document: { store, schema: meta.schema }, session: meta.session }
}

/**
 * 도면 전체를 레코드로 펼쳐 쓴다. 기존 레코드는 **같은 트랜잭션에서** 지운다.
 *
 * 한 트랜잭션인 게 핵심이다. 지우기와 쓰기를 따로 하면 그 사이에 탭이 죽었을 때
 * 레코드가 반만 남는다. 지금은 실패하면 통째로 롤백돼서 옛 상태가 그대로 남는다.
 */
export async function writeFullRecords(projectId: string, snapshot: SnapshotLike): Promise<boolean> {
  const prefix = recordPrefix(projectId)
  const ops: IdbOp[] = [{ type: 'deleteRange', prefix: projectPrefix(projectId) }]
  for (const [id, record] of Object.entries(snapshot.document.store)) {
    ops.push({ type: 'put', key: prefix + id, value: record })
  }
  ops.push({
    type: 'put',
    key: metaKey(projectId),
    value: { schema: snapshot.document.schema, session: snapshot.session } satisfies RecordMeta,
  })
  return idbBatch(STORE, ops)
}

/**
 * 바뀐 레코드만 쓴다.
 *
 * puts — 추가되거나 수정된 레코드 (id → 최신 값)
 * dels — 삭제된 레코드 id
 */
export async function writeRecordDiff(
  projectId: string,
  puts: Map<string, unknown>,
  dels: Set<string>,
  meta: RecordMeta,
): Promise<boolean> {
  const prefix = recordPrefix(projectId)
  const ops: IdbOp[] = []
  for (const id of dels) ops.push({ type: 'delete', key: prefix + id })
  for (const [id, record] of puts) ops.push({ type: 'put', key: prefix + id, value: record })
  // meta 는 항상 같이 쓴다. session(카메라) 은 거의 매번 바뀌고, 무엇보다
  // "meta 가 있으면 유효한 캐시" 라는 readRecordSnapshot 의 규약을 유지해야 한다.
  ops.push({ type: 'put', key: metaKey(projectId), value: meta })
  return idbBatch(STORE, ops)
}

/** 프로젝트의 레코드 전부 삭제 (프로젝트를 지울 때). */
export async function deleteRecords(projectId: string): Promise<boolean> {
  return idbDeleteRange(STORE, projectPrefix(projectId))
}
