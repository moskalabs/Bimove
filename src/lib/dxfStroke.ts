/** DXF 선 두께 계산. DxfGroupShape(100+ 세그먼트)와 WallShape(100 미만) 둘 다 쓴다. */

/** DXF lineweight(0.01mm 단위) -> 화면 선 두께(CSS px).
 *  x0.04: 0.25mm->1px, 0.50mm->2px, 1.00mm->4px (두께 차이가 눈에 구분된다).
 *  lineweight 가 없으면(대부분의 도면) 1px. */
export function dxfStrokePx(dxfLw: number): number {
  return dxfLw > 0 ? Math.max(0.5, Math.min(dxfLw * 0.04, 6)) : 1.0
}

/** 화면 px 두께를 shape 좌표계 stroke-width 로 환산한 CSS 값.
 *
 *  tldraw 는 줌을 SVG 안쪽 변환이 아니라 컨테이너 CSS transform 으로 건다
 *  (.tl-html-layer { transform: scale(zoom) ... }). vector-effect="non-scaling-stroke"
 *  는 SVG 좌표계 변환만 상쇄하므로 CSS transform 앞에서는 아무 일도 하지 않는다.
 *  그래서 strokeWidth=1 이 화면에서는 1 * zoom px 로 그려졌다.
 *  성수 평면 Plan 탭(종이공간, 맞춤 줌 ~7배) 에서는 모든 선이 7~8px 로 부풀어
 *  도면 전체가 검은 덩어리가 됐다. 모형 탭은 줌이 ~1 이라 우연히 멀쩡했다.
 *
 *  tldraw 자신의 도형들이 쓰는 관용구를 그대로 쓴다:
 *  tldraw.css 가 --tl-scale: calc(1 / var(--tl-zoom)) 을 정의하고
 *  useZoomCss 가 --tl-zoom 을 컨테이너에 실시간으로 꽂아준다.
 *  (도형이 300개를 넘으면 100ms 디바운스가 걸려 빠른 줌 중에는 두께가 살짝 늦게 따라온다 -
 *   tldraw 기본 도형들도 같은 동작이다.) */
export function screenStrokeWidth(px: number): string {
  return `calc(${px}px * var(--tl-scale, 1))`
}
