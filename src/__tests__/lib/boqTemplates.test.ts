import { describe, it, expect } from 'vitest'
import {
  BOQ_TEMPLATES, createItemFromTemplate, getTemplate,
} from '../../lib/boqTemplates'

describe('BOQ_TEMPLATES', () => {
  it('has 5 templates', () => {
    expect(BOQ_TEMPLATES.length).toBe(5)
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
      expect(t.defaultItem).toBeDefined()
      expect(t.defaultItem.name).toBeTruthy()
      expect(t.defaultItem.unit).toBeTruthy()
    }
  })

  it('wallpaper has correct defaults', () => {
    const wp = BOQ_TEMPLATES.find(t => t.id === 'wallpaper')!
    expect(wp.defaultItem.itemWidthMm).toBe(530)
    expect(wp.defaultItem.itemLengthMm).toBe(15600)
    expect(wp.defaultItem.lossRate).toBe(0.10)
    expect(wp.defaultItem.unit).toBe('롤')
  })

  it('paint uses m² unit', () => {
    const paint = BOQ_TEMPLATES.find(t => t.id === 'paint')!
    expect(paint.defaultItem.unit).toBe('m²')
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
    const template = getTemplate('tile')!
    const item = createItemFromTemplate(template)
    expect(item.name).toBe('타일')
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
  it('finds template by id', () => {
    expect(getTemplate('wallpaper')?.label).toBe('벽지')
    expect(getTemplate('tile')?.label).toBe('타일')
    expect(getTemplate('paint')?.label).toBe('도장')
    expect(getTemplate('flooring')?.label).toBe('마루')
    expect(getTemplate('film')?.label).toBe('필름')
  })

  it('returns undefined for unknown id', () => {
    expect(getTemplate('nonexistent' as never)).toBeUndefined()
  })
})
