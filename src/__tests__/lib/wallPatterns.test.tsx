import { describe, it, expect } from 'vitest'
import { renderPatternDef } from '../../lib/wallPatterns'

describe('renderPatternDef', () => {
  it('returns null for undefined pattern', () => {
    expect(renderPatternDef(undefined, 'p1', '#333')).toBeNull()
  })

  it('returns null for "none" pattern', () => {
    expect(renderPatternDef('none', 'p1', '#333')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(renderPatternDef('', 'p1', '#333')).toBeNull()
  })

  it('returns null for unknown pattern id', () => {
    expect(renderPatternDef('unknown-pattern' as never, 'p1', '#333')).toBeNull()
  })

  it('renders concrete pattern', () => {
    const el = renderPatternDef('concrete', 'pat-concrete-333', '#333')
    expect(el).not.toBeNull()
    // JSX element의 type이 'defs'
    expect(el?.type).toBe('defs')
    // pattern id 확인
    const pattern = el?.props?.children
    expect(pattern?.props?.id).toBe('pat-concrete-333')
  })

  it('renders brick pattern', () => {
    const el = renderPatternDef('brick', 'pat-brick-222', '#222')
    expect(el).not.toBeNull()
    expect(el?.type).toBe('defs')
    const pattern = el?.props?.children
    expect(pattern?.props?.id).toBe('pat-brick-222')
    expect(pattern?.props?.width).toBe(14) // brick width
    expect(pattern?.props?.height).toBe(8) // brick height
  })

  it('renders wood pattern', () => {
    const el = renderPatternDef('wood', 'pat-wood-555', '#555')
    expect(el).not.toBeNull()
    const pattern = el?.props?.children
    expect(pattern?.props?.id).toBe('pat-wood-555')
    expect(pattern?.props?.width).toBe(6)
    expect(pattern?.props?.height).toBe(20)
  })

  it('renders glass pattern', () => {
    const el = renderPatternDef('glass', 'pat-glass-aaa', '#aaa')
    expect(el).not.toBeNull()
    const pattern = el?.props?.children
    expect(pattern?.props?.id).toBe('pat-glass-aaa')
    expect(pattern?.props?.width).toBe(6)
    expect(pattern?.props?.height).toBe(6)
  })

  it('renders tile pattern', () => {
    const el = renderPatternDef('tile', 'pat-tile-888', '#888')
    expect(el).not.toBeNull()
    const pattern = el?.props?.children
    expect(pattern?.props?.id).toBe('pat-tile-888')
    expect(pattern?.props?.width).toBe(10)
    expect(pattern?.props?.height).toBe(10)
  })

  it('uses provided color in patterns', () => {
    const el = renderPatternDef('concrete', 'p1', '#e84335')
    const pattern = el?.props?.children
    // concrete has circles with fill={color}
    const circles = pattern?.props?.children
    // first circle
    expect(circles[0]?.props?.fill).toBe('#e84335')
  })

  it('passes all patterns use userSpaceOnUse', () => {
    for (const p of ['concrete', 'brick', 'wood', 'glass', 'tile'] as const) {
      const el = renderPatternDef(p, `test-${p}`, '#000')
      const pattern = el?.props?.children
      expect(pattern?.props?.patternUnits).toBe('userSpaceOnUse')
    }
  })
})
