import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  drawingState,
  enterPickMode,
  exitPickMode,
  areaMeasureState,
  startAreaMeasure,
  completeAreaMeasure,
  cancelAreaMeasure,
  type AreaMeasureResult,
} from '../../lib/drawingState'

beforeEach(() => {
  // 상태 초기화
  drawingState.drawingId = null
  drawingState.pickTarget = null
  drawingState.pickCallback = null
  drawingState.pickItemId = null
  areaMeasureState.active = false
  areaMeasureState.callback = null
})

describe('drawingState', () => {
  it('has correct initial state', () => {
    expect(drawingState.drawingId).toBeNull()
    expect(drawingState.pickTarget).toBeNull()
    expect(drawingState.pickCallback).toBeNull()
    expect(drawingState.pickItemId).toBeNull()
  })
})

describe('enterPickMode', () => {
  it('sets pick target and callback', () => {
    const cb = vi.fn()
    enterPickMode('wall', cb)

    expect(drawingState.pickTarget).toBe('wall')
    expect(drawingState.pickCallback).toBe(cb)
    expect(drawingState.pickItemId).toBeNull()
  })

  it('sets pickItemId when provided', () => {
    const cb = vi.fn()
    enterPickMode('door-window', cb, 'item-123')

    expect(drawingState.pickTarget).toBe('door-window')
    expect(drawingState.pickItemId).toBe('item-123')
  })

  it('dispatches bimova:pick-mode event', () => {
    const listener = vi.fn()
    window.addEventListener('bimova:pick-mode', listener)

    enterPickMode('wall', vi.fn())
    expect(listener).toHaveBeenCalledTimes(1)

    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual({ active: true, target: 'wall' })

    window.removeEventListener('bimova:pick-mode', listener)
  })

  it('exits previous pick mode on reentry (BUG 3 guard)', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    enterPickMode('wall', cb1)
    expect(drawingState.pickTarget).toBe('wall')

    // 재진입: 이전 것이 정리되어야 함
    enterPickMode('door-window', cb2)
    expect(drawingState.pickTarget).toBe('door-window')
    expect(drawingState.pickCallback).toBe(cb2)
  })
})

describe('exitPickMode', () => {
  it('clears pick state', () => {
    enterPickMode('wall', vi.fn(), 'item-1')
    exitPickMode()

    expect(drawingState.pickTarget).toBeNull()
    expect(drawingState.pickCallback).toBeNull()
    expect(drawingState.pickItemId).toBeNull()
  })

  it('dispatches bimova:pick-mode event with active:false', () => {
    const listener = vi.fn()
    window.addEventListener('bimova:pick-mode', listener)

    enterPickMode('wall', vi.fn())
    exitPickMode()

    // 2 calls: enter + exit
    expect(listener).toHaveBeenCalledTimes(2)
    const exitEvent = listener.mock.calls[1][0] as CustomEvent
    expect(exitEvent.detail).toEqual({ active: false })

    window.removeEventListener('bimova:pick-mode', listener)
  })
})

describe('startAreaMeasure', () => {
  it('activates area measure with callback', () => {
    const cb = vi.fn()
    startAreaMeasure(cb)

    expect(areaMeasureState.active).toBe(true)
    expect(areaMeasureState.callback).toBe(cb)
  })

  it('dispatches bimova:area-measure event', () => {
    const listener = vi.fn()
    window.addEventListener('bimova:area-measure', listener)

    startAreaMeasure(vi.fn())
    expect(listener).toHaveBeenCalledTimes(1)

    const event = listener.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual({ active: true })

    window.removeEventListener('bimova:area-measure', listener)
  })
})

describe('completeAreaMeasure', () => {
  it('calls callback with result and deactivates', () => {
    const cb = vi.fn()
    startAreaMeasure(cb)

    const result: AreaMeasureResult = { areaM2: 25.5, perimeterM: 20.2 }
    completeAreaMeasure(result)

    expect(cb).toHaveBeenCalledWith(result)
    expect(areaMeasureState.active).toBe(false)
    expect(areaMeasureState.callback).toBeNull()
  })

  it('dispatches bimova:area-measure event with active:false', () => {
    const listener = vi.fn()
    window.addEventListener('bimova:area-measure', listener)

    startAreaMeasure(vi.fn())
    completeAreaMeasure({ areaM2: 10, perimeterM: 12 })

    expect(listener).toHaveBeenCalledTimes(2) // start + complete
    const completeEvent = listener.mock.calls[1][0] as CustomEvent
    expect(completeEvent.detail).toEqual({ active: false })

    window.removeEventListener('bimova:area-measure', listener)
  })

  it('handles null callback gracefully', () => {
    areaMeasureState.active = true
    areaMeasureState.callback = null
    expect(() => completeAreaMeasure({ areaM2: 1, perimeterM: 1 })).not.toThrow()
  })
})

describe('cancelAreaMeasure', () => {
  it('deactivates without calling callback', () => {
    const cb = vi.fn()
    startAreaMeasure(cb)
    cancelAreaMeasure()

    expect(cb).not.toHaveBeenCalled()
    expect(areaMeasureState.active).toBe(false)
    expect(areaMeasureState.callback).toBeNull()
  })

  it('dispatches bimova:area-measure event with active:false', () => {
    const listener = vi.fn()
    window.addEventListener('bimova:area-measure', listener)

    startAreaMeasure(vi.fn())
    cancelAreaMeasure()

    const cancelEvent = listener.mock.calls[1][0] as CustomEvent
    expect(cancelEvent.detail).toEqual({ active: false })

    window.removeEventListener('bimova:area-measure', listener)
  })
})
