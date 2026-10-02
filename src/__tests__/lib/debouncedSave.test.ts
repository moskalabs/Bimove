/**
 * 자동저장 flush 회귀 테스트
 *
 * 증상: CAD 를 불러온 뒤 대시보드로 나갔다 다시 들어오면 불러온 도면이 없다.
 * 원인: effect cleanup 이 clearTimeout 만 하고 대기 중인 저장을 버렸다.
 *       디바운스가 1.5초라 "불러오고 바로 나가기"는 항상 이 구간에 걸렸다.
 * 이제 cleanup / pagehide 에서 flush() 를 부른다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDebouncedSaver } from '../../lib/debouncedSave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createDebouncedSaver', () => {
  it('지연 시간이 지나면 저장한다', () => {
    const save = vi.fn()
    const saver = createDebouncedSaver(save, 1500)
    saver.schedule()
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1500)
    expect(save).toHaveBeenCalledWith('timer')
  })

  it('연속 변경은 한 번만 저장한다 (디바운스)', () => {
    const save = vi.fn()
    const saver = createDebouncedSaver(save, 1500)
    saver.schedule()
    vi.advanceTimersByTime(1000)
    saver.schedule()
    vi.advanceTimersByTime(1000)
    expect(save).not.toHaveBeenCalled()   // 두 번째 schedule 로 타이머 리셋
    vi.advanceTimersByTime(500)
    expect(save).toHaveBeenCalledTimes(1)
  })

  // ── 이게 버그의 핵심 ──
  it('대기 중인 저장을 flush 로 지금 당장 쓴다', () => {
    const save = vi.fn()
    const saver = createDebouncedSaver(save, 1500)
    saver.schedule()
    saver.flush()                          // 1.5초가 되기 전에 화면을 떠남
    expect(save).toHaveBeenCalledWith('flush')
  })

  it('flush 한 뒤 타이머가 다시 저장하지 않는다 (중복 방지)', () => {
    const save = vi.fn()
    const saver = createDebouncedSaver(save, 1500)
    saver.schedule()
    saver.flush()
    vi.advanceTimersByTime(5000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('대기 중인 저장이 없으면 flush 는 아무것도 하지 않는다', () => {
    const save = vi.fn()
    const saver = createDebouncedSaver(save, 1500)
    saver.flush()
    expect(save).not.toHaveBeenCalled()
    // 타이머로 이미 저장된 뒤에도 다시 쓰지 않는다
    saver.schedule()
    vi.advanceTimersByTime(1500)
    saver.flush()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush 는 저장 이유로 flush 를 넘긴다 (썸네일 같은 무거운 후처리 생략용)', () => {
    const reasons: string[] = []
    const saver = createDebouncedSaver(r => reasons.push(r), 1500)
    saver.schedule()
    vi.advanceTimersByTime(1500)
    saver.schedule()
    saver.flush()
    expect(reasons).toEqual(['timer', 'flush'])
  })

  it('cancel 은 저장하지 않고 버린다', () => {
    const save = vi.fn()
    const saver = createDebouncedSaver(save, 1500)
    saver.schedule()
    saver.cancel()
    vi.advanceTimersByTime(5000)
    expect(save).not.toHaveBeenCalled()
    expect(saver.isPending).toBe(false)
  })

  it('isPending 으로 대기 상태를 알 수 있다', () => {
    const saver = createDebouncedSaver(() => {}, 1500)
    expect(saver.isPending).toBe(false)
    saver.schedule()
    expect(saver.isPending).toBe(true)
    vi.advanceTimersByTime(1500)
    expect(saver.isPending).toBe(false)
  })
})
