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

/** 수평선 한 개 — 종이공간(67=1) 이지만 **소속 탭(410) 을 안 쓴 것**.
 *
 *  DWG→DXF 변환물에 실제로 있다 (리닝 파일의 종이 엔티티 865개 전부 410 없음).
 */
function unlabeledPaperLine(y: number): string {
  return `${g(0)}\nLINE\n${g(8)}\nDRAW\n${g(67)}\n1\n` +
    `${g(10)}\n0\n${g(20)}\n${y}\n${g(30)}\n0\n${g(11)}\n100\n${g(21)}\n${y}\n${g(31)}\n0\n`
}

/**
 * 모형 + 종이 2장짜리 최소 DXF.
 *
 *  y=0   모델공간 선
 *  y=10  "배치1" 종이공간 선 (활성 탭 → ENTITIES 에 67=1 로)
 *  y=20  "배치1" 종이공간 선
 *  y=30  "배치2" 종이공간 선 (비활성 탭 → *Paper_Space0 블록 안에만)
 *  y=40  소속 미표시 종이 엔티티 (`unlabeled: true` 일 때만)
 */
function makeDxf(opts: {
  modelLine?: boolean; paperLines?: boolean; unlabeled?: boolean
} = {}): string {
  const { modelLine = true, paperLines = true, unlabeled = false } = opts

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
    (unlabeled ? unlabeledPaperLine(40) : '') +
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

/**
 * code 410(소속 레이아웃) 을 **아예 안 쓰는** 변환물.
 *
 * 증상: 탭이 2장인데 두 탭에 **같은 시트가 중복으로** 들어왔다. 실측 —
 * 리닝 파일에서 Layout1 과 배치1 의 ENTITIES 읽기 결과가 폴리라인 3143개 /
 * bbox 까지 완전히 동일했고, Layout1 의 종이 범위가 배치1 영역인 X 193124
 * 까지 뻗어 화면맞춤이 덜 찼다.
 *
 * 원인: "410 이 없으면 이름으로 가릴 수 없으니 넣는 쪽이 낫다" 는 폴백이
 * **모든 탭**에 적용됐다. 주인은 접미사 없는 `*Paper_Space` 를 가진 탭 하나다.
 */
describe('소속 미표시 종이 엔티티 (gc 410 없음)', () => {
  const dxf = makeDxf({ unlabeled: true })

  it('주인 탭(ownsUnlabeledPaper=true)은 가져간다', async () => {
    const polys = await callWorkerSync(dxf, LAYERS,
      { kind: 'paper', layoutName: '배치1', blockName: '*Paper_Space', ownsUnlabeledPaper: true })
    expect(ys(polys)).toEqual([10, 20, 40])
  })

  it('남의 탭(ownsUnlabeledPaper=false)은 안 가져간다', async () => {
    // 여기서 40 이 같이 들어오면 같은 시트가 탭마다 중복된다.
    const polys = await callWorkerSync(dxf, LAYERS,
      { kind: 'paper', layoutName: '배치2', blockName: '*Paper_Space0', ownsUnlabeledPaper: false })
    expect(ys(polys)).toEqual([30])
  })

  it('플래그를 생략하면 예전 그대로 가져간다 (주인을 못 고른 파일)', async () => {
    const polys = await callWorkerSync(dxf, LAYERS,
      { kind: 'paper', layoutName: '배치2', blockName: '*Paper_Space0' })
    expect(ys(polys)).toEqual([30, 40])
  })

  it('410 이 **있는** 엔티티는 플래그와 무관하게 이름으로 가린다', async () => {
    // 주인 탭이라도 남의 410 은 안 받는다 — 기존 동작을 안 건드렸다는 보증.
    const polys = await callWorkerSync(dxf, LAYERS,
      { kind: 'paper', layoutName: '배치2', blockName: '*Paper_Space', ownsUnlabeledPaper: true })
    expect(ys(polys)).toEqual([40])
  })

  it('모델공간 모드는 영향 없다', async () => {
    const polys = await callWorkerSync(dxf, LAYERS, { kind: 'model', excludePaper: true })
    expect(ys(polys)).toEqual([0])
  })
})

// ───────── code 67 이 빠진 치수 ─────────
//
// dwgdxf(acadrust 0.4.0)의 `write_dimension_base` 는 공통 엔티티 writer 를
// 거치지 않고 직접 쓰는데, 거기에 종이공간 플래그(code 67)를 넣는 줄이 없다.
// 다른 엔티티는 `write_common_entity_data` 가 제대로 쓴다.
//
// 그래서 **종이공간 치수만** 67 없이 나오고, 우리는 그걸 모델 엔티티로 보고
// 모형 탭에 쏟아부었다. 26.08.07_리닝 파일에서 E-1 / F_dim / E-DIM 레이어의
// 치수선 조각이 모형 왼쪽 위에 흩어져 나온 게 이것이다 (AutoCAD 모형 탭에는
// 없는 것들이다).
//
// 다행히 소유자 핸들(code 330)은 제대로 적혀 있어서, BLOCK_RECORD 테이블에서
// 이름을 역으로 찾으면 67 없이도 소속을 안다.

/** BLOCK_RECORD 테이블 — 핸들 ↔ 블록 이름. */
const BLOCK_RECORDS =
  `${g(0)}\nSECTION\n${g(2)}\nTABLES\n` +
  `${g(0)}\nTABLE\n${g(2)}\nBLOCK_RECORD\n` +
  `${g(0)}\nBLOCK_RECORD\n${g(5)}\n1F\n${g(2)}\n*Model_Space\n` +
  `${g(0)}\nBLOCK_RECORD\n${g(5)}\n2A\n${g(2)}\n*Paper_Space\n` +
  `${g(0)}\nBLOCK_RECORD\n${g(5)}\n2B\n${g(2)}\n*Paper_Space0\n` +
  `${g(0)}\nENDTAB\n${g(0)}\nENDSEC\n`

/**
 * 치수 한 개. **code 67 도 410 도 없고** 소유자 핸들만 있다 — 변환기가
 * 내놓는 모양 그대로다. 실제 선은 익명 블록(`*D<n>`) 안에 있다.
 */
function dimension(n: number, y: number, ownerHandle: string): string {
  return `${g(0)}\nDIMENSION\n${g(5)}\n${100 + n}\n${g(330)}\n${ownerHandle}\n` +
    `${g(100)}\nAcDbEntity\n${g(8)}\nE-DIM\n${g(100)}\nAcDbDimension\n` +
    `${g(2)}\n*D${n}\n${g(10)}\n0\n${g(20)}\n${y}\n${g(30)}\n0\n`
}

/** 치수의 익명 블록 — 치수선 한 줄이 들어 있다. */
function dimBlock(n: number, y: number): string {
  return `${g(0)}\nBLOCK\n${g(2)}\n*D${n}\n${g(10)}\n0\n${g(20)}\n0\n${g(30)}\n0\n` +
    `${g(0)}\nLINE\n${g(8)}\nE-DIM\n` +
    `${g(10)}\n0\n${g(20)}\n${y}\n${g(30)}\n0\n${g(11)}\n100\n${g(21)}\n${y}\n${g(31)}\n0\n` +
    `${g(0)}\nENDBLK\n`
}

/**
 * 모델 치수 1개 + 종이 치수 2개(탭마다 하나)짜리 DXF.
 *
 *   y=0   모델공간 치수   (owner = *Model_Space)
 *   y=50  "배치1" 치수    (owner = *Paper_Space)
 *   y=60  "배치2" 치수    (owner = *Paper_Space0)
 */
function makeDimDxf(): string {
  const header = `${g(0)}\nSECTION\n${g(2)}\nHEADER\n${g(9)}\n$INSUNITS\n${g(70)}\n4\n${g(0)}\nENDSEC\n`
  const blocks =
    `${g(0)}\nSECTION\n${g(2)}\nBLOCKS\n` +
    dimBlock(1, 0) + dimBlock(2, 50) + dimBlock(3, 60) +
    `${g(0)}\nENDSEC\n`
  const entities =
    `${g(0)}\nSECTION\n${g(2)}\nENTITIES\n` +
    dimension(1, 0, '1F') +
    dimension(2, 50, '2A') +
    dimension(3, 60, '2B') +
    `${g(0)}\nENDSEC\n`
  return header + BLOCK_RECORDS + blocks + entities + `${g(0)}\nEOF\n`
}

const DIM_LAYERS = ['E-DIM']

describe('소유자 핸들로 가리는 종이공간 치수', () => {
  it('모델 모드는 종이 치수를 버린다 (67 이 없어도)', async () => {
    // 이게 깨지면 모형 탭에 치수선 조각이 다시 쏟아진다.
    const polys = await callWorkerSync(makeDimDxf(), DIM_LAYERS, { kind: 'model', excludePaper: true })
    expect(ys(polys)).toEqual([0])
  })

  it('종이 모드는 그 탭 소유의 치수만 가져온다', async () => {
    const p1 = await callWorkerSync(makeDimDxf(), DIM_LAYERS,
      { kind: 'paper', layoutName: '배치1', blockName: '*Paper_Space' })
    expect(ys(p1)).toEqual([50])

    const p2 = await callWorkerSync(makeDimDxf(), DIM_LAYERS,
      { kind: 'paper', layoutName: '배치2', blockName: '*Paper_Space0' })
    expect(ys(p2)).toEqual([60])
  })

  it('탭을 나누지 않으면 전과 같이 다 들어온다', async () => {
    // 레이아웃이 하나뿐인 파일에서 종이 치수를 버리면 치수가 통째로 사라진다.
    const polys = await callWorkerSync(makeDimDxf(), DIM_LAYERS)
    expect(ys(polys)).toEqual([0, 50, 60])
  })

  it('BLOCK_RECORD 가 없으면 예전 판정(code 67)으로 돌아간다', async () => {
    // 수동 작성 DXF 처럼 테이블이 없는 파일도 있다. 소유자를 못 찾으면
    // 아무것도 걸러내지 않는다 — 추측으로 지우는 쪽이 더 나쁘다.
    const noTables = makeDimDxf().replace(BLOCK_RECORDS, '')
    const polys = await callWorkerSync(noTables, DIM_LAYERS, { kind: 'model', excludePaper: true })
    expect(ys(polys)).toEqual([0, 50, 60])
  })
})
