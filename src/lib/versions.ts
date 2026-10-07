// 프로젝트 버전 히스토리 — localStorage에 timestamped snapshot 보관.
// 명시적 저장 + 자동 주기 저장 둘 다 지원. 최대 N개 유지.

import { scopedGet, scopedSet, scopedRemove } from './scopedStorage'

export type Version = {
  id: string
  timestamp: number
  label?: string         // 사용자 메모 (선택)
  snapshot: object       // tldraw store snapshot
}

const MAX_VERSIONS = 30
const versionsKey = (projectId: string) => `bimova_versions_${projectId}`

function readList(projectId: string): Version[] {
  try {
    const raw = scopedGet(versionsKey(projectId))
    return raw ? (JSON.parse(raw) as Version[]) : []
  } catch {
    return []
  }
}

function writeList(projectId: string, list: Version[]): boolean {
  const key = versionsKey(projectId)
  // scopedSet 은 quota 초과를 예외로 올리지 않고 false 를 돌려준다.
  // 전엔 try/catch 로 받으려 해서 가지치기가 한 번도 안 돌았다 — 용량이 차면
  // 그 뒤로 버전이 조용히 하나도 안 쌓였다.
  //
  // 들어갈 때까지 절반씩 줄인다. 오래된 쪽을 버리고 최신을 지킨다.
  let keep = list.length
  while (keep > 0) {
    if (scopedSet(key, JSON.stringify(list.slice(0, keep)))) {
      if (keep < list.length) {
        console.warn(`[versions] 저장 공간 부족 — ${list.length}개 중 최신 ${keep}개만 남겼다`)
      }
      return true
    }
    keep = Math.floor(keep / 2)
  }
  // 한 개도 안 들어간다 (대형 CAD 스냅샷 하나가 quota 보다 크다).
  // 낡은 목록을 들고 있을 이유가 없으니 비워서 다음을 위한 여유라도 만든다.
  scopedRemove(key)
  console.warn(`[versions] 스냅샷 하나도 들어가지 않는다 — 버전 기록을 비웠다 (${projectId})`)
  return false
}

/** 새 버전 저장. 최신이 0번 인덱스. MAX 초과시 오래된 거 자동 제거. */
export function saveVersion(projectId: string, snapshot: object, label?: string): Version {
  const version: Version = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    label: label?.trim() || undefined,
    snapshot,
  }
  const list = readList(projectId)
  list.unshift(version)
  if (list.length > MAX_VERSIONS) list.length = MAX_VERSIONS
  writeList(projectId, list)
  return version
}

/** 전체 버전 목록 (최신순). */
export function listVersions(projectId: string): Version[] {
  return readList(projectId)
}

/** 특정 버전 가져오기. */
export function getVersion(projectId: string, versionId: string): Version | null {
  return readList(projectId).find(v => v.id === versionId) ?? null
}

/** 특정 버전 삭제. */
export function deleteVersion(projectId: string, versionId: string) {
  const list = readList(projectId).filter(v => v.id !== versionId)
  writeList(projectId, list)
}

/** 모든 버전 삭제 (프로젝트 삭제 시 호출). */
export function clearVersions(projectId: string) {
  scopedRemove(versionsKey(projectId))
}

/** 버전 라벨 변경. */
export function renameVersion(projectId: string, versionId: string, label: string) {
  const list = readList(projectId).map(v =>
    v.id === versionId ? { ...v, label: label.trim() || undefined } : v
  )
  writeList(projectId, list)
}
