import { describe, it, expect, beforeEach, vi } from 'vitest'

// Reset module state between tests by re-importing
let setCurrentUserId: typeof import('../../lib/scopedStorage').setCurrentUserId
let getCurrentUserId: typeof import('../../lib/scopedStorage').getCurrentUserId
let scopedGet: typeof import('../../lib/scopedStorage').scopedGet
let scopedSet: typeof import('../../lib/scopedStorage').scopedSet
let scopedRemove: typeof import('../../lib/scopedStorage').scopedRemove

beforeEach(async () => {
  // Clear localStorage
  localStorage.clear()
  // Reset module to clear _userId state
  vi.resetModules()
  const mod = await import('../../lib/scopedStorage')
  setCurrentUserId = mod.setCurrentUserId
  getCurrentUserId = mod.getCurrentUserId
  scopedGet = mod.scopedGet
  scopedSet = mod.scopedSet
  scopedRemove = mod.scopedRemove
})

describe('scopedStorage', () => {
  describe('getCurrentUserId / setCurrentUserId', () => {
    it('returns null by default', () => {
      expect(getCurrentUserId()).toBeNull()
    })

    it('returns the set user id', () => {
      setCurrentUserId('user123')
      expect(getCurrentUserId()).toBe('user123')
    })

    it('can be cleared to null', () => {
      setCurrentUserId('user123')
      setCurrentUserId(null)
      expect(getCurrentUserId()).toBeNull()
    })
  })

  describe('scopedGet / scopedSet / scopedRemove without user', () => {
    it('uses bare key when no user is set', () => {
      scopedSet('mykey', 'myval')
      expect(localStorage.getItem('mykey')).toBe('myval')
      expect(scopedGet('mykey')).toBe('myval')
    })

    it('returns null for missing key', () => {
      expect(scopedGet('nonexistent')).toBeNull()
    })

    it('removes with bare key', () => {
      scopedSet('mykey', 'myval')
      scopedRemove('mykey')
      expect(scopedGet('mykey')).toBeNull()
    })
  })

  describe('scopedGet / scopedSet / scopedRemove with user', () => {
    it('prefixes key with u:{userId}:', () => {
      setCurrentUserId('alice')
      scopedSet('theme', 'dark')
      expect(localStorage.getItem('u:alice:theme')).toBe('dark')
      expect(scopedGet('theme')).toBe('dark')
    })

    it('different users have separate data', () => {
      setCurrentUserId('alice')
      scopedSet('color', 'red')

      setCurrentUserId('bob')
      scopedSet('color', 'blue')

      // Verify isolation
      expect(localStorage.getItem('u:alice:color')).toBe('red')
      expect(localStorage.getItem('u:bob:color')).toBe('blue')

      // Current user (bob) sees 'blue'
      expect(scopedGet('color')).toBe('blue')
    })

    it('removes scoped key', () => {
      setCurrentUserId('alice')
      scopedSet('key1', 'val1')
      scopedRemove('key1')
      expect(scopedGet('key1')).toBeNull()
      expect(localStorage.getItem('u:alice:key1')).toBeNull()
    })
  })

  describe('migration', () => {
    it('migrates global keys to scoped keys on first setCurrentUserId', () => {
      // Set up legacy (global) data
      localStorage.setItem('bimove_projects_v1', '[]')
      localStorage.setItem('bimove_price_config_v1', '{"wallPerM":50000}')
      localStorage.setItem('bimove_snap_enabled', 'true')

      // Login triggers migration
      setCurrentUserId('user1')

      // Global keys should now have scoped copies
      expect(localStorage.getItem('u:user1:bimove_projects_v1')).toBe('[]')
      expect(localStorage.getItem('u:user1:bimove_price_config_v1')).toBe('{"wallPerM":50000}')
      expect(localStorage.getItem('u:user1:bimove_snap_enabled')).toBe('true')
    })

    it('does not overwrite existing scoped data', () => {
      // Scoped key already has data
      localStorage.setItem('u:user1:bimove_snap_enabled', 'false')
      // Global key has different data
      localStorage.setItem('bimove_snap_enabled', 'true')

      setCurrentUserId('user1')

      // Scoped value should remain 'false', not overwritten by global 'true'
      expect(localStorage.getItem('u:user1:bimove_snap_enabled')).toBe('false')
    })

    it('only migrates once per user (flag set)', () => {
      localStorage.setItem('bimove_snap_enabled', 'true')

      // First login
      setCurrentUserId('user1')
      expect(localStorage.getItem('bimove_migrated_user1')).toBe('1')

      // Clear the migrated value and set new global
      localStorage.removeItem('u:user1:bimove_snap_enabled')
      localStorage.setItem('bimove_snap_enabled', 'changed')

      // Re-login — migration should NOT run again
      vi.resetModules()
      // Need to reimport to reset _userId but migration flag persists in localStorage
      import('../../lib/scopedStorage').then((mod) => {
        mod.setCurrentUserId('user1')
        // Should still be null because migration was already done
        expect(localStorage.getItem('u:user1:bimove_snap_enabled')).toBeNull()
      })
    })

    it('migrates per-project keys when projects exist', () => {
      const projects = [{ id: 'proj1' }, { id: 'proj2' }]
      localStorage.setItem('bimove_projects_v1', JSON.stringify(projects))
      localStorage.setItem('bimove_project_proj1', '{"data":"snapshot1"}')
      localStorage.setItem('bimove_po_proj2', '{"items":[]}')
      localStorage.setItem('bimove_versions_proj1', '[1,2,3]')

      setCurrentUserId('user1')

      expect(localStorage.getItem('u:user1:bimove_project_proj1')).toBe('{"data":"snapshot1"}')
      expect(localStorage.getItem('u:user1:bimove_po_proj2')).toBe('{"items":[]}')
      expect(localStorage.getItem('u:user1:bimove_versions_proj1')).toBe('[1,2,3]')
    })

    it('does not migrate when setCurrentUserId(null)', () => {
      localStorage.setItem('bimove_snap_enabled', 'true')
      setCurrentUserId(null)

      // No scoped key should exist
      expect(localStorage.getItem('bimove_migrated_null')).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('scopedSet handles localStorage full gracefully', () => {
      // Mock localStorage.setItem to throw
      const orig = Storage.prototype.setItem
      Storage.prototype.setItem = vi.fn(() => { throw new Error('QuotaExceededError') })

      // Should not throw
      expect(() => scopedSet('key', 'val')).not.toThrow()

      Storage.prototype.setItem = orig
    })
  })
})
