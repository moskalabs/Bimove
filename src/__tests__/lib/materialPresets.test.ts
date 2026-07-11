import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MATERIAL_PRESETS,
  loadMaterialPresets,
  saveMaterialPresets,
  resetMaterialPresets,
  findMaterialById,
  findMaterialByFill,
  getPatternSvgDef,
  type MaterialPreset,
} from '../../lib/materialPresets'

describe('DEFAULT_MATERIAL_PRESETS', () => {
  it('has 7 presets', () => {
    expect(DEFAULT_MATERIAL_PRESETS.length).toBe(7)
  })

  it('all have unique ids', () => {
    const ids = DEFAULT_MATERIAL_PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all have fill and stroke colors', () => {
    for (const p of DEFAULT_MATERIAL_PRESETS) {
      expect(p.fill).toMatch(/^#/)
      expect(p.stroke).toMatch(/^#/)
    }
  })
})

describe('loadMaterialPresets', () => {
  it('returns defaults when nothing saved', () => {
    const presets = loadMaterialPresets()
    expect(presets.length).toBe(7)
    expect(presets[0].id).toBe('default')
  })

  it('returns saved presets', () => {
    const custom: MaterialPreset[] = [
      { id: 'custom1', label: '커스텀', fill: '#f00', stroke: '#900' },
    ]
    saveMaterialPresets(custom)
    const loaded = loadMaterialPresets()
    expect(loaded.length).toBe(1)
    expect(loaded[0].label).toBe('커스텀')
  })

  it('handles corrupted data', () => {
    localStorage.setItem('bimove_materials_v2', 'BROKEN')
    const presets = loadMaterialPresets()
    expect(presets.length).toBe(7) // falls back to defaults
  })

  it('handles empty array', () => {
    localStorage.setItem('bimove_materials_v2', '[]')
    const presets = loadMaterialPresets()
    expect(presets.length).toBe(7) // falls back to defaults
  })
})

describe('saveMaterialPresets', () => {
  it('persists to localStorage', () => {
    const custom: MaterialPreset[] = [
      { id: 'a', label: 'A', fill: '#000', stroke: '#111' },
      { id: 'b', label: 'B', fill: '#222', stroke: '#333' },
    ]
    saveMaterialPresets(custom)
    const raw = localStorage.getItem('bimove_materials_v2')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.length).toBe(2)
  })
})

describe('resetMaterialPresets', () => {
  it('clears custom and returns defaults', () => {
    saveMaterialPresets([{ id: 'x', label: 'X', fill: '#f00', stroke: '#0f0' }])
    const result = resetMaterialPresets()
    expect(result.length).toBe(7)
    expect(loadMaterialPresets().length).toBe(7) // localStorage cleared
  })
})

describe('findMaterialById', () => {
  it('finds preset by id', () => {
    const m = findMaterialById('concrete')
    expect(m?.label).toBe('콘크리트')
    expect(m?.pricePerM).toBe(60000)
  })

  it('returns undefined for unknown id', () => {
    expect(findMaterialById('xxx')).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(findMaterialById(undefined)).toBeUndefined()
  })
})

describe('findMaterialByFill', () => {
  it('finds preset by fill color (case insensitive)', () => {
    const m = findMaterialByFill('#A8D8EA')
    expect(m?.id).toBe('glass')
  })

  it('returns undefined for unknown color', () => {
    expect(findMaterialByFill('#ffffff')).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(findMaterialByFill(undefined)).toBeUndefined()
  })
})

describe('getPatternSvgDef', () => {
  it('returns empty string for none', () => {
    expect(getPatternSvgDef('none', '#000')).toBe('')
  })

  it('returns SVG pattern for concrete', () => {
    const svg = getPatternSvgDef('concrete', '#888')
    expect(svg).toContain('pattern')
    expect(svg).toContain('pat-concrete')
    expect(svg).toContain('circle')
  })

  it('returns SVG pattern for brick', () => {
    const svg = getPatternSvgDef('brick', '#b00')
    expect(svg).toContain('pat-brick')
    expect(svg).toContain('line')
  })

  it('returns SVG pattern for wood', () => {
    const svg = getPatternSvgDef('wood', '#c8a')
    expect(svg).toContain('pat-wood')
    expect(svg).toContain('path')
  })

  it('returns SVG pattern for glass', () => {
    const svg = getPatternSvgDef('glass', '#4fa')
    expect(svg).toContain('pat-glass')
  })

  it('returns SVG pattern for tile', () => {
    const svg = getPatternSvgDef('tile', '#d8d')
    expect(svg).toContain('pat-tile')
    expect(svg).toContain('rect')
  })
})
