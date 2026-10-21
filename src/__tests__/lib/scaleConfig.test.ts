import { describe, it, expect } from 'vitest'
import {
  formatLength, DEFAULT_SCALE, SCALE_PRESETS,
  getScaleConfig, setScaleConfig,
  type ScaleConfig,
} from '../../lib/scaleConfig'

describe('formatLength', () => {
  const mmScale: ScaleConfig = { unit: 'mm', pxPerMm: 1 }
  const cmScale: ScaleConfig = { unit: 'cm', pxPerMm: 0.1 }
  const mScale: ScaleConfig  = { unit: 'm',  pxPerMm: 0.01 }

  it('formats mm at 1:1 scale', () => {
    expect(formatLength(100, mmScale)).toBe('100mm')
  })

  it('rounds mm to nearest integer', () => {
    expect(formatLength(100.6, mmScale)).toBe('101mm')
    expect(formatLength(100.4, mmScale)).toBe('100mm')
  })

  it('formats cm with 1 decimal place', () => {
    // 1px = 1cm at pxPerMm=0.1 → 100px = 100cm
    expect(formatLength(100, cmScale)).toBe('100.0cm')
  })

  it('formats cm fractional value', () => {
    // 15px at pxPerMm=0.1 → 15/0.1 = 150mm = 15.0cm
    expect(formatLength(15, cmScale)).toBe('15.0cm')
  })

  it('formats m with 2 decimal places', () => {
    // 1000px at pxPerMm=0.01 → 1000/0.01 = 100000mm = 100m
    expect(formatLength(1000, mScale)).toBe('100.00m')
  })

  it('formats sub-meter length in m', () => {
    // 10px at pxPerMm=0.01 → 10/0.01 = 1000mm = 1m
    expect(formatLength(10, mScale)).toBe('1.00m')
  })

  it('handles 0 length', () => {
    expect(formatLength(0, mmScale)).toBe('0mm')
    expect(formatLength(0, cmScale)).toBe('0.0cm')
    expect(formatLength(0, mScale)).toBe('0.00m')
  })

  it('handles 1:50 preset (pxPerMm=0.02)', () => {
    const scale: ScaleConfig = { unit: 'mm', pxPerMm: 0.02 }
    // 100px → 100/0.02 = 5000mm
    expect(formatLength(100, scale)).toBe('5000mm')
  })

  it('converts correctly at 1:100 preset', () => {
    const scale: ScaleConfig = { unit: 'm', pxPerMm: 0.01 }
    // 200px → 200/0.01 = 20000mm = 20m
    expect(formatLength(200, scale)).toBe('20.00m')
  })

  it('formats km when distance >= 1km in m unit', () => {
    const scale: ScaleConfig = { unit: 'm', pxPerMm: 0.0001 }
    // 1000px → 1000/0.0001 = 10,000,000mm = 10km
    expect(formatLength(1000, scale)).toBe('10.00km')
  })

  it('formats km for exactly 1km', () => {
    const scale: ScaleConfig = { unit: 'm', pxPerMm: 0.001 }
    // 1000px → 1000/0.001 = 1,000,000mm = 1km
    expect(formatLength(1000, scale)).toBe('1.00km')
  })

  it('formats m for sub-km distances (not km)', () => {
    const scale: ScaleConfig = { unit: 'm', pxPerMm: 0.001 }
    // 500px → 500/0.001 = 500,000mm = 500m
    expect(formatLength(500, scale)).toBe('500.00m')
  })
})

describe('DEFAULT_SCALE', () => {
  it('is 1:1 mm scale', () => {
    expect(DEFAULT_SCALE).toEqual({ unit: 'mm', pxPerMm: 1 })
  })
})

describe('SCALE_PRESETS', () => {
  it('has 10 presets (1:1 through 1:10000)', () => {
    expect(SCALE_PRESETS).toHaveLength(10)
  })

  it('each preset has label and pxPerMm', () => {
    for (const p of SCALE_PRESETS) {
      expect(typeof p.label).toBe('string')
      expect(typeof p.pxPerMm).toBe('number')
      expect(p.pxPerMm).toBeGreaterThan(0)
    }
  })

  it('presets are in descending pxPerMm order (largest scale first)', () => {
    for (let i = 0; i < SCALE_PRESETS.length - 1; i++) {
      expect(SCALE_PRESETS[i].pxPerMm).toBeGreaterThan(SCALE_PRESETS[i + 1].pxPerMm)
    }
  })
})

describe('축척이 사는 자리', () => {
  /** 문서 레코드와 세션 meta 를 둘 다 들고 있는 최소 에디터. */
  function fakeEditor(doc: Record<string, unknown> = {}, session: Record<string, unknown> = {}) {
    const settings = { gridSize: 10, name: '', meta: doc }
    return {
      editor: {
        getDocumentSettings: () => settings,
        updateDocumentSettings: (p: { meta?: Record<string, unknown> }) => {
          if (p.meta) settings.meta = p.meta
        },
        getInstanceState: () => ({ meta: session }),
      } as never,
      settings,
    }
  }

  it('문서 레코드에 쓴다 — 세션이 아니라', () => {
    // 세션에 두면 getSnapshot() 의 document.store 에 안 들어가서 저장이 안 된다.
    // 고객이 1:50 으로 맞춘 도면을 다시 열면 1:1 이 되고 치수가 통째로 달라진다.
    const { editor, settings } = fakeEditor()
    setScaleConfig(editor, { pxPerMm: 0.02, unit: 'm' })
    expect(settings.meta.scale).toEqual({ pxPerMm: 0.02, unit: 'm' })
    expect(getScaleConfig(editor)).toEqual({ pxPerMm: 0.02, unit: 'm' })
  })

  it('일부만 바꿔도 나머지가 남는다', () => {
    const { editor } = fakeEditor({ scale: { pxPerMm: 0.1, unit: 'mm' } })
    setScaleConfig(editor, { unit: 'cm' })
    expect(getScaleConfig(editor)).toEqual({ pxPerMm: 0.1, unit: 'cm' })
  })

  it('문서 meta 의 남의 키를 지우지 않는다', () => {
    const { editor, settings } = fakeEditor({ 남의것: 1 })
    setScaleConfig(editor, { unit: 'cm' })
    expect(settings.meta.남의것).toBe(1)
  })

  it('옛 세션의 축척도 읽어준다', () => {
    // 저장 전의 창은 축척을 instance meta 에만 들고 있다. 그걸 무시하면
    // 이 배포가 올라간 순간 열려 있던 창의 축척이 튄다.
    const { editor } = fakeEditor({}, { pxPerMm: 0.005, unit: 'cm' })
    expect(getScaleConfig(editor)).toEqual({ pxPerMm: 0.005, unit: 'cm' })
  })

  it('문서 쪽이 세션보다 우선이다', () => {
    const { editor } = fakeEditor({ scale: { pxPerMm: 0.1, unit: 'mm' } }, { pxPerMm: 1, unit: 'm' })
    expect(getScaleConfig(editor)).toEqual({ pxPerMm: 0.1, unit: 'mm' })
  })

  it('둘 다 없으면 기본값이다', () => {
    const { editor } = fakeEditor()
    expect(getScaleConfig(editor)).toEqual(DEFAULT_SCALE)
  })

  it('getDocumentSettings 가 없는 에디터에서도 안 터진다', () => {
    // 테스트 목이나 옛 tldraw 가 그렇다. 축척 하나 때문에 화면이 죽으면 안 된다.
    const editor = { getInstanceState: () => ({ meta: { unit: 'cm' } }) } as never
    expect(getScaleConfig(editor)).toEqual({ pxPerMm: 1, unit: 'cm' })
  })
})
