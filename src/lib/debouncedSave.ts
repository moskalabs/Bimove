// 디바운스 저장기.
//
// 핵심은 debounce 자체가 아니라 flush 다. 예전 자동저장은 effect cleanup 에서
// clearTimeout 만 했는데, 그러면 대기 중이던 저장이 그대로 사라진다 — CAD 를
// 불러오고 1.5초 안에 대시보드로 나가면 불러온 도면이 어디에도 저장되지 않았고,
// 다시 들어오면 빈 캔버스였다. 언마운트/탭 종료 때는 cancel 이 아니라 flush 다.

export type SaveReason = 'timer' | 'flush'

export type DebouncedSaver = {
  /** 변경 발생 — delayMs 뒤에 저장 (그 안에 또 불리면 타이머 리셋) */
  schedule(): void
  /** 대기 중인 저장이 있으면 지금 당장 동기 실행 */
  flush(): void
  /** 타이머만 버린다 (저장하지 않음) — 테스트/명시적 폐기용 */
  cancel(): void
  readonly isPending: boolean
}

/**
 * @param save   실제 저장. reason='flush' 면 언마운트 직전이라
 *               무거운 후처리(썸네일 등)는 건너뛰는 게 좋다.
 * @param delayMs 디바운스 지연
 */
export function createDebouncedSaver(
  save: (reason: SaveReason) => void,
  delayMs: number,
): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  return {
    schedule() {
      pending = true
      clear()
      timer = setTimeout(() => {
        timer = null
        pending = false
        save('timer')
      }, delayMs)
    },
    flush() {
      if (!pending) return
      clear()
      pending = false
      save('flush')
    },
    cancel() {
      clear()
      pending = false
    },
    get isPending() { return pending },
  }
}
