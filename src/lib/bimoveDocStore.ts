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
// 그래서 저장해 두는 건 **캐시**다. 진실이 아니다. 원본의 지문(sourceHash)과
// 맞을 때만 쓰고, 어긋나면 버리고 다시 변환한다. 캐시가 아예 없어도 동작은
// 똑같다 — 조금 느릴 뿐이다.
//
// ── 그래도 지키는 것 ──
//
// 1. **원본을 지우지 않는다.** 나란히 둔다.
// 2. **유실이 있으면 도면을 내주지 않는다.** 변환기가 못 읽은 레코드를
//    세는데(`skipped`), 0 이 아니면 반쪽짜리를 "읽었다" 고 넘기지 않는다 —
//    그 위에 저장이 돌면 그때 진짜로 잃는다.
// 3. **캐시 쓰기 실패는 읽기를 막지 않는다.**

import { idbGet, idbSet } from './idb'
import { loadSnapshot } from './projectStore'
import { readRecordSnapshot } from './snapshotRecords'
import { getCurrentUserId } from './scopedStorage'
import {
  fromTldrawSnapshot, countByType, snapshotFingerprint,
  type BimoveDocument,
} from './bimoveDoc'

const STORE = 'bimovedocs' as const

export function docCacheKey(projectId: string): string {
  return projectId
}

/** 캐시에 놓인 문서. 없으면 null. **낡았을 수 있다** — 지문을 직접 봐야 한다. */
export async function readDocCache(projectId: string): Promise<BimoveDocument | null> {
  const d = await idbGet<BimoveDocument>(STORE, docCacheKey(projectId))
  return d ?? null
}

/**
 * 읽기 결과.
 *
 * 갈림표를 `ok: boolean` 이 아니라 **문자열**로 둔다. 이 프로젝트는
 * strictNullChecks 가 꺼져 있어서 그 모드에서는 boolean 리터럴로 좁히기가
 * 안 먹는다 — `if (r.ok) return` 뒤에도 `r.reason` 이 타입 오류가 된다.
 * (SizeVerdict·POSyncResult 도 같은 이유로 `kind` 를 쓴다.)
 */
export type DocLoad =
  | { kind: 'ok'; doc: BimoveDocument; from: 'cache' | 'converted' }
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

/**
 * 이 프로젝트의 도면을 우리 포맷으로 읽는다.
 *
 * 캐시가 원본과 맞으면 캐시를, 아니면 그 자리에서 변환해서 준다. 변환한
 * 경우엔 캐시를 갱신해 두지만 **기다리지 않는다** — 캐시는 속도용이고,
 * 못 써도 결과는 같다.
 */
export async function loadDocument(
  projectId: string,
  snapshot?: unknown,
): Promise<DocLoad> {
  // 시작한 시점의 주인. 아래 캐시 쓰기가 **await 들 뒤에** 오므로 여기서
  // 굳혀야 의미가 있다 (writeDocCache 주석 참고).
  const owner = getCurrentUserId()
  try {
    const snap = await resolveSnapshot(projectId, snapshot)
    if (!snap) return { kind: 'fail', reason: '저장된 도면이 없다' }

    const fingerprint = snapshotFingerprint(snap)

    // 캐시는 **지문이 맞을 때만** 쓴다. 전엔 있으면 그냥 썼는데, 옮긴 뒤에
    // 사용자가 더 편집하면 그 사본이 낡는다. 날짜로는 못 가린다 — 낡은 쪽이
    // 더 나중에 쓰였을 수도 있다.
    const cached = await readDocCache(projectId)
    if (cached && fingerprint && cached.source?.sourceHash === fingerprint) {
      return { kind: 'ok', doc: cached, from: 'cache' }
    }

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

    void writeDocCache(projectId, doc, owner)
    return { kind: 'ok', doc, from: 'converted' }
  } catch (e) {
    return { kind: 'fail', reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 캐시에 써 둔다. 실패는 삼키되 콘솔에는 남긴다 (속도만 손해다).
 *
 * 계정 전환을 여기서 막는다. 이건 **기다리지 않는 쓰기**라, 변환하는 사이에
 * 로그아웃이나 계정 전환이 일어날 수 있다. 그러면 IndexedDB 키의 사용자
 * 스코프가 바뀌어서 A 가 시작한 쓰기가 **B 의 칸에 A 의 도면을** 넣는다.
 * idb 쪽에서 키를 부를 때 굳히긴 하지만 그 호출 자체가 await 들 뒤에 온다.
 *
 * @param owner 읽기를 시작한 시점의 사용자. 호출부가 **await 전에** 잡아야 한다.
 */
async function writeDocCache(
  projectId: string, doc: BimoveDocument, owner: string | null,
): Promise<boolean> {
  try {
    // 쓰기 직전에 주인을 다시 본다. 바뀌었으면 쓰지 않는다 — 새 주인이 이
    // 도면을 열면 그때 다시 변환한다 (원본이 진실이니 잃는 건 없다).
    if (getCurrentUserId() !== owner) return false
    const ok = await idbSet(STORE, docCacheKey(projectId), doc)
    if (!ok) console.warn(`[문서캐시] ${projectId}: 쓰지 못했다 (용량?)`)
    return ok
  } catch (e) {
    console.warn('[문서캐시] 쓰기 실패', e)
    return false
  }
}

/**
 * 도면을 연 김에 캐시를 데워 둔다.
 *
 * **기다리지 않는다.** 사용자는 도면을 보러 온 것이다. 실패해도 조용히
 * 넘어가되 콘솔에는 남긴다.
 *
 * 에디터가 **실제로 연 그 스냅샷**을 넘겨야 한다. 저장소를 다시 읽으면
 * 화면에 있는 것과 다른 걸 캐시할 수 있다 (예비본으로 열었을 때).
 */
export function warmDocCache(projectId: string, snapshot?: unknown): void {
  void (async () => {
    const r = await loadDocument(projectId, snapshot)
    if (r.kind === 'fail') {
      console.warn(`[문서캐시] ${projectId}: ${r.reason}`)
      return
    }
    if (r.from === 'cache') return        // 이미 맞는 게 있었다
    console.log(
      `[문서캐시] ${projectId}: 도형 ${r.doc.shapes.length}개 / 페이지 ${r.doc.pages.length}개`,
      countByType(r.doc),
    )
  })()
}
