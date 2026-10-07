// 프로젝트 버전 히스토리 — IndexedDB 에 timestamped snapshot 보관.
// 명시적 저장 + 자동 주기 저장 둘 다 지원. 최대 N개 유지.
//
// 전엔 localStorage 에 **버전 30개를 한 JSON 배열**로 묶어서 넣었다. 문제가 둘.
//
//  1. 용량. origin 당 5MB 인데 CAD 스냅샷 하나가 수 MB 다. 30개는 애초에
//     들어갈 수가 없었고, 실제로 한의 도면에서 QuotaExceededError 가 났다.
//  2. 쓰기 비용. 버전 하나를 더하려고 **30개 전부를 다시 직렬화해서 통째로**
//     다시 썼다. 그걸 자동저장마다 메인 스레드에서 동기로.
//
// 이제 레코드를 둘로 나눈다:
//
//   key `${projectId}`               → VersionMeta[] (id/시각/라벨만, 최신순)
//   key `${projectId}:${versionId}`  → 스냅샷 본문
//
// 목록은 작은 메타 한 번만 읽으면 되고(패널 열 때 수십 MB 파싱이 사라진다),
// 추가는 본문 하나 + 메타 하나만 쓴다.

import { scopedGet, scopedRemove } from './scopedStorage'
import { idbGet, idbSet, idbDelete, requestPersistentStorage } from './idb'

/** 버전 목록 항목 — 스냅샷 본문은 들어있지 않다. */
export type VersionMeta = {
  id: string
  timestamp: number
  label?: string         // 사용자 메모 (선택)
}

export type Version = VersionMeta & {
  snapshot: object       // tldraw store snapshot
}

const MAX_VERSIONS = 30

/** 레거시 localStorage 키 — 마이그레이션에서만 읽는다. */
const legacyKey = (projectId: string) => `bimova_versions_${projectId}`

const metaKey = (projectId: string) => projectId
const bodyKey = (projectId: string, versionId: string) => `${projectId}:${versionId}`

// ── 레거시 마이그레이션 ──

/** 이번 세션에 마이그레이션을 이미 시도한 프로젝트. 두 번 읽지 않기 위한 것뿐이다. */
const migrated = new Set<string>()

/**
 * localStorage 에 남아 있는 옛 버전 목록을 IndexedDB 로 옮긴다.
 *
 * 순서가 중요하다 — **복사 → 확인 → 그 다음에만 삭제**. 중간에 실패하면
 * localStorage 쪽을 그대로 두고 다음 기회에 다시 시도한다. 반대로 하면
 * 옮기다 만 상태에서 기록이 통째로 사라진다.
 */
async function migrateLegacy(projectId: string): Promise<VersionMeta[] | null> {
  if (migrated.has(projectId)) return null
  migrated.add(projectId)

  const raw = scopedGet(legacyKey(projectId))
  if (!raw) return null

  let list: Version[]
  try {
    list = JSON.parse(raw) as Version[]
  } catch {
    // 깨진 JSON 은 되살릴 방법이 없다. 자리만 차지하므로 치운다.
    console.warn(`[versions] 옛 기록이 깨져 있어 버린다 (${projectId})`)
    scopedRemove(legacyKey(projectId))
    return null
  }
  if (!Array.isArray(list) || list.length === 0) {
    scopedRemove(legacyKey(projectId))
    return null
  }

  const metas: VersionMeta[] = []
  for (const v of list.slice(0, MAX_VERSIONS)) {
    if (!v?.id || !Number.isFinite(v.timestamp)) continue
    if (!(await idbSet('versions', bodyKey(projectId, v.id), v.snapshot))) {
      console.warn(`[versions] 옛 기록 이전 실패 — localStorage 쪽은 그대로 둔다 (${projectId})`)
      return null
    }
    metas.push({ id: v.id, timestamp: v.timestamp, label: v.label })
  }
  if (!(await idbSet('versions', metaKey(projectId), metas))) return null

  // 여기까지 왔으면 IndexedDB 에 다 들어갔다. 이제 지워도 된다.
  scopedRemove(legacyKey(projectId))
  console.log(`[versions] 옛 기록 ${metas.length}개를 IndexedDB 로 옮겼다 (${projectId})`)
  return metas
}

// ── 메타 목록 ──

async function readMetas(projectId: string): Promise<VersionMeta[]> {
  const stored = await idbGet<VersionMeta[]>('versions', metaKey(projectId))
  if (Array.isArray(stored)) return stored
  return (await migrateLegacy(projectId)) ?? []
}

async function writeMetas(projectId: string, metas: VersionMeta[]): Promise<boolean> {
  return idbSet('versions', metaKey(projectId), metas)
}

// ── 공개 API ──

/**
 * 새 버전 저장. 최신이 0번. MAX 초과시 오래된 것부터 자동 제거.
 *
 * 저장에 실패하면 **null** 을 돌려준다. 호출부가 "남겼다" 를 믿고 다음
 * 동작(예: 서버 덮어쓰기)으로 넘어가면 안 되기 때문이다.
 */
export async function saveVersion(
  projectId: string,
  snapshot: object,
  label?: string,
): Promise<Version | null> {
  void requestPersistentStorage()

  const version: Version = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    label: label?.trim() || undefined,
    snapshot,
  }

  // 본문 먼저. 메타에 올렸는데 본문이 없으면 "있다고 나오는데 못 여는" 유령이 된다.
  if (!(await idbSet('versions', bodyKey(projectId, version.id), snapshot))) {
    console.warn(`[versions] 스냅샷 저장 실패 (${projectId})`)
    return null
  }

  const metas = await readMetas(projectId)
  metas.unshift({ id: version.id, timestamp: version.timestamp, label: version.label })
  const evicted = metas.splice(MAX_VERSIONS)

  if (!(await writeMetas(projectId, metas))) {
    // 메타를 못 썼으면 방금 넣은 본문은 아무도 못 찾는다. 치운다.
    await idbDelete('versions', bodyKey(projectId, version.id))
    console.warn(`[versions] 목록 저장 실패 (${projectId})`)
    return null
  }

  for (const old of evicted) {
    await idbDelete('versions', bodyKey(projectId, old.id))
  }
  return version
}

/** 버전 목록 (최신순). **스냅샷 본문은 없다** — 필요하면 getVersion. */
export async function listVersions(projectId: string): Promise<VersionMeta[]> {
  return readMetas(projectId)
}

/** 특정 버전 (스냅샷 포함). */
export async function getVersion(projectId: string, versionId: string): Promise<Version | null> {
  const meta = (await readMetas(projectId)).find(v => v.id === versionId)
  if (!meta) return null
  const snapshot = await idbGet<object>('versions', bodyKey(projectId, versionId))
  if (!snapshot) return null
  return { ...meta, snapshot }
}

/** 특정 버전 삭제. */
export async function deleteVersion(projectId: string, versionId: string): Promise<void> {
  const metas = (await readMetas(projectId)).filter(v => v.id !== versionId)
  await writeMetas(projectId, metas)
  await idbDelete('versions', bodyKey(projectId, versionId))
}

/** 모든 버전 삭제 (프로젝트 삭제 시 호출). */
export async function clearVersions(projectId: string): Promise<void> {
  for (const meta of await readMetas(projectId)) {
    await idbDelete('versions', bodyKey(projectId, meta.id))
  }
  await idbDelete('versions', metaKey(projectId))
  scopedRemove(legacyKey(projectId))
  migrated.add(projectId)   // 지운 직후에 옛 기록을 다시 끌어오지 않게
}

/** 버전 라벨 변경. 메타만 건드리므로 스냅샷은 안 읽는다. */
export async function renameVersion(
  projectId: string,
  versionId: string,
  label: string,
): Promise<void> {
  const metas = (await readMetas(projectId)).map(v =>
    v.id === versionId ? { ...v, label: label.trim() || undefined } : v
  )
  await writeMetas(projectId, metas)
}

/** 테스트용 — 마이그레이션 1회 플래그를 지운다. */
export function _resetVersionMigrationForTest() {
  migrated.clear()
}
