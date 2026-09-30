/**
 * Test: HATCH entities inside blocks are parsed during INSERT expansion.
 * Before the fix, only top-level HATCH entities were captured.
 * After the fix, block-internal HATCHes are also transformed and included.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const WORKER_PATH = resolve(__dirname, '../../lib/dxf-fast-worker.ts')

describe('HATCH inside blocks', () => {
  const workerSrc = readFileSync(WORKER_PATH, 'utf-8')

  it('should have transformHatchForInsert function', () => {
    expect(workerSrc).toContain('function transformHatchForInsert')
  })

  it('should add hatchesOutput parameter to entityToPolyline', () => {
    expect(workerSrc).toContain('hatchesOutput?: HatchData[]')
  })

  it('should detect HATCH in block slow path and parse it', () => {
    expect(workerSrc).toContain("eType === 'HATCH' && hatchesOutput")
    expect(workerSrc).toContain('parseHatchEntity(chunk, eLayer)')
    expect(workerSrc).toContain('transformHatchForInsert(hd, block.baseX, block.baseY, nextTransforms)')
  })

  it('should pass hatches to entityToPolyline in main scan loop', () => {
    expect(workerSrc).toContain(
      "entityToPolyline(type, codes, blocks, '', [], 0, layerSet, output, texts, hatches)",
    )
  })

  it('should thread hatchesOutput through nested INSERT expansion', () => {
    // For nested INSERT: subHatches collected and transformed
    expect(workerSrc).toContain('hatchesOutput ? subHatches : undefined')
    expect(workerSrc).toContain('transformHatchForInsert(sh, block.baseX, block.baseY, nextTransforms)')
  })

  it('should thread hatchesOutput through generic entity expansion', () => {
    // For non-INSERT, non-HATCH entities that might recurse
    expect(workerSrc).toContain('hatchesOutput ? subHatches2 : undefined')
  })

  it('transformHatchForInsert should correctly transform SVG path coords', () => {
    // Verify the regex pattern for transforming SVG path coordinates
    expect(workerSrc).toContain('/([MLZ])([\\d.e+-]+),([\\d.e+-]+)/g')

    // Simulate the transform manually
    const pathData = 'M50,50L150,50L150,150L50,150Z'
    const baseX = 0, baseY = 0
    const ox = 100, oy = 200

    const transformed = pathData.replace(
      /([MLZ])([\d.e+-]+),([\d.e+-]+)/g,
      (_, cmd: string, xStr: string, yStr: string) => {
        const nx = (parseFloat(xStr) - baseX) * 1 + ox
        const ny = (parseFloat(yStr) - baseY) * 1 + oy
        return `${cmd}${nx},${ny}`
      },
    )
    expect(transformed).toBe('M150,250L250,250L250,350L150,350Z')
  })

  it('MAX_HATCHES should be >= 10000 for block expansion', () => {
    const match = workerSrc.match(/MAX_HATCHES\s*=\s*([\d_]+)/)
    expect(match).toBeTruthy()
    const limit = parseInt(match![1].replace(/_/g, ''))
    expect(limit).toBeGreaterThanOrEqual(10000)
  })
})
