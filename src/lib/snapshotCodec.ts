// 스냅샷을 DB 에 넣는 형태로 바꾸는 코덱.
//
// 예전에는 tldraw 스냅샷(수 MB JSON)을 `projects.snapshot` jsonb 컬럼에 5초마다
// 그대로 넣었다. jsonb 는 들어올 때마다 **파싱하고 TOAST 로 압축**하는데, 수 MB
// 짜리를 그 주기로 받으면 작은 인스턴스는 CPU 가 버티지 못한다. 실제로
// t4g.nano 가 CPU 94% 로 묶여 쿼리가 전부 504 로 떨어졌다.
//
// 그래서 클라이언트에서 gzip 으로 줄여 **text 컬럼**에 넣는다. 서버는 글자를
// 그대로 받아 적기만 하므로 파싱 비용이 0 이고, 크기도 1/10 쯤으로 준다.
//
// 읽기는 두 형태를 다 받는다. 이미 저장된 프로젝트가 많아서, 배포하자마자
// 옛 데이터를 못 읽으면 도면이 통째로 사라진 것처럼 보인다.

import { gzipText, gunzipText, bytesToBase64, base64ToBytes } from './gzip'

/**
 * 압축을 풀었을 때 허용하는 최대 바이트.
 *
 * 우리가 만든 데이터라 공격을 걱정하는 자리는 아니지만, 손상된 행 하나가
 * 탭을 죽이는 건 막는다. 큰 도면 스냅샷이 수십 MB 까지 가므로 넉넉히 잡는다.
 */
const MAX_INFLATED_BYTES = 256 * 1024 * 1024

/** 스냅샷 → DB 에 넣을 문자열 (gzip + base64). */
export async function encodeSnapshot(snapshot: unknown): Promise<string> {
  return bytesToBase64(await gzipText(JSON.stringify(snapshot)))
}

/** DB 에서 읽은 문자열 → 스냅샷. */
export async function decodeSnapshot(encoded: string): Promise<unknown> {
  return JSON.parse(await gunzipText(base64ToBytes(encoded), MAX_INFLATED_BYTES))
}

/**
 * 행에서 스냅샷을 꺼낸다 — 압축본이 있으면 그걸, 없으면 옛 jsonb 컬럼을.
 *
 * 둘 다 비어 있으면 null. "스냅샷이 아직 없는 프로젝트" 와 "읽기 실패" 를
 * 구분하지 않는 건 호출부가 어차피 같게 다루기 때문이다 — 로컬 저장본으로
 * 떨어진다 (App.tsx 의 resolveSnapshot).
 */
export async function readSnapshotColumn(
  row: { snapshot?: unknown; snapshot_gz?: string | null } | null,
): Promise<unknown> {
  if (!row) return null
  if (row.snapshot_gz) return decodeSnapshot(row.snapshot_gz)
  return row.snapshot ?? null
}
