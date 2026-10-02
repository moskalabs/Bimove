// 서버 스냅샷 충돌 백업.
//
// 두 기기가 같은 프로젝트를 열고 있으면 optimistic locking 이 충돌을 잡는다.
// 예전엔 그걸 경고 로그만 찍고 조용히 덮어써서, 상대가 한 작업이 흔적도 없이
// 사라졌다. 이제는 덮어쓰기 전에 서버 내용을 로컬 버전으로 남긴다.
//
// 까다로운 부분은 "남겼다" 를 믿을 수 없다는 것. saveVersion → scopedSet 은
// localStorage quota 초과를 조용히 삼키므로 예외가 올라오지 않는다.
// 그래서 저장 후 읽어서 확인한다. 확인이 안 되면 'failed' — 호출부는
// 덮어쓰기를 포기해야 한다.

export type BackupResult =
  | 'saved'      // 백업 성공 → 덮어써도 된다
  | 'duplicate'  // 같은 서버 버전을 이미 백업했음 → 덮어써도 된다
  | 'failed'     // 백업 실패 → 덮어쓰면 안 된다

export interface ConflictBackupDeps {
  /** 서버의 현재 스냅샷을 읽는다 */
  loadRemote: (projectId: string) => Promise<{ snapshot: unknown } | null>
  /** 로컬 버전 기록에 저장하고 저장된 버전을 돌려준다 */
  saveVersion: (projectId: string, snapshot: object, label?: string) => { id: string }
  /** 버전이 실제로 남아 있는지 확인 (quota 초과를 잡아내는 유일한 방법) */
  getVersion: (projectId: string, versionId: string) => unknown
}

/** 충돌 백업 버전 라벨. 버전 목록에서 한눈에 구분되도록. */
export function conflictBackupLabel(when: Date): string {
  const hh = String(when.getHours()).padStart(2, '0')
  const mm = String(when.getMinutes()).padStart(2, '0')
  return `충돌 백업 — 다른 기기 (${when.getMonth() + 1}/${when.getDate()} ${hh}:${mm})`
}

/**
 * 덮어쓰기 전에 서버 스냅샷을 로컬 버전으로 백업한다.
 *
 * @param serverUpdatedAt     충돌이 알려준 서버 타임스탬프 (라벨 + 중복 판정용)
 * @param alreadyBackedUpAt   이미 백업해둔 서버 타임스탬프. 같으면 'duplicate'.
 *                            상대가 계속 저장하면 5초마다 충돌이 나는데, 그때마다
 *                            같은 내용을 버전으로 쌓으면 진짜 버전들이 밀려난다.
 */
export async function backupServerSnapshot(
  projectId: string,
  serverUpdatedAt: string | undefined,
  alreadyBackedUpAt: string | undefined,
  deps: ConflictBackupDeps,
): Promise<BackupResult> {
  if (serverUpdatedAt && serverUpdatedAt === alreadyBackedUpAt) return 'duplicate'
  try {
    const remote = await deps.loadRemote(projectId)
    if (!remote?.snapshot) return 'failed'
    const when = serverUpdatedAt ? new Date(serverUpdatedAt) : new Date()
    if (isNaN(when.getTime())) return 'failed'
    const saved = deps.saveVersion(projectId, remote.snapshot as object, conflictBackupLabel(when))
    // quota 초과는 예외를 던지지 않는다 → 읽어서 확인
    if (!deps.getVersion(projectId, saved.id)) return 'failed'
    return 'saved'
  } catch (err) {
    console.warn('[supabase-sync] 충돌 백업 실패', err)
    return 'failed'
  }
}
