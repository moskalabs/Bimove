import { describe, it, expect } from 'vitest'
import {
  getDefaultWallThicknessMm, setDefaultWallThicknessMm,
  getWallHeightMm, setWallHeightMm,
  getShowWallLengths, setShowWallLengths,
  getShowRoomAreas, setShowRoomAreas,
  getRoomNames, setRoomName,
  getSnapEnabled, setSnapEnabled,
  getSnapMode, setSnapMode, getActiveSnapModes,
  type SnapMode,
} from '../../lib/settings'

describe('wall thickness', () => {
  it('returns 200 as default', () => {
    expect(getDefaultWallThicknessMm()).toBe(200)
  })

  it('persists set value', () => {
    setDefaultWallThicknessMm(300)
    expect(getDefaultWallThicknessMm()).toBe(300)
  })

  it('persists 0', () => {
    setDefaultWallThicknessMm(0)
    expect(getDefaultWallThicknessMm()).toBe(0)
  })
})

describe('wall height', () => {
  it('returns 2400 as default', () => {
    expect(getWallHeightMm()).toBe(2400)
  })

  it('persists set value', () => {
    setWallHeightMm(3000)
    expect(getWallHeightMm()).toBe(3000)
  })
})

describe('show wall lengths toggle', () => {
  it('defaults to true', () => {
    expect(getShowWallLengths()).toBe(true)
  })

  it('persists false', () => {
    setShowWallLengths(false)
    expect(getShowWallLengths()).toBe(false)
  })

  it('persists true', () => {
    setShowWallLengths(false)
    setShowWallLengths(true)
    expect(getShowWallLengths()).toBe(true)
  })
})

describe('show room areas toggle', () => {
  it('defaults to true', () => {
    expect(getShowRoomAreas()).toBe(true)
  })

  it('persists false', () => {
    setShowRoomAreas(false)
    expect(getShowRoomAreas()).toBe(false)
  })
})

describe('room names', () => {
  it('returns empty object by default', () => {
    expect(getRoomNames()).toEqual({})
  })

  it('sets and retrieves a room name', () => {
    setRoomName('room-1', '거실')
    expect(getRoomNames()['room-1']).toBe('거실')
  })

  it('trims whitespace from name', () => {
    setRoomName('room-2', '  주방  ')
    expect(getRoomNames()['room-2']).toBe('주방')
  })

  it('deletes room name when set to empty string', () => {
    setRoomName('room-1', '거실')
    setRoomName('room-1', '')
    expect(getRoomNames()['room-1']).toBeUndefined()
  })

  it('deletes room name when set to whitespace only', () => {
    setRoomName('room-1', '거실')
    setRoomName('room-1', '   ')
    expect(getRoomNames()['room-1']).toBeUndefined()
  })

  it('persists multiple room names', () => {
    setRoomName('r1', '방1')
    setRoomName('r2', '방2')
    const names = getRoomNames()
    expect(names['r1']).toBe('방1')
    expect(names['r2']).toBe('방2')
  })

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('bimova_room_names', 'NOT_JSON')
    expect(getRoomNames()).toEqual({})
  })
})

// ── 스냅 토글 (요청사항 5: 스냅 상세설정 드롭다운) ──

describe('snap enabled (ortho)', () => {
  it('defaults to true', () => {
    expect(getSnapEnabled()).toBe(true)
  })

  it('persists false', () => {
    setSnapEnabled(false)
    expect(getSnapEnabled()).toBe(false)
  })

  it('persists true after false', () => {
    setSnapEnabled(false)
    setSnapEnabled(true)
    expect(getSnapEnabled()).toBe(true)
  })
})

describe('individual snap modes', () => {
  const _ALL_MODES: SnapMode[] = ['endpoint', 'midpoint', 'intersection', 'perpendicular', 'extension']

  it('endpoint defaults to true', () => {
    localStorage.clear()
    expect(getSnapMode('endpoint')).toBe(true)
  })

  it('midpoint defaults to true', () => {
    localStorage.clear()
    expect(getSnapMode('midpoint')).toBe(true)
  })

  it('intersection defaults to true', () => {
    localStorage.clear()
    expect(getSnapMode('intersection')).toBe(true)
  })

  it('perpendicular defaults to false', () => {
    localStorage.clear()
    expect(getSnapMode('perpendicular')).toBe(false)
  })

  it('extension defaults to false', () => {
    localStorage.clear()
    expect(getSnapMode('extension')).toBe(false)
  })

  it('toggle endpoint off and on', () => {
    setSnapMode('endpoint', false)
    expect(getSnapMode('endpoint')).toBe(false)
    setSnapMode('endpoint', true)
    expect(getSnapMode('endpoint')).toBe(true)
  })

  it('toggle perpendicular on', () => {
    setSnapMode('perpendicular', true)
    expect(getSnapMode('perpendicular')).toBe(true)
  })

  it('each mode is independent', () => {
    setSnapMode('endpoint', false)
    setSnapMode('midpoint', true)
    expect(getSnapMode('endpoint')).toBe(false)
    expect(getSnapMode('midpoint')).toBe(true)
  })

  it('getActiveSnapModes returns all modes', () => {
    localStorage.clear()
    const modes = getActiveSnapModes()
    expect(modes).toEqual({
      endpoint: true,
      midpoint: true,
      intersection: true,
      perpendicular: false,
      extension: false,
    })
  })

  it('getActiveSnapModes reflects changes', () => {
    setSnapMode('endpoint', false)
    setSnapMode('extension', true)
    const modes = getActiveSnapModes()
    expect(modes.endpoint).toBe(false)
    expect(modes.extension).toBe(true)
  })
})
