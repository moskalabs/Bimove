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
const versionsKey = (projectId: string) => `bimove_versions_${projectId}`

function readList(projectId: string): Version[] {
  try {
    const raw = scopedGet(versionsKey(projectId))
    return raw ? (JSON.parse(raw) as Version[]) : []
  } catch {
    return []
  }
}

function writeList(projectId: string, list: Version[]) {
  try {
    scopedSet(versionsKey(projectId), JSON.stringify(list))
  } catch (err) {
    console.warn('[versions] storage full — pruning oldest', err)
    // 절반 정도 줄여서 재시도
    const pruned = list.slice(0, Math.floor(list.length / 2))
    try { scopedSet(versionsKey(projectId), JSON.stringify(pruned)) } catch { /* give up */ }
  }
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
