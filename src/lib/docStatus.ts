// **이 도면, 지금 어디까지 됐나.**
//
// 한이 폰에서 보고 싶은 건 편집이 아니라 이것이다 — "지금 도면이랑 상황
// 어디까지 했는지". 그래서 패널 넷을 폰으로 옮기는 대신 한 장으로 접는다.
//
// ── 왜 패널을 안 옮기나 ──
//
// 레이어·배치·물량·블록 넷 다 **쓰는 쪽**이다. 읽기 전용 경로는 엔진이
// 그리고, 거기서는 쓸 수가 없다 (`bimoveDocStore` 는 읽기 전용 설계).
//
//   레이어   레이어를 끄고 켠다 → 도형의 opacity 를 쓴다
//   배치     장을 **넘기는 건 읽기**, 장을 만드는 건 쓰기
//   물량     계산 결과를 **보는 건 읽기**, 고르고 배치하는 건 쓰기
//   블록     전부 쓰기
//
// 장 넘기기는 뷰어에 이미 있다. 나머지에서 **읽기인 부분만** 뽑아 모으면
// 그게 현황이다. 편집 손잡이를 폰으로 옮기는 것보다 묻는 말에 더 곧게
// 답한다.
//
// ── 에디터가 없다 ──
//
// 전부 저장본(`BimoveDocument`)과 문서 meta, 그리고 프로젝트별 마감재
// 저장소에서 나온다. tldraw 는 한 글자도 안 쓴다.

import type { BimoveDocument } from './bimoveDoc'
import { docMetaOf } from './bimoveDoc'
import { threadsFromMeta, threadsOnPageOf } from './commentStore'
import type { FinishingTablesData } from './finishingData'

export type DocStatus = {
  /** 장 수. 1 이면 화면에서 굳이 안 보여준다. */
  pageCount: number
  /** 공간(zone) 과 그 바닥 면적 합. 면적은 그릴 때 얼어붙은 값이다. */
  zoneCount: number
  floorAreaM2: number
  /** 도면이 얼마나 그려졌나 — 셋 다 0 이면 아직 시작 안 한 것이다. */
  wallCount: number
  openingCount: number
  dimCount: number
  /** 물량표가 놓였나. */
  boqCount: number
  /** 코멘트 — **이게 "어디까지 했나" 에 가장 곧게 답한다.** */
  commentsOpen: number
  commentsResolved: number
  /** 마감재가 정해진 공간 수 / 전체. 바닥 면적이 0 이면 "아직" 으로 본다. */
  finishedZones: number
  finishingZones: number
}

type ShapeProps = { areaM2?: unknown; label?: unknown }

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * 마감재 쪽 진행.
 *
 * `FinishingTablesData` 는 **카테고리 → 자재 → 변형 → 구역 줄**로 네 겹
 * 내려간다 (카테고리 밑에 바로 변형이 있는 게 아니다 — 자재가 한 겹 더 있다).
 * 줄 하나가 한 공간이고, **바닥 면적도 벽 길이도 0 이면 아직 안 적은 것**이다
 * (`defaultZoneRow` 가 0 으로 시작한다).
 *
 * 같은 공간이 자재마다 한 줄씩 있으므로 **이름으로 묶어** 센다. 안 묶으면
 * "8/40" 처럼 자재 가짓수만큼 부풀어 진행률이 거짓말을 한다.
 */
function finishingProgress(fin: FinishingTablesData | null): { done: number; total: number } {
  if (!fin) return { done: 0, total: 0 }
  const byLabel = new Map<string, boolean>()
  for (const cat of fin.categories ?? []) {
    for (const item of cat.items ?? []) {
      for (const variant of item.variants ?? []) {
        for (const row of variant.zones ?? []) {
          const label = (row.label ?? '').trim()
          if (!label) continue
          const filled = num(row.floorAreaM2) > 0 || num(row.wallLengthM) > 0
          byLabel.set(label, (byLabel.get(label) ?? false) || filled)
        }
      }
    }
  }
  let done = 0
  for (const v of byLabel.values()) if (v) done++
  return { done, total: byLabel.size }
}

/**
 * 한 장의 현황.
 *
 * @param pageId 보고 있는 장. 비우면 **문서 전체**를 센다.
 */
export function docStatus(
  doc: BimoveDocument,
  pageId: string,
  fin: FinishingTablesData | null,
): DocStatus {
  const firstPage = doc.pages[0]?.id ?? ''
  // 장을 고르면 그 장의 도형만 — 핀과 같은 규칙이어야 한다. 그래야 "공간
  // 3개" 라고 적힌 화면에 핀이 다른 장 것으로 섞여 있지 않다.
  const shapes = pageId ? doc.shapes.filter(s => s.parentId === pageId) : doc.shapes

  let zoneCount = 0, floorAreaM2 = 0
  let wallCount = 0, openingCount = 0, dimCount = 0, boqCount = 0
  for (const s of shapes) {
    switch (s.type) {
      case 'zone': {
        zoneCount++
        floorAreaM2 += num((s.props as ShapeProps).areaM2)
        break
      }
      case 'wall': wallCount++; break
      case 'door':
      case 'window': openingCount++; break
      case 'dimension': dimCount++; break
      case 'boqtable': boqCount++; break
    }
  }

  const meta = docMetaOf(doc)
  const threads = pageId ? threadsOnPageOf(meta, pageId, firstPage) : threadsFromMeta(meta)
  let commentsOpen = 0, commentsResolved = 0
  for (const t of threads) {
    if (t.resolved) commentsResolved++
    else commentsOpen++
  }

  const prog = finishingProgress(fin)
  return {
    pageCount: doc.pages.length,
    zoneCount,
    // 소수점 둘째 자리까지. 합산하면 0.1 + 0.2 꼴의 찌꺼기가 붙는다.
    floorAreaM2: Math.round(floorAreaM2 * 100) / 100,
    wallCount,
    openingCount,
    dimCount,
    boqCount,
    commentsOpen,
    commentsResolved,
    finishedZones: prog.done,
    finishingZones: prog.total,
  }
}

/** 아직 아무것도 안 그린 도면인가 — 안내 문구를 가를 때 쓴다. */
export function isEmptyDrawing(s: DocStatus): boolean {
  return s.wallCount === 0 && s.openingCount === 0 && s.zoneCount === 0 && s.dimCount === 0
}
