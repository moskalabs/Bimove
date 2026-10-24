// 보고 있는 자리와 고른 것 — **화면 쪽 상태.**
//
// 저장소(`store.ts`)와 **일부러 갈라 뒀다.** 둘 다 저장되지 않고 되돌리기에도
// 안 들어간다. 섞으면 "도형을 고르는 것" 과 "도면을 바꾸는 것" 이 같은
// 되돌리기에 쌓여서, 뒤로 한 번 눌렀을 때 무엇이 돌아올지 알 수 없게 된다.
// (tldraw 도 이걸 세션 상태로 뒀다.)
//
// ── 좌표는 한 벌만 ──
//
// 화면 ↔ 도면 변환은 `lib/cadCamera.ts` 가 이미 한다 — 엔진 캔버스가 쓰는
// 그것이다. 여기서 다시 쓰지 않고 그걸 부른다. 두 벌을 두면 **확대할수록
// 벌어진다** (핀이 도면에서 미끄러지는 꼴).
//
// 카메라의 `cx,cy` 는 **엔진 좌표**(y 가 위로)다. 바깥에는 page 좌표
// (y 가 아래로)만 내보인다 — 쓰는 쪽이 뒤집기를 신경 쓸 일이 없어야 한다.

import {
  pageToScreen, screenToPage, zoomAt,
  type CadCam, type CanvasBox, type Pt,
} from '../lib/cadCamera'

/** page 좌표로 잰 네모. */
export type PageBounds = { minX: number; minY: number; maxX: number; maxY: number }

/** 확대 한계. 넘어가면 좌표가 부동소수 바닥을 긁는다. */
const MIN_ZOOM = 1e-6
const MAX_ZOOM = 1e6

/** `zoomToFit` 이 둘레에 남기는 여백 (화면 픽셀). */
const FIT_PAD = 24

export class BimoveView {
  private cam: CadCam = { cx: 0, cy: 0, scale: 1 }
  private box: CanvasBox = { w: 0, h: 0 }
  private selected = new Set<string>()
  private listeners = new Set<() => void>()
  private rev = 0

  // ── 캔버스 ──

  /** 캔버스 크기가 바뀌었다 (리사이즈). */
  setBox(box: CanvasBox): void {
    if (box.w === this.box.w && box.h === this.box.h) return
    this.box = { ...box }
    this.bump()
  }

  getBox(): CanvasBox { return { ...this.box } }

  // ── 카메라 ──

  getZoom(): number { return this.cam.scale }

  /** 화면 한가운데가 보고 있는 **page 좌표**. */
  getCenter(): Pt {
    // 엔진 좌표(y 위로) → page(y 아래로)
    return { x: this.cam.cx, y: -this.cam.cy }
  }

  setCenter(p: Pt): void {
    this.cam.cx = p.x
    this.cam.cy = -p.y
    this.bump()
  }

  setZoom(z: number): void {
    const next = clampZoom(z)
    if (next === this.cam.scale) return
    this.cam.scale = next
    this.bump()
  }

  /** 그 점이 제자리에 남도록 확대/축소 — 커서 밑으로 들어가는 느낌. */
  zoomAtScreen(at: Pt, factor: number): void {
    const want = clampZoom(this.cam.scale * factor)
    // 한계에 닿았으면 아무것도 하지 않는다. 그냥 부르면 중심만 밀린다.
    if (want === this.cam.scale) return
    zoomAt(this.cam, at, this.box, want / this.cam.scale)
    this.bump()
  }

  /** 화면을 끈 만큼 도면을 민다 (화면 픽셀). */
  panByScreen(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return
    this.cam.cx -= dx / this.cam.scale
    this.cam.cy += dy / this.cam.scale
    this.bump()
  }

  pageToScreen(p: Pt): Pt { return pageToScreen(this.cam, p, this.box) }
  screenToPage(s: Pt): Pt { return screenToPage(this.cam, s, this.box) }

  /** 지금 화면에 들어오는 **page 좌표** 네모. */
  getVisibleBounds(): PageBounds {
    const a = this.screenToPage({ x: 0, y: 0 })
    const b = this.screenToPage({ x: this.box.w, y: this.box.h })
    return {
      minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y),
    }
  }

  /**
   * 그 네모가 다 보이게 맞춘다.
   *
   * 캔버스를 아직 안 쟀거나(`box` 가 0) 네모가 찌그러졌으면 **아무것도 안
   * 한다** — 0 으로 나누면 카메라가 NaN 이 되고, 그러면 화면이 통째로
   * 사라진다. 되돌릴 방법도 없다.
   */
  zoomToFit(b: PageBounds): void {
    const w = b.maxX - b.minX
    const h = b.maxY - b.minY
    if (!(this.box.w > 0 && this.box.h > 0)) return
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0 || h < 0) return

    const availW = Math.max(1, this.box.w - FIT_PAD * 2)
    const availH = Math.max(1, this.box.h - FIT_PAD * 2)
    // 점 하나(넓이 0)짜리 도면이면 배율을 못 고른다 — 지금 배율을 둔다.
    const scale = (w > 0 || h > 0)
      ? Math.min(w > 0 ? availW / w : Infinity, h > 0 ? availH / h : Infinity)
      : this.cam.scale

    this.cam.scale = clampZoom(scale)
    this.cam.cx = (b.minX + b.maxX) / 2
    this.cam.cy = -(b.minY + b.maxY) / 2
    this.bump()
  }

  // ── 선택 ──

  getSelectedIds(): string[] { return [...this.selected] }
  isSelected(id: string): boolean { return this.selected.has(id) }
  getSelectionCount(): number { return this.selected.size }

  /** 고른 것을 통째로 갈아끼운다. */
  setSelected(ids: string[]): void {
    const next = new Set(ids)
    if (sameSet(next, this.selected)) return
    this.selected = next
    this.bump()
  }

  /** 하나만 고른다 (평범한 클릭). */
  select(id: string): void { this.setSelected([id]) }

  /** 고른 것에 더하거나 뺀다 (Shift 클릭). */
  toggle(id: string): void {
    const next = new Set(this.selected)
    if (!next.delete(id)) next.add(id)
    this.selected = next
    this.bump()
  }

  selectNone(): void { this.setSelected([]) }

  /**
   * 없어진 도형을 고른 목록에서 뺀다.
   *
   * 도형을 지워도 id 는 여기 남는다. 그대로 두면 속성 패널이 **없는 도형의
   * 값을 고치려 들고**, 지운 걸 되돌리면 뜬금없이 다시 골라져 있다. 저장소가
   * 바뀔 때마다 한 번씩 훑어 준다.
   */
  pruneSelection(exists: (id: string) => boolean): void {
    if (this.selected.size === 0) return
    const next = new Set([...this.selected].filter(exists))
    if (next.size === this.selected.size) return
    this.selected = next
    this.bump()
  }

  // ── 구독 ──

  revision(): number { return this.rev }

  listen(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private bump(): void {
    this.rev++
    for (const fn of this.listeners) fn()
  }
}

function clampZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}
