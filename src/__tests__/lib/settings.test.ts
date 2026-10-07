import { describe, it, expect } from 'vitest'
import {
  getDefaultWallThicknessMm, setDefaultWallThicknessMm,
  getWallHeightMm, setWallHeightMm,
  getShowWallLengths, setShowWallLengths,
  getShowRoomAreas, setShowRoomAreas,
  getRoomNames, setRoomName,
  getSnapEnabled, setSnapEnabled,
  getSnapMode, setSnapMode, getActiveSnapModes,
  getWheelBehavior, getWheelMode, setWheelMode,
  getSnapUiState, setSnapUiMode,
} from '../../lib/settings'
import { scopedSet } from '../../lib/scopedStorage'

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

describe('wheel behavior', () => {
  // 저장된 값이 없으면 'auto' — App.tsx 가 휠 이벤트를 보고 마우스/터치패드를
  // 감지한다. 카메라 옵션 초기값은 'zoom'(오토캐드 방식) 으로 시작한다.
  it("기본 모드는 'auto', 초기 behavior 는 'zoom'", () => {
    expect(getWheelMode()).toBe('auto')
    expect(getWheelBehavior()).toBe('zoom')
  })

  it('설정한 값이 유지된다', () => {
    setWheelMode('zoom')
    expect(getWheelMode()).toBe('zoom')
    expect(getWheelBehavior()).toBe('zoom')
    setWheelMode('pan')
    expect(getWheelMode()).toBe('pan')
    expect(getWheelBehavior()).toBe('pan')
    setWheelMode('auto')
    expect(getWheelMode()).toBe('auto')
  })

  // 'pan'/'zoom' 만 명시적 선택으로 인정하고 나머지는 'auto' 로 떨어뜨린다.
  it("알 수 없는 값은 'auto' 로 떨어진다", () => {
    scopedSet('bimova_wheel_behavior', 'garbage')
    expect(getWheelMode()).toBe('auto')
    expect(getWheelBehavior()).toBe('zoom')
  })

  // 'auto' 는 tldraw 에 그대로 넘길 수 없는 값이다 — 반드시 해소돼야 한다.
  it("getWheelBehavior 는 'auto' 를 절대 반환하지 않는다", () => {
    for (const v of ['auto', 'pan', 'zoom', '', 'garbage']) {
      scopedSet('bimova_wheel_behavior', v)
      expect(['pan', 'zoom']).toContain(getWheelBehavior())
    }
  })
})

describe('snap UI state', () => {
  // ScaleRuler 와 RBar 가 같은 패널을 각자 들고 있어서, 한쪽에서 토글하면
  // 다른 쪽 체크박스가 옛 값을 그대로 보여줬다. 둘 다 getSnapUiState() 로
  // 읽고 'bimova:settings' 이벤트로 다시 읽게 만든 뒤의 계약을 못박는다.
  it('ortho 는 개별 스냅이 아니라 직교 각도 스냅을 가리킨다', () => {
    setSnapUiMode('ortho', false)
    expect(getSnapEnabled()).toBe(false)
    expect(getSnapUiState().ortho).toBe(false)
    // 개별 스냅은 건드리지 않는다
    expect(getSnapUiState().endpoint).toBe(getSnapMode('endpoint'))

    setSnapUiMode('ortho', true)
    expect(getSnapEnabled()).toBe(true)
  })

  it('개별 스냅 토글이 상태에 그대로 반영된다', () => {
    setSnapUiMode('perpendicular', true)
    expect(getSnapUiState().perpendicular).toBe(true)
    setSnapUiMode('perpendicular', false)
    expect(getSnapUiState().perpendicular).toBe(false)
  })

  it('저장할 때 bimova:settings 를 쏜다 (패널 간 동기화 신호)', () => {
    let fired = 0
    const bump = () => { fired++ }
    window.addEventListener('bimova:settings', bump)
    try {
      setSnapUiMode('midpoint', false)
      setSnapUiMode('ortho', false)
      expect(fired).toBe(2)
    } finally {
      window.removeEventListener('bimova:settings', bump)
    }
  })
})
