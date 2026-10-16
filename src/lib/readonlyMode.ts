// 태블릿·모바일에서는 읽기 전용으로 돈다.
//
// 도면 편집은 정밀한 포인팅과 넓은 화면이 전제다. 작은 화면에서 억지로
// 그리게 두면 손가락으로는 스냅 반경(12px) 안을 집을 수 없고, 도구 바가
// 캔버스를 다 덮는다. 그래서 작은 화면에서는 **보기만** 한다.

/** 이 폭 이하면 태블릿 세로·휴대폰으로 본다. App.css 의 중단점과 같은 값이다. */
export const READONLY_MAX_WIDTH = 1024

export type ViewportProbe = {
  width: number
  /** 주 입력기가 손가락인지 (matchMedia('(pointer: coarse)')) */
  coarsePointer: boolean
}

/**
 * 이 화면을 읽기 전용으로 볼지.
 *
 * 폭만 보면 데스크톱 창을 좁게 줄였을 때도 읽기 전용이 되는데, 그건 의도한
 * 쪽이다 — 좁은 창에서는 도구 바가 캔버스를 덮어 어차피 못 그린다.
 * 손가락 입력이면 폭과 무관하게 읽기 전용이다. 아이패드 프로를 가로로 눕히면
 * 1366px 이라 폭 기준만으로는 걸리지 않는다.
 */
export function isReadonlyViewport(probe: ViewportProbe): boolean {
  if (probe.coarsePointer) return true
  return probe.width <= READONLY_MAX_WIDTH
}

/** 지금 창을 재서 판정한다. 브라우저 밖(테스트/SSR)에서는 편집 가능으로 본다. */
export function probeViewport(): ViewportProbe {
  if (typeof window === 'undefined') return { width: Infinity, coarsePointer: false }
  return {
    width: window.innerWidth,
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
  }
}
