// 로컬 + 서버 버전 병합.
//
// 버전은 두 곳에 쌓인다 — localStorage(versions.ts)와 Supabase의
// project_versions. 예전엔 패널이 로컬만 읽어서, 기기를 바꾸거나 캐시를
// 지우면 서버에 멀쩡히 남아 있는 버전이 하나도 보이지 않았다.
// (서버 쪽 함수는 아무도 부르지 않는 죽은 코드였다.)
//
// supabase를 직접 import 하지 않고 deps로 받는다 — conflictBackup.ts 와
// 같은 이유로, 네트워크 없이 병합 규칙만 테스트할 수 있어야 한다.

import type { Version } from './versions'

export type MergedVersion = {
  id: string
  timestamp: number
  label?: string
  /**
   * 로컬에 있으면 스냅샷이 들어있다. 서버에만 있으면 null —
   * 복원하거나 비교할 때 그때 받아온다.
   */
  snapshot: object | null
  local: boolean
  remote: boolean
}

export interface VersionSyncDeps {
  listLocal: (projectId: string) => Version[]
  fetchRemoteMetas: (projectId: string) => Promise<{ id: string; timestamp: number; label?: string }[]>
}

export type MergeResult = {
  versions: MergedVersion[]
  /** null 이 아니면 서버 목록을 못 받았다 — 로컬만 보여주고 있다는 뜻 */
  remoteError: string | null
}

/**
 * 로컬과 서버 버전을 id 기준으로 합친다 (최신순).
 *
 * 같은 id 가 양쪽에 있으면 로컬 쪽을 쓴다 — 스냅샷이 이미 손에 있고,
 * 라벨도 방금 로컬에서 고쳤을 가능성이 높다. (이름 변경은 양쪽에 같이
 * 쓰므로, 갈리는 건 오프라인에서 고쳤을 때뿐이다.)
 *
 * 서버 조회가 실패해도 로컬 목록은 그대로 돌려준다 — 네트워크가 끊겼다고
 * 버전 기록이 빈 화면으로 보이면 안 된다.
 */
export async function listMergedVersions(
  projectId: string,
  deps: VersionSyncDeps,
): Promise<MergeResult> {
  const byId = new Map<string, MergedVersion>()

  for (const v of deps.listLocal(projectId)) {
    if (!Number.isFinite(v.timestamp)) continue
    byId.set(v.id, {
      id: v.id,
      timestamp: v.timestamp,
      label: v.label,
      snapshot: v.snapshot,
      local: true,
      remote: false,
    })
  }

  let remoteError: string | null = null
  try {
    for (const m of await deps.fetchRemoteMetas(projectId)) {
      // created_at 이 깨져 있으면 timestamp 가 NaN 이다 — 정렬이 무너지고
      // 화면에는 "Invalid Date" 가 찍힌다. 아예 빼는 쪽이 낫다.
      if (!Number.isFinite(m.timestamp)) continue
      const hit = byId.get(m.id)
      if (hit) { hit.remote = true; continue }
      byId.set(m.id, {
        id: m.id,
        timestamp: m.timestamp,
        label: m.label,
        snapshot: null,
        local: false,
        remote: true,
      })
    }
  } catch (err) {
    remoteError = err instanceof Error ? err.message : String(err)
    console.warn('[versionSync] 서버 버전 목록 조회 실패', err)
  }

  return {
    versions: [...byId.values()].sort((a, b) => b.timestamp - a.timestamp),
    remoteError,
  }
}

/**
 * 로컬에 저장한 버전을 서버에도 올린다 (fire-and-forget).
 *
 * 실패해도 throw 하지 않는다 — 버전은 이미 로컬에 남았고, 자동 저장이
 * 5분마다 도는데 그때마다 토스트를 띄울 일은 아니다. 다만 조용히 넘기지는
 * 않고 false 로 알려준다.
 */
export async function pushVersion(
  projectId: string,
  version: Version,
  insertRemote: (projectId: string, version: Version) => Promise<void>,
): Promise<boolean> {
  try {
    await insertRemote(projectId, version)
    return true
  } catch (err) {
    console.warn('[versionSync] 서버 버전 저장 실패 — 로컬에만 남는다', err)
    return false
  }
}
