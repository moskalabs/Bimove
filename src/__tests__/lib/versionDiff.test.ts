import { describe, it, expect } from 'vitest'
import { diffSnapshots } from '../../lib/versionDiff'

function makeSnapshot(shapes: Record<string, { type?: string; [key: string]: unknown }>) {
  const store: Record<string, { id: string; typeName: string; type?: string; [key: string]: unknown }> = {}
  for (const [id, data] of Object.entries(shapes)) {
    store[id] = { id, typeName: 'shape', ...data }
  }
  return { store }
}

describe('diffSnapshots', () => {
  it('detects added shapes', () => {
    const before = makeSnapshot({})
    const after = makeSnapshot({ 'shape:1': { type: 'wall', x: 0 } })

    const result = diffSnapshots(before, after)
    expect(result.added).toHaveLength(1)
    expect(result.added[0]).toEqual({ id: 'shape:1', type: 'wall', status: 'added' })
    expect(result.removed).toHaveLength(0)
    expect(result.modified).toHaveLength(0)
    expect(result.totalChanges).toBe(1)
  })

  it('detects removed shapes', () => {
    const before = makeSnapshot({ 'shape:1': { type: 'wall', x: 0 } })
    const after = makeSnapshot({})

    const result = diffSnapshots(before, after)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0]).toEqual({ id: 'shape:1', type: 'wall', status: 'removed' })
    expect(result.totalChanges).toBe(1)
  })

  it('detects modified shapes', () => {
    const before = makeSnapshot({ 'shape:1': { type: 'wall', x: 0, y: 0 } })
    const after = makeSnapshot({ 'shape:1': { type: 'wall', x: 100, y: 0 } })

    const result = diffSnapshots(before, after)
    expect(result.added).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
    expect(result.modified).toHaveLength(1)
    expect(result.modified[0]).toEqual({ id: 'shape:1', type: 'wall', status: 'modified' })
    expect(result.totalChanges).toBe(1)
  })

  it('reports unchanged shapes as no diff', () => {
    const before = makeSnapshot({ 'shape:1': { type: 'wall', x: 10, y: 20 } })
    const after = makeSnapshot({ 'shape:1': { type: 'wall', x: 10, y: 20 } })

    const result = diffSnapshots(before, after)
    expect(result.totalChanges).toBe(0)
  })

  it('handles complex mixed changes', () => {
    const before = makeSnapshot({
      'shape:1': { type: 'wall', x: 0 },
      'shape:2': { type: 'door', x: 50 },
      'shape:3': { type: 'window', x: 100 },
    })
    const after = makeSnapshot({
      'shape:1': { type: 'wall', x: 0 },       // unchanged
      'shape:2': { type: 'door', x: 999 },      // modified
      // shape:3 removed
      'shape:4': { type: 'block', x: 200 },     // added
    })

    const result = diffSnapshots(before, after)
    expect(result.added).toHaveLength(1)
    expect(result.removed).toHaveLength(1)
    expect(result.modified).toHaveLength(1)
    expect(result.totalChanges).toBe(3)
  })

  it('handles empty snapshots', () => {
    const result = diffSnapshots({}, {})
    expect(result.totalChanges).toBe(0)
  })

  it('handles snapshots without store property', () => {
    const result = diffSnapshots({ foo: 'bar' }, { baz: 42 })
    expect(result.totalChanges).toBe(0)
  })

  it('ignores non-shape records in store', () => {
    const before = {
      store: {
        'shape:1': { id: 'shape:1', typeName: 'shape', type: 'wall', x: 0 },
        'page:1': { id: 'page:1', typeName: 'page', name: 'Page 1' },
        'instance:1': { id: 'instance:1', typeName: 'instance' },
      },
    }
    const after = {
      store: {
        'shape:1': { id: 'shape:1', typeName: 'shape', type: 'wall', x: 100 },
        'page:1': { id: 'page:1', typeName: 'page', name: 'Page 1 Updated' },
      },
    }

    const result = diffSnapshots(before, after)
    // Only shape:1 modified. page and instance changes are ignored.
    expect(result.modified).toHaveLength(1)
    expect(result.totalChanges).toBe(1)
  })

  it('uses "shape" as default type when type is missing', () => {
    const before = makeSnapshot({})
    const after = {
      store: {
        'shape:1': { id: 'shape:1', typeName: 'shape' },
      },
    }

    const result = diffSnapshots(before, after)
    expect(result.added).toHaveLength(1)
    expect(result.added[0].type).toBe('shape')
  })
})
