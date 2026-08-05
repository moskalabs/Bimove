import { describe, it, expect } from 'vitest'
import { BLOCKS, BLOCK_CATEGORIES, getBlock, type BlockDef } from '../../lib/blockLibrary'

describe('BLOCKS data integrity', () => {
  it('has at least 20 block definitions', () => {
    expect(BLOCKS.length).toBeGreaterThanOrEqual(20)
  })

  it('every block has required fields', () => {
    for (const block of BLOCKS) {
      expect(block.id).toBeTruthy()
      expect(typeof block.id).toBe('string')
      expect(block.name).toBeTruthy()
      expect(typeof block.name).toBe('string')
      expect(block.category).toBeTruthy()
      expect(typeof block.category).toBe('string')
      expect(block.wmm).toBeGreaterThan(0)
      expect(block.hmm).toBeGreaterThan(0)
      expect(typeof block.draw).toBe('function')
    }
  })

  it('block IDs are unique', () => {
    const ids = BLOCKS.map(b => b.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('block names are unique', () => {
    const names = BLOCKS.map(b => b.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('draw() returns a valid ReactNode (no throw)', () => {
    for (const block of BLOCKS) {
      expect(() => block.draw()).not.toThrow()
      const node = block.draw()
      // Should return something (not undefined/null for symbols)
      expect(node).toBeTruthy()
    }
  })
})

describe('BLOCK_CATEGORIES', () => {
  it('contains expected categories', () => {
    expect(BLOCK_CATEGORIES).toContain('구조')
    expect(BLOCK_CATEGORIES).toContain('가구')
    expect(BLOCK_CATEGORIES).toContain('욕실')
    expect(BLOCK_CATEGORIES).toContain('주방')
  })

  it('has no duplicate categories', () => {
    const unique = new Set(BLOCK_CATEGORIES)
    expect(unique.size).toBe(BLOCK_CATEGORIES.length)
  })

  it('matches unique categories from BLOCKS', () => {
    const fromBlocks = Array.from(new Set(BLOCKS.map(b => b.category)))
    expect(BLOCK_CATEGORIES).toEqual(fromBlocks)
  })
})

describe('getBlock', () => {
  it('returns a block by id', () => {
    const desk = getBlock('desk')
    expect(desk).toBeDefined()
    expect(desk?.name).toBe('책상')
    expect(desk?.category).toBe('가구')
    expect(desk?.wmm).toBe(1200)
    expect(desk?.hmm).toBe(600)
  })

  it('returns undefined for unknown id', () => {
    expect(getBlock('nonexistent_block')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(getBlock('')).toBeUndefined()
  })

  it('finds specific known blocks', () => {
    // Spot check a few blocks from different categories
    expect(getBlock('toilet')?.category).toBe('욕실')
    expect(getBlock('stove')?.category).toBe('주방')
    expect(getBlock('column_square')?.category).toBe('구조')
    expect(getBlock('bed_single')?.category).toBe('가구')
    expect(getBlock('washer')?.category).toBe('세탁실')
    expect(getBlock('desk_office')?.category).toBe('사무실')
    expect(getBlock('north_arrow')?.category).toBe('기타')
  })

  it('block dimensions are realistic (mm)', () => {
    const bed = getBlock('bed_single')!
    expect(bed.wmm).toBe(1000) // 1m wide
    expect(bed.hmm).toBe(2000) // 2m long

    const toilet = getBlock('toilet')!
    expect(toilet.wmm).toBe(380) // ~38cm wide
    expect(toilet.hmm).toBe(680) // ~68cm deep
  })
})
