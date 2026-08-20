import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../../lib/quoteExport'

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('A&B')).toBe('A&amp;B')
  })

  it('escapes less than', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;')
  })

  it('escapes greater than', () => {
    expect(escapeHtml('1 > 0')).toBe('1 &gt; 0')
  })

  it('escapes double quotes', () => {
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;')
  })

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s')
  })

  it('escapes all special chars at once', () => {
    expect(escapeHtml('<a href="x&y">it\'s</a>'))
      .toBe('&lt;a href=&quot;x&amp;y&quot;&gt;it&#39;s&lt;/a&gt;')
  })

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('returns safe string unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123')
  })

  it('handles Korean characters', () => {
    expect(escapeHtml('프로젝트 견적서')).toBe('프로젝트 견적서')
  })

  it('handles multiple consecutive special chars', () => {
    expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;')
  })
})
