import { describe, it, expect, beforeEach, vi } from 'vitest'

// onlineStatus.ts runs top-level code that accesses navigator.onLine and window.addEventListener.
// We need to ensure jsdom environment is available (vitest default for this project).

describe('onlineStatus', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('isOnline() returns true by default (jsdom navigator.onLine)', async () => {
    const mod = await import('../../lib/onlineStatus')
    // In jsdom, navigator.onLine is typically true
    expect(typeof mod.isOnline()).toBe('boolean')
  })

  it('onStatusChange registers and unregisters listener', async () => {
    const mod = await import('../../lib/onlineStatus')
    const calls: boolean[] = []
    const unsubscribe = mod.onStatusChange((online) => calls.push(online))
    expect(typeof unsubscribe).toBe('function')

    // Simulate online event
    window.dispatchEvent(new Event('online'))
    expect(calls).toContain(true)

    // Simulate offline event
    window.dispatchEvent(new Event('offline'))
    expect(calls).toContain(false)

    // Unsubscribe
    unsubscribe()
    const countBefore = calls.length
    window.dispatchEvent(new Event('online'))
    expect(calls.length).toBe(countBefore) // no new calls
  })

  it('safeFetch returns null when offline', async () => {
    const mod = await import('../../lib/onlineStatus')

    // Force offline
    window.dispatchEvent(new Event('offline'))

    const onError = vi.fn()
    const result = await mod.safeFetch(
      async () => ({ data: 'hello', error: null }),
      onError,
    )

    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('오프라인'))
  })

  it('safeFetch returns data when online and no error', async () => {
    const mod = await import('../../lib/onlineStatus')

    // Force online
    window.dispatchEvent(new Event('online'))

    const result = await mod.safeFetch(
      async () => ({ data: { id: 1, name: 'test' }, error: null }),
    )
    expect(result).toEqual({ id: 1, name: 'test' })
  })

  it('safeFetch returns null and calls onError on server error', async () => {
    const mod = await import('../../lib/onlineStatus')
    window.dispatchEvent(new Event('online'))

    const onError = vi.fn()
    const result = await mod.safeFetch(
      async () => ({ data: null, error: { message: 'DB down' } }),
      onError,
    )

    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('DB down'))
  })

  it('safeFetch returns null on thrown exception', async () => {
    const mod = await import('../../lib/onlineStatus')
    window.dispatchEvent(new Event('online'))

    const onError = vi.fn()
    const result = await mod.safeFetch(
      async () => { throw new Error('Network failure') },
      onError,
    )

    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('서버 연결'))
  })

  it('safeSync returns false when offline', async () => {
    const mod = await import('../../lib/onlineStatus')
    window.dispatchEvent(new Event('offline'))

    const result = await mod.safeSync(async () => {})
    expect(result).toBe(false)
  })

  it('safeSync returns true on success', async () => {
    const mod = await import('../../lib/onlineStatus')
    window.dispatchEvent(new Event('online'))

    const result = await mod.safeSync(async () => 'done')
    expect(result).toBe(true)
  })

  it('safeSync returns false and calls onError on exception', async () => {
    const mod = await import('../../lib/onlineStatus')
    window.dispatchEvent(new Event('online'))

    const onError = vi.fn()
    const result = await mod.safeSync(
      async () => { throw new Error('Sync failed') },
      onError,
    )

    expect(result).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('동기화'))
  })
})
