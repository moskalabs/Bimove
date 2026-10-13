/**
 * LWPOLYLINE bulge(gc 42) 자리 맞추기 검증
 *
 * DXF 는 bulge 가 0 인 꼭짓점에서 gc 42 를 아예 안 쓴다. 그래서 42 값을
 * 나온 순서대로 쌓으면 "bulge 가 있는 꼭짓점" 목록이 되고, 꼭짓점 번호와
 * 어긋나서 직선이어야 할 변이 남의 bulge 를 물려받아 호로 부푼다.
 */
import { describe, it, expect, beforeAll } from 'vitest'

// Worker 모듈 static import — jsdom 에선 self === window 라서 onmessage 가 붙는다
import '../../lib/dxf-fast-worker'

const g = (c: number) => String(c).padStart(3)

function makeDxfHeader(): string {
  return `${g(0)}\nSECTION\n${g(2)}\nHEADER\n${g(9)}\n$ACADVER\n${g(1)}\nAC1009\n${g(9)}\n$INSUNITS\n${g(70)}\n4\n${g(0)}\nENDSEC\n`
}

/**
 * bulges 에 적힌 꼭짓점만 gc 42 를 쓴다 — 실제 AutoCAD 가 내보내는 형태.
 * (bulge 0 인 꼭짓점은 42 자체가 없다)
 */
function makeLwPolylineSparseBulge(
  points: [number, number][],
  bulges: Record<number, number>,
  closed = false,
  layer = '0',
): string {
  let s = `${g(0)}\nLWPOLYLINE\n${g(8)}\n${layer}\n${g(70)}\n${closed ? 1 : 0}\n${g(90)}\n${points.length}\n`
  points.forEach(([x, y], i) => {
    s += `${g(10)}\n${x}\n${g(20)}\n${y}\n`
    if (bulges[i] !== undefined) s += `${g(42)}\n${bulges[i]}\n`
  })
  return s
}

function wrapDxf(entities: string): string {
  return `${makeDxfHeader()}${g(0)}\nSECTION\n${g(2)}\nENTITIES\n${entities}${g(0)}\nENDSEC\n${g(0)}\nEOF\n`
}

type PolylineData = { vertices: number[][]; layer: string; colorNumber: number }

function callWorkerSync(dxfText: string, selectedLayers: string[]): Promise<PolylineData[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker mock timeout (15s)')), 15000)
    const origPost = self.postMessage
    self.postMessage = (msg: Record<string, unknown>) => {
      if (msg.type === 'result') {
        clearTimeout(timeout)
        self.postMessage = origPost
        resolve(msg.polylines as PolylineData[])
      } else if (msg.type === 'error') {
        clearTimeout(timeout)
        self.postMessage = origPost
        reject(new Error(msg.message as string))
      }
    }
    if (typeof self.onmessage === 'function') {
      self.onmessage(new MessageEvent('message', { data: { type: 'parse', dxfText, selectedLayers } }))
    } else {
      clearTimeout(timeout)
      self.postMessage = origPost
      reject(new Error('self.onmessage not set — worker import failed'))
    }
  })
}

function yRange(polys: PolylineData[]): { minY: number; maxY: number } {
  let minY = Infinity, maxY = -Infinity
  for (const p of polys) {
    for (const [, y] of p.vertices) {
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { minY, maxY }
}

// 반시계 사각형. 변: v0→v1 아래쪽(y=0), v1→v2 오른쪽, v2→v3 위쪽(y=100), v3→v0 닫는 변
const SQUARE: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]]

describe('LWPOLYLINE bulge 자리 맞추기', () => {
  beforeAll(() => {
    expect(typeof self.onmessage).toBe('function')
  })

  it('bulge 없으면 사각형 그대로 — y 범위 0~100', async () => {
    const polys = await callWorkerSync(wrapDxf(makeLwPolylineSparseBulge(SQUARE, {}, true)), ['0'])
    expect(polys.length).toBeGreaterThan(0)
    const { minY, maxY } = yRange(polys)
    expect(minY).toBeCloseTo(0, 6)
    expect(maxY).toBeCloseTo(100, 6)
  })

  it('꼭짓점 2 에만 bulge=1 → 위쪽 변만 y=150 까지 부풀고 아래쪽은 안 내려간다', async () => {
    // 버그가 있으면 42 배열의 0번이 꼭짓점 0 으로 읽혀서 아래쪽 변이 y=-50 까지 처진다
    const polys = await callWorkerSync(wrapDxf(makeLwPolylineSparseBulge(SQUARE, { 2: 1 }, true)), ['0'])
    expect(polys.length).toBeGreaterThan(0)
    const { minY, maxY } = yRange(polys)
    expect(minY).toBeGreaterThan(-0.01)
    expect(maxY).toBeCloseTo(150, 2)
  })

  it('꼭짓점 0 에만 bulge=1 → 원래 맞던 경우도 그대로 (아래쪽 y=-50)', async () => {
    const polys = await callWorkerSync(wrapDxf(makeLwPolylineSparseBulge(SQUARE, { 0: 1 }, true)), ['0'])
    expect(polys.length).toBeGreaterThan(0)
    const { minY, maxY } = yRange(polys)
    expect(minY).toBeCloseTo(-50, 2)
    expect(maxY).toBeCloseTo(100, 6)
  })

  it('꼭짓점 1·3 만 bulge → 양 옆 변만 휘고 위아래 변은 수평', async () => {
    const polys = await callWorkerSync(
      wrapDxf(makeLwPolylineSparseBulge(SQUARE, { 1: 1, 3: 1 }, true)),
      ['0'],
    )
    expect(polys.length).toBeGreaterThan(0)
    const { minY, maxY } = yRange(polys)
    expect(minY).toBeCloseTo(0, 6)
    expect(maxY).toBeCloseTo(100, 6)
    // 좌우로 반원씩 — x 가 -50 ~ 150 으로 벌어진다
    let minX = Infinity, maxX = -Infinity
    for (const p of polys) for (const [x] of p.vertices) { if (x < minX) minX = x; if (x > maxX) maxX = x }
    expect(minX).toBeCloseTo(-50, 2)
    expect(maxX).toBeCloseTo(150, 2)
  })
})
