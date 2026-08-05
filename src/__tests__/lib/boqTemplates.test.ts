import { describe, it, expect } from 'vitest'
import {
  BOQ_TEMPLATES, BOQ_CATEGORIES,
  createItemFromTemplate, getTemplate,
} from '../../lib/boqTemplates'

describe('BOQ_CATEGORIES', () => {
  it('has 4 categories', () => {
    expect(BOQ_CATEGORIES.length).toBe(4)
    expect(BOQ_CATEGORIES.map(c => c.key)).toEqual(['ceiling', 'wall', 'floor', 'molding'])
  })

  it('each category has templates', () => {
    for (const c of BOQ_CATEGORIES) {
      expect(c.templates.length).toBeGreaterThan(0)
      expect(c.label).toBeTruthy()
      expect(c.icon).toBeTruthy()
    }
  })
})

describe('BOQ_TEMPLATES', () => {
  it('has 17 templates (flat)', () => {
    expect(BOQ_TEMPLATES.length).toBe(17)
  })

  it('has unique ids', () => {
    const ids = BOQ_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all templates have required fields', () => {
    for (const t of BOQ_TEMPLATES) {
      expect(t.id).toBeTruthy()
      expect(t.label).toBeTruthy()
      expect(t.icon).toBeTruthy()
      expect(t.description).toBeTruthy()
      expect(t.defaultCalcMethod).toBeTruthy()
      expect(t.defaultItem).toBeDefined()
      expect(t.defaultItem.name).toBeTruthy()
      expect(t.defaultItem.unit).toBeTruthy()
    }
  })

  it('wall-wallpaper has correct defaults', () => {
    const wp = BOQ_TEMPLATES.find(t => t.id === 'wall-wallpaper')!
    expect(wp.defaultItem.itemWidthMm).toBe(530)
    expect(wp.defaultItem.itemLengthMm).toBe(15600)
    expect(wp.defaultItem.lossRate).toBe(0.10)
    expect(wp.defaultItem.unit).toBe('롤')
    expect(wp.defaultCalcMethod).toBe('area')
  })

  it('wall-paint uses m² unit', () => {
    const paint = BOQ_TEMPLATES.find(t => t.id === 'wall-paint')!
    expect(paint.defaultItem.unit).toBe('m²')
  })

  it('molding templates use length calc method', () => {
    const moldings = BOQ_CATEGORIES.find(c => c.key === 'molding')!.templates
    for (const m of moldings) {
      expect(m.defaultCalcMethod).toBe('length')
      expect(m.defaultItem.calcMethod).toBe('length')
      expect(m.defaultItem.unit).toBe('m')
    }
  })
})

describe('createItemFromTemplate', () => {
  it('creates item with unique id', () => {
    const template = BOQ_TEMPLATES[0]
    const item1 = createItemFromTemplate(template)
    const item2 = createItemFromTemplate(template)
    expect(item1.id).toBeTruthy()
    expect(item1.id).not.toBe(item2.id)
  })

  it('copies default values from template', () => {
    const template = getTemplate('floor-tile')!
    const item = createItemFromTemplate(template)
    expect(item.name).toBe('바닥 타일')
    expect(item.itemWidthMm).toBe(600)
    expect(item.itemLengthMm).toBe(600)
    expect(item.lossRate).toBe(0.08)
    expect(item.unit).toBe('장')
  })

  it('starts with empty exclusions', () => {
    const item = createItemFromTemplate(BOQ_TEMPLATES[0])
    expect(item.exclusions).toEqual([])
  })
})

describe('getTemplate', () => {
  it('finds template by new id', () => {
    expect(getTemplate('wall-wallpaper')?.label).toBe('도배')
    expect(getTemplate('floor-tile')?.label).toBe('타일')
    expect(getTemplate('wall-paint')?.label).toBe('도장')
    expect(getTemplate('floor-wood')?.label).toBe('마루')
    expect(getTemplate('wall-film')?.label).toBe('필름')
  })

  it('finds template by legacy id (backward compat)', () => {
    expect(getTemplate('wallpaper')?.label).toBe('도배')
    expect(getTemplate('tile')?.label).toBe('타일')
    expect(getTemplate('paint')?.label).toBe('도장')
    expect(getTemplate('flooring')?.label).toBe('마루')
    expect(getTemplate('film')?.label).toBe('필름')
  })

  it('returns undefined for unknown id', () => {
    expect(getTemplate('nonexistent' as never)).toBeUndefined()
  })
})
