import { describe, it, expect } from 'vitest'
import {
  getDefaultWallThicknessMm, setDefaultWallThicknessMm,
  getWallHeightMm, setWallHeightMm,
  getShowWallLengths, setShowWallLengths,
  getShowRoomAreas, setShowRoomAreas,
  getRoomNames, setRoomName,
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
    localStorage.setItem('bimove_room_names', 'NOT_JSON')
    expect(getRoomNames()).toEqual({})
  })
})
