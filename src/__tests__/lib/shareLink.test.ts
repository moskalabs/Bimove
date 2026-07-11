import { describe, it, expect } from 'vitest'
import { clearShareHash } from '../../lib/shareLink'

// createShareLink / readShareFromHash use Blob.stream() + CompressionStream
// which are not available in jsdom. Test only what works in jsdom.

describe('clearShareHash', () => {
  it('removes #share= from URL', () => {
    window.location.hash = '#share=abc123'
    clearShareHash()
    expect(window.location.hash).toBe('')
  })

  it('no-op when no share hash', () => {
    window.location.hash = '#other=123'
    clearShareHash()
    expect(window.location.hash).toBe('#other=123')
  })

  it('no-op when hash is empty', () => {
    window.location.hash = ''
    clearShareHash()
    expect(window.location.hash).toBe('')
  })
})

describe('module exports', () => {
  it('exports createShareLink as async function', async () => {
    const mod = await import('../../lib/shareLink')
    expect(typeof mod.createShareLink).toBe('function')
  })

  it('exports readShareFromHash as async function', async () => {
    const mod = await import('../../lib/shareLink')
    expect(typeof mod.readShareFromHash).toBe('function')
  })

  it('exports copyToClipboard as async function', async () => {
    const mod = await import('../../lib/shareLink')
    expect(typeof mod.copyToClipboard).toBe('function')
  })
})
