// 저장된 도면을 **우리 포맷으로 읽는다.**
//
// tldraw 2.4.6 의 라이선스가 비상업 전용이라 걷어내야 하는데, 저장된 도면은
// 전부 tldraw 스냅샷이다. 그냥 지우면 고객 도면이 통째로 안 열린다.
//
// ── 왜 "이전" 이 아니라 "읽기" 인가 ──
//
// 처음엔 한 번 변환해서 따로 저장해 두는 **이전(migration)** 으로 만들었다.
// 그게 세 가지를 못 풀었다.
//
//   1. **안 연 프로젝트는 안 옮겨진다.** 이전은 에디터를 열 때 돌았다.
//   2. **옮긴 뒤에 더 편집하면 낡는다.** 저장해 둔 건 그 시점의 사본이다.
//   3. **이 기기 IndexedDB 에만 있다.** 브라우저를 바꾸면 없다.
//
// 세 가지 다 "사본을 따로 들고 있으려 해서" 생긴 문제다. 변환은 스냅샷을 한
// 번 훑는 순수 함수라 **읽을 때마다 해도 된다.** 그러면 원본이 곧 진실이고,
// 낡을 것도 빠질 것도 없다.
//
// ── 캐시는 없앴다 ──
//
// 한때 변환 결과를 IndexedDB 에 캐시하고 원본의 지문으로 낡았는지 봤다.
// 두 가지가 어긋나서 걷어냈다.
//
//   1. **지문이 틀렸다.** props 의 키 개수만 봐서, 벽 길이(`x2`)나 DXF
//      `pathData` 처럼 키는 그대로고 값만 바뀌는 편집을 못 잡았다. 그러면
//      낡은 캐시를 최신 문서라고 내준다 — 조용히 틀린 도면을 그린다.
//   2. **제대로 고쳐도 남는 게 없다.** 지문을 믿으려면 수 MB 짜리
//      pathData·textsJson 을 전부 훑어야 하는데, 그건 캐시가 아껴주는
//      변환보다 비싸다. 게다가 지문을 내려면 **원본을 어차피 읽어야** 해서,
//      캐시가 아끼는 건 얕은 변환 한 번뿐이다. 캐시를 IndexedDB 에서
//      꺼내는 비용(수 MB 구조화 복제)이 그보다 크다.
//
// 그래서 매번 변환한다. 느리면 그때 **재서** 고친다.
//
// ── 그래도 지키는 것 ──
//
// 1. **원본을 지우지 않는다.** 나란히 둔다.
// 2. **유실이 있으면 도면을 내주지 않는다.** 변환기가 못 읽은 레코드를
//    세는데(`skipped`), 0 이 아니면 반쪽짜리를 "읽었다" 고 넘기지 않는다 —
//    그 위에 저장이 돌면 그때 진짜로 잃는다.

import { loadSnapshot } from './projectStore'
import { readRecordSnapshot } from './snapshotRecords'
import { fromTldrawSnapshot, type BimoveDocument } from './bimoveDoc'

/**
 * 읽기 결과.
 *
 * 갈림표를 `ok: boolean` 이 아니라 **문자열**로 둔다. 이 프로젝트는
 * strictNullChecks 가 꺼져 있어서 그 모드에서는 boolean 리터럴로 좁히기가
 * 안 먹는다 — `if (r.ok) return` 뒤에도 `r.reason` 이 타입 오류가 된다.
 * (SizeVerdict·POSyncResult 도 같은 이유로 `kind` 를 쓴다.)
 */
export type DocLoad =
  | { kind: 'ok'; doc: BimoveDocument }
  | { kind: 'fail'; reason: string; skipped?: number }

/**
 * 스냅샷을 구한다. 에디터가 들고 있는 걸 넘겨주면 그걸 쓴다.
 *
 * 저장소에서 읽을 때의 순서는 **에디터가 도면을 여는 순서와 같아야 한다** —
 * 레코드 저장본이 우선, 없으면 옛 통짜 스냅샷. 그래야 지금 화면에 있는 것과
 * 같은 걸 읽는다.
 */
async function resolveSnapshot(projectId: string, snapshot?: unknown): Promise<unknown> {
  if (snapshot !== undefined) return snapshot
  return (await readRecordSnapshot(projectId)) ?? (await loadSnapshot(projectId))
}

/** 이 프로젝트의 도면을 우리 포맷으로 읽는다. */
export async function loadDocument(
  projectId: string,
  snapshot?: unknown,
): Promise<DocLoad> {
  try {
    const snap = await resolveSnapshot(projectId, snapshot)
    if (!snap) return { kind: 'fail', reason: '저장된 도면이 없다' }

    const doc = fromTldrawSnapshot(snap)

    if (doc.skipped > 0) {
      // 반쪽을 "읽었다" 고 내주면 그 위에 저장이 돌아 원본을 덮는다.
      return {
        kind: 'fail',
        reason: `못 읽은 레코드 ${doc.skipped}개 — 도면을 내주지 않는다`,
        skipped: doc.skipped,
      }
    }
    if (doc.shapes.length === 0 && doc.pages.length === 0) {
      // 진짜 빈 도면일 수도, 스냅샷을 잘못 읽은 것일 수도 있다. 구분이 안 되니
      // 빈 걸 "멀쩡히 읽었다" 로 넘기지 않는다.
      return { kind: 'fail', reason: '읽을 내용이 없다 (빈 도면이거나 못 읽었다)' }
    }

    return { kind: 'ok', doc }
  } catch (e) {
    return { kind: 'fail', reason: e instanceof Error ? e.message : String(e) }
  }
}
