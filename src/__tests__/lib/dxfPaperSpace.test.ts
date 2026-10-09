/**
 * 종이공간(Paper Space) 분리 회귀 테스트
 *
 * 증상: AutoCAD 에서 "배치1" 탭에 도면틀·표제란·시트 캡션이 가득한데
 * Bimove 로 가져오면 그 페이지가 **텅** 비었다. 반대로 "모형" 페이지엔
 * 모델 도형 위로 도면틀이 겹쳐 쏟아졌다.
 *
 * 원인: 파서가 ENTITIES 섹션을 전부 모델공간으로 취급했다. DXF 는
 *  - 저장 당시 **활성 탭**의 종이 엔티티를 ENTITIES 에 code 67=1 로 섞어 넣고
 *    (code 410 이 어느 탭인지 알려준다),
 *  - 나머지 탭의 것은 `*Paper_SpaceN` BLOCK 안에만 둔다 (아무도 INSERT 안 함).
 * 둘 다 읽지 않으면 탭마다 제 도면틀이 들어올 수가 없다.
 */
import { describe, it, expect } from 'vitest'

// Worker 모듈을 static import — jsdom 에선 self === window 라 onmessage 가 붙는다
import '../../lib/dxf-fast-worker'
import type { ParseSpace } from '../../lib/dxf-shared'

/** Pad group code to 3 chars (standard DXF convention) */
const g = (c: number) => String(c).padStart(3)

type PolylineData = { vertices: number[][]; layer: string; colorNumber: number }

function callWorkerSync(
  dxfText: string,
  selectedLayers: string[],
  space?: ParseSpace,
): Promise<PolylineData[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker mock timeout (10s)')), 10000)
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
      self.onmessage(new MessageEvent('message', { data: { type: 'parse', dxfText, selectedLayers, space } }))
    } else {
      clearTimeout(timeout)
      self.postMessage = origPost
      reject(new Error('self.onmessage not set — worker import failed'))
    }
  })
}

/** y 좌표로 어느 선인지 구분한다 — 전부 수평선이다. */
const ys = (polys: PolylineData[]) => polys.map(p => p.vertices[0][1]).sort((a, b) => a - b)

/**
 * 수평선 한 개. `paperOf` 가 주어지면 종이공간 엔티티(67=1 + 410).
 *
 * 실제 DXF 의 코드 순서를 따른다 — 8(레이어) 다음에 67, 그 다음 410.
 */
function line(y: number, paperOf?: string): string {
  const owner = paperOf === undefined ? '' : `${g(67)}\n1\n${g(410)}\n${paperOf}\n`
  return `${g(0)}\nLINE\n${g(8)}\nDRAW\n${owner}` +
    `${g(10)}\n0\n${g(20)}\n${y}\n${g(30)}\n0\n${g(11)}\n100\n${g(21)}\n${y}\n${g(31)}\n0\n`
}

/**
 * 모형 + 종이 2장짜리 최소 DXF.
 *
 *  y=0   모델공간 선
 *  y=10  "배치1" 종이공간 선 (활성 탭 → ENTITIES 에 67=1 로)
 *  y=20  "배치1" 종이공간 선
 *  y=30  "배치2" 종이공간 선 (비활성 탭 → *Paper_Space0 블록 안에만)
 */
function makeDxf(opts: { modelLine?: boolean; paperLines?: boolean } = {}): string {
  const { modelLine = true, paperLines = true } = opts

  const header = `${g(0)}\nSECTION\n${g(2)}\nHEADER\n${g(9)}\n$INSUNITS\n${g(70)}\n4\n${g(0)}\nENDSEC\n`

  const blocks =
    `${g(0)}\nSECTION\n${g(2)}\nBLOCKS\n` +
    // 활성 탭의 블록은 **비어 있다** — 내용은 ENTITIES 쪽에 있다.
    `${g(0)}\nBLOCK\n${g(2)}\n*Paper_Space\n${g(10)}\n0\n${g(20)}\n0\n${g(30)}\n0\n` +
    `${g(0)}\nENDBLK\n` +
    `${g(0)}\nBLOCK\n${g(2)}\n*Paper_Space0\n${g(10)}\n0\n${g(20)}\n0\n${g(30)}\n0\n` +
    line(30) +
    `${g(0)}\nENDBLK\n` +
    `${g(0)}\nENDSEC\n`

  const entities =
    `${g(0)}\nSECTION\n${g(2)}\nENTITIES\n` +
    (modelLine ? line(0) : '') +
    (paperLines ? line(10, '배치1') + line(20, '배치1') : '') +
    `${g(0)}\nENDSEC\n`

  return header + blocks + entities + `${g(0)}\nEOF\n`
}

const LAYERS = ['DRAW']

describe('종이공간 분리', () => {
  it('기본(space 생략)은 예전 그대로 — 종이 엔티티도 같이 들어온다', async () => {
    // 레이아웃이 하나뿐인 파일에서 종이 엔티티를 버리면 도면이 통째로
    // 사라진다. 탭을 나누지 않는 경로는 건드리지 않았다는 보증.
    const polys = await callWorkerSync(makeDxf(), LAYERS)
    expect(ys(polys)).toEqual([0, 10, 20])
  })

  it('모델공간 모드(excludePaper)는 종이 엔티티를 버린다', async () => {
    const polys = await callWorkerSync(makeDxf(), LAYERS, { kind: 'model', excludePaper: true })
    expect(ys(polys)).toEqual([0])
  })

  it('종이 모드는 그 탭(code 410)의 엔티티만 가져온다', async () => {
    const polys = await callWorkerSync(makeDxf(), LAYERS, { kind: 'paper', layoutName: '배치1' })
    expect(ys(polys)).toEqual([10, 20])
  })

  it('비활성 탭은 *Paper_SpaceN 블록에서 꺼낸다', async () => {
    const polys = await callWorkerSync(makeDxf(), LAYERS,
      { kind: 'paper', layoutName: '배치2', blockName: '*Paper_Space0' })
    expect(ys(polys)).toEqual([30])
  })

  it('블록 이름을 모르면 아무것도 펼치지 않는다 (다른 탭 도면틀이 섞이면 안 된다)', async () => {
    const polys = await callWorkerSync(makeDxf(), LAYERS, { kind: 'paper', layoutName: '배치2' })
    expect(polys).toHaveLength(0)
  })

  it('ENTITIES 가 통째로 비면 종이 블록으로 폴백한다', async () => {
    // DWG→DXF 변환물 중 도형이 전부 종이공간 블록에만 있는 파일이 있다.
    // 그 구제책은 남아 있다 (예전 동작 그대로).
    const polys = await callWorkerSync(makeDxf({ modelLine: false, paperLines: false }), LAYERS)
    expect(ys(polys)).toEqual([30])
  })

  it('ENTITIES 가 비어도 excludePaper 면 폴백하지 않는다', async () => {
    // 탭을 나누는 중이다 — 종이 도형은 제 탭 페이지로 따로 들어간다.
    // 여기서 긁어오면 모형 페이지에 남의 도면틀이 겹친다.
    const polys = await callWorkerSync(makeDxf({ modelLine: false, paperLines: false }), LAYERS,
      { kind: 'model', excludePaper: true })
    expect(polys).toHaveLength(0)
  })

  it('종이 엔티티만 있고 모델이 비어도, excludePaper 면 모형 페이지는 빈다', async () => {
    // 폴백이 "모델이 비었네" 하고 남의 종이 도형을 긁어오던 자리.
    const polys = await callWorkerSync(makeDxf({ modelLine: false }), LAYERS,
      { kind: 'model', excludePaper: true })
    expect(polys).toHaveLength(0)
  })
})
