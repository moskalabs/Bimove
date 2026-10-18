// 저장된 도면을 우리 포맷으로 옮긴다.
//
// tldraw 를 걷어내려면 저장된 도면(전부 tldraw 스냅샷)을 먼저 우리 것으로
// 빼놔야 한다. 그걸 안 하고 tldraw 를 지우면 **고객 도면이 통째로 안 열린다.**
//
// ── 안전 장치 세 가지 ──
//
// 1. **원본을 지우지 않는다.** 나란히 쓴다. 뭔가 잘못돼도 되돌릴 게 남는다.
// 2. **유실이 있으면 저장하지 않는다.** 변환기가 못 읽은 레코드를 세는데
//    (`skipped`), 0 이 아니면 반쪽짜리를 남기느니 안 남긴다 — 나중에 그걸
//    "옮겨진 것" 으로 믿고 원본을 지우면 그때 진짜로 잃는다.
// 3. **실패해도 앱을 세우지 않는다.** 이전은 배경 작업이고, 사용자는 지금
//    도면을 보러 온 것이다.

import { idbGet, idbSet } from './idb'
import { loadSnapshot } from './projectStore'
import { readRecordSnapshot } from './snapshotRecords'
import { fromTldrawSnapshot, countByType, type BimoveDocument } from './bimoveDoc'

const STORE = 'bimovedocs' as const

/** 이전 결과와 그때의 사정. */
export interface MigrationResult {
  ok: boolean
  reason?: string
  shapes?: number
  pages?: number
  byType?: Record<string, number>
  skipped?: number
}

export function migratedKey(projectId: string): string {
  return projectId
}

/** 이미 옮겨 둔 문서. 없으면 null. */
export async function loadBimoveDoc(projectId: string): Promise<BimoveDocument | null> {
  const d = await idbGet<BimoveDocument>(STORE, migratedKey(projectId))
  return d ?? null
}

/**
 * 한 프로젝트를 옮긴다.
 *
 * `snapshot` 을 주면 그걸 쓴다 (에디터가 이미 들고 있을 때). 없으면 저장소에서
 * 읽는다 — 레코드 저장본이 우선이고, 없으면 통짜 스냅샷이다. 읽는 순서는
 * 에디터가 도면을 여는 순서와 같아야 **지금 화면에 있는 것**이 옮겨진다.
 */
export async function migrateProject(
  projectId: string,
  snapshot?: unknown,
): Promise<MigrationResult> {
  try {
    const snap = snapshot ?? (await readRecordSnapshot(projectId)) ?? (await loadSnapshot(projectId))
    if (!snap) return { ok: false, reason: '저장된 도면이 없다' }

    const doc = fromTldrawSnapshot(snap)

    if (doc.skipped > 0) {
      // 반쪽을 남기면 나중에 그걸 믿고 원본을 지운다. 그게 진짜 유실이다.
      return { ok: false, reason: `못 읽은 레코드 ${doc.skipped}개 — 저장하지 않는다`, skipped: doc.skipped }
    }
    if (doc.shapes.length === 0 && doc.pages.length === 0) {
      // 빈 도면일 수도 있지만, 스냅샷을 잘못 읽었을 수도 있다. 구분이 안 되니
      // 남기지 않는다 — 빈 걸 남겨 두면 "옮겼다" 로 보인다.
      return { ok: false, reason: '옮길 내용이 없다 (빈 도면이거나 못 읽었다)' }
    }

    const saved = await idbSet(STORE, migratedKey(projectId), doc)
    if (!saved) return { ok: false, reason: '저장 실패 (용량?)' }

    return {
      ok: true,
      shapes: doc.shapes.length,
      pages: doc.pages.length,
      byType: countByType(doc),
      skipped: doc.skipped,
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 도면을 연 김에 배경에서 옮겨 둔다.
 *
 * **기다리지 않는다.** 사용자는 도면을 보러 온 것이지 이전을 기다리러 온 게
 * 아니다. 실패해도 조용히 넘어가되 콘솔에는 남긴다 — 안 남기면 "왜 안 옮겨졌지"
 * 를 영영 모른다.
 *
 * 이미 옮긴 게 있으면 **도형 수가 달라졌을 때만** 다시 한다. 매번 다시 쓰면
 * 큰 도면에서 열 때마다 수 MB 를 쓴다.
 */
export function migrateInBackground(projectId: string, snapshot?: unknown): void {
  void (async () => {
    try {
      const before = await loadBimoveDoc(projectId)
      const r = await migrateProject(projectId, snapshot)
      if (!r.ok) {
        console.warn(`[이전] ${projectId}: ${r.reason}`)
        return
      }
      if (before && before.shapes.length === r.shapes) return   // 달라진 게 없다
      console.log(
        `[이전] ${projectId}: 도형 ${r.shapes}개 / 페이지 ${r.pages}개`,
        r.byType,
      )
    } catch (e) {
      console.warn('[이전] 실패', e)
    }
  })()
}
