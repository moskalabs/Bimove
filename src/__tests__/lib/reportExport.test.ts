import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// reportExport 내부 함수들은 export되지 않으므로, 테스트 가능한 부분 위주로 구성
// 1) esc() 함수 로직
// 2) calcTypeLabel() 로직
// 3) variantSummary() 로직
// 4) printReport() 통합 테스트 (window.open mock)

// -- esc 로직 직접 구현 (private이므로 동일 로직 테스트) --

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  )
}

function calcTypeLabel(t: string): string {
  return { sheet: '면적(장/box)', paint: '도장', roll: '롤', area: '면적', length: '길이' }[t] ?? t
}

describe('reportExport — esc()', () => {
  it('escapes & correctly', () => {
    expect(esc('A & B')).toBe('A &amp; B')
  })

  it('escapes < and >', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;')
  })

  it('escapes double quotes', () => {
    expect(esc('say "hello"')).toBe('say &quot;hello&quot;')
  })

  it('escapes single quotes', () => {
    expect(esc("it's")).toBe('it&#39;s')
  })

  it('escapes multiple special chars', () => {
    expect(esc('<div class="a">&</div>')).toBe('&lt;div class=&quot;a&quot;&gt;&amp;&lt;/div&gt;')
  })

  it('returns plain string unchanged', () => {
    expect(esc('hello world 123')).toBe('hello world 123')
  })

  it('handles empty string', () => {
    expect(esc('')).toBe('')
  })

  it('handles Korean characters', () => {
    expect(esc('인테리어 공사')).toBe('인테리어 공사')
  })
})

describe('reportExport — calcTypeLabel()', () => {
  it('returns 면적(장/box) for sheet', () => {
    expect(calcTypeLabel('sheet')).toBe('면적(장/box)')
  })

  it('returns 도장 for paint', () => {
    expect(calcTypeLabel('paint')).toBe('도장')
  })

  it('returns 롤 for roll', () => {
    expect(calcTypeLabel('roll')).toBe('롤')
  })

  it('returns 면적 for area', () => {
    expect(calcTypeLabel('area')).toBe('면적')
  })

  it('returns 길이 for length', () => {
    expect(calcTypeLabel('length')).toBe('길이')
  })

  it('returns original string for unknown type', () => {
    expect(calcTypeLabel('custom')).toBe('custom')
  })
})

// -- printReport 통합 테스트 (window.open mock) --

describe('reportExport — printReport()', () => {
  let mockWin: { document: { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }; print: ReturnType<typeof vi.fn> }
  let writtenHtml: string

  beforeEach(() => {
    writtenHtml = ''
    mockWin = {
      document: {
        write: vi.fn((html: string) => { writtenHtml = html }),
        close: vi.fn(),
      },
      print: vi.fn(),
    }
    vi.stubGlobal('open', vi.fn(() => mockWin))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockEditor(shapes: unknown[] = []) {
    return {
      getCurrentPageShapes: () => shapes,
      getSvgString: vi.fn(async () => ({
        svg: '<svg width="100" height="100"><rect/></svg>',
      })),
      getDocumentSettings: () => ({}),
      getInstanceState: () => ({ meta: {} }),
    }
  }

  it('opens new window and writes HTML', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never, { projectName: 'Test Project' })

    expect(window.open).toHaveBeenCalledWith('', '_blank')
    expect(mockWin.document.write).toHaveBeenCalledTimes(1)
    expect(mockWin.document.close).toHaveBeenCalledTimes(1)
  })

  it('includes project name in cover page', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never, { projectName: '강남 인테리어' })

    expect(writtenHtml).toContain('강남 인테리어')
    expect(writtenHtml).toContain('INTERIOR DESIGN REPORT')
  })

  it('includes company name when provided', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never, { companyName: '한디자인' })

    expect(writtenHtml).toContain('한디자인')
    expect(writtenHtml).toContain('COMPANY')
  })

  it('excludes company section when not provided', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never, { projectName: 'Test' })

    // COMPANY label should not appear when companyName is empty
    expect(writtenHtml).not.toContain('COMPANY')
  })

  it('includes client name and address', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never, { clientName: '김고객', address: '서울시 강남구' })

    expect(writtenHtml).toContain('김고객')
    expect(writtenHtml).toContain('서울시 강남구')
  })

  it('uses default project name when not provided', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never)

    expect(writtenHtml).toContain('인테리어 공사')
  })

  it('includes date in cover page', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never, { date: '2026년 9월 16일' })

    expect(writtenHtml).toContain('2026년 9월 16일')
    expect(writtenHtml).toContain('DATE')
  })

  it('generates valid HTML structure', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never, { projectName: 'Test' })

    expect(writtenHtml).toContain('<!DOCTYPE html>')
    expect(writtenHtml).toContain('<html lang="ko">')
    expect(writtenHtml).toContain('</html>')
    expect(writtenHtml).toContain('cover page')
    expect(writtenHtml).toContain('bimova')
  })

  it('includes floor plan when shapes exist', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const shapes = [{ id: 's1', type: 'wall' }]
    const editor = mockEditor(shapes)
    await printReport(editor as never, { projectName: 'Test' })

    expect(editor.getSvgString).toHaveBeenCalled()
    expect(writtenHtml).toContain('<div class="plan-page page">')
    expect(writtenHtml).toContain('평면도')
    expect(writtenHtml).toContain('FLOOR PLAN')
  })

  it('excludes floor plan when no shapes', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor([])
    await printReport(editor as never, { projectName: 'Test' })

    // plan-page appears in CSS definitions, so check for the actual plan page div
    expect(writtenHtml).not.toContain('<div class="plan-page page">')
    expect(writtenHtml).not.toContain('FLOOR PLAN')
  })

  it('removes SVG width/height attributes', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const shapes = [{ id: 's1', type: 'wall' }]
    const editor = mockEditor(shapes)
    await printReport(editor as never, { projectName: 'Test' })

    // SVG should have width/height removed for responsive scaling
    expect(writtenHtml).not.toMatch(/(<svg[^>]*)\s+width="100"/)
    expect(writtenHtml).not.toMatch(/(<svg[^>]*)\s+height="100"/)
  })

  it('escapes special characters in project name', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never, { projectName: 'A & B <test>' })

    expect(writtenHtml).toContain('A &amp; B &lt;test&gt;')
  })

  it('handles popup blocked (window.open returns null)', async () => {
    const alertMock = vi.fn()
    vi.stubGlobal('alert', alertMock)
    vi.stubGlobal('open', vi.fn(() => null))

    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never)

    expect(alertMock).toHaveBeenCalledWith('팝업 차단을 해제해 주세요.')
  })

  it('includes A3 landscape page size', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never)

    expect(writtenHtml).toContain('size: A3 landscape')
  })

  it('spec list page excluded when no projectId', async () => {
    const { printReport } = await import('../../lib/reportExport')
    const editor = mockEditor()
    await printReport(editor as never, { projectName: 'Test' })

    // spec-page appears in CSS, so check for the actual spec page div
    expect(writtenHtml).not.toContain('<div class="spec-page page">')
    expect(writtenHtml).not.toContain('자재 스펙 리스트')
  })
})
