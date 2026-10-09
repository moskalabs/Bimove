/**
 * IMAGE 엔티티(래스터 이미지) 회귀 테스트
 *
 * 증상: AutoCAD 에서 보이던 스캔 도면/사진이 Bimove 로 불러오면 흔적도 없이
 * 사라졌다. 원인은 IMAGE 가 OLE2FRAME 과 함께 "비기하 엔티티" 스킵 목록에
 * 들어 있어서, codesToPolyline 의 case 'IMAGE'(테두리 사각형)까지 영영
 * 도달하지 못한 것. LEADER 때와 똑같은 사고다.
 *
 * DXF/DWG 는 픽셀을 품지 않는다 — IMAGE 는 OBJECTS 섹션의 IMAGEDEF(코드 340)
 * 를 가리키고 IMAGEDEF 는 바깥 파일 경로만 들고 있다. 그래서 여기서 보장하는
 * 건 **테두리 + 빠진 파일 이름**까지다 (사진 자체가 아니다).
 */
import { describe, it, expect, beforeAll } from 'vitest'

// Worker 모듈을 static import — jsdom 에선 self === window 라 onmessage 가 붙는다
import '../../lib/dxf-fast-worker'

/** Pad group code to 3 chars (standard DXF convention) */
const g = (c: number) => String(c).padStart(3)

type PolylineData = { vertices: number[][]; layer: string; colorNumber: number }
type TextData = { x: number; y: number; text: string; height: number; layer: string; attachPt?: number }

function callWorkerSync(
  dxfText: string,
  selectedLayers: string[],
): Promise<{ polylines: PolylineData[]; texts: TextData[] }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker mock timeout (10s)')), 10000)
    const origPost = self.postMessage
    self.postMessage = (msg: Record<string, unknown>) => {
      if (msg.type === 'result') {
        clearTimeout(timeout)
        self.postMessage = origPost
        resolve({
          polylines: msg.polylines as PolylineData[],
          texts: (msg.texts || []) as TextData[],
        })
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

/**
 * IMAGE 한 장이 들어간 최소 DXF.
 *
 * 삽입점 (100, 200), U=(0.5,0)/px · 200px → 폭 벡터 (100, 0),
 * V=(0,0.5)/px · 100px → 높이 벡터 (0, 50). 즉 100×50 네모.
 */
function makeDxf(opts: { withImageDef?: boolean; defHandle?: string; refHandle?: string } = {}): string {
  const { withImageDef = true, defHandle = '2A', refHandle = '2A' } = opts

  const header = `${g(0)}\nSECTION\n${g(2)}\nHEADER\n${g(9)}\n$INSUNITS\n${g(70)}\n4\n${g(0)}\nENDSEC\n`

  // 도면이 텅 비면 Paper Space fallback 이 끼어든다 — 선을 몇 개 깔아둔다
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `${g(0)}\nLINE\n${g(8)}\nIMG\n${g(10)}\n${x1}\n${g(20)}\n${y1}\n${g(30)}\n0\n${g(11)}\n${x2}\n${g(21)}\n${y2}\n${g(31)}\n0\n`

  const image =
    `${g(0)}\nIMAGE\n${g(5)}\n1F\n${g(8)}\nIMG\n` +
    `${g(10)}\n100.0\n${g(20)}\n200.0\n${g(30)}\n0.0\n` +
    `${g(11)}\n0.5\n${g(21)}\n0.0\n${g(31)}\n0.0\n` +
    `${g(12)}\n0.0\n${g(22)}\n0.5\n${g(32)}\n0.0\n` +
    `${g(13)}\n200.0\n${g(23)}\n100.0\n` +
    `${g(340)}\n${refHandle}\n`

  const entities = `${g(0)}\nSECTION\n${g(2)}\nENTITIES\n${line(0, 0, 10, 0)}${line(10, 0, 10, 10)}${image}${g(0)}\nENDSEC\n`

  // IMAGEDEF_REACTOR 도 같이 둔다 — marker 가 접두어로 오인하면 안 된다
  const objects = withImageDef
    ? `${g(0)}\nSECTION\n${g(2)}\nOBJECTS\n` +
      `${g(0)}\nIMAGEDEF_REACTOR\n${g(5)}\n9Z\n${g(330)}\n1F\n` +
      `${g(0)}\nIMAGEDEF\n${g(5)}\n${defHandle}\n${g(1)}\nC:\\scan\\plan.jpg\n${g(10)}\n200.0\n${g(20)}\n100.0\n` +
      `${g(0)}\nENDSEC\n`
    : ''

  return `${header}${entities}${objects}${g(0)}\nEOF\n`
}

describe('IMAGE 엔티티 (래스터 이미지)', () => {
  beforeAll(() => {
    expect(typeof self.onmessage).toBe('function')
  })

  it('테두리 사각형을 만든다 (예전엔 통째로 사라졌다)', async () => {
    const { polylines } = await callWorkerSync(makeDxf(), ['IMG'])

    const frames = polylines.filter(p => p.vertices.length === 5)
    const frame = frames.find(p => p.vertices[0][0] === 100 && p.vertices[0][1] === 200)
    expect(frame).toBeDefined()
    expect(frame!.vertices).toEqual([
      [100, 200], [200, 200], [200, 250], [100, 250], [100, 200],
    ])
    expect(frame!.layer).toBe('IMG')
  })

  it('빠진 파일 이름을 테두리 가운데에 적는다', async () => {
    const { texts } = await callWorkerSync(makeDxf(), ['IMG'])

    const label = texts.find(t => t.text === 'plan.jpg')
    expect(label).toBeDefined()
    expect(label!.x).toBe(150)   // (100 + 200) / 2
    expect(label!.y).toBe(225)   // (200 + 250) / 2
    expect(label!.attachPt).toBe(5)   // middle center
    expect(label!.height).toBeGreaterThan(0)
    expect(label!.layer).toBe('IMG')
  })

  it('IMAGEDEF 핸들 대소문자가 달라도 찾는다', async () => {
    const { texts } = await callWorkerSync(makeDxf({ defHandle: '2a', refHandle: '2A' }), ['IMG'])
    expect(texts.some(t => t.text === 'plan.jpg')).toBe(true)
  })

  // IMAGEDEF 가 없거나 핸들이 안 맞아도 **테두리는 나와야 한다**.
  // 이름을 못 찾았다고 이미지 자리까지 없애버리면 원래 버그로 돌아간다.
  it('IMAGEDEF 를 못 찾아도 테두리는 남는다', async () => {
    const { polylines, texts } = await callWorkerSync(makeDxf({ withImageDef: false }), ['IMG'])

    expect(polylines.some(p =>
      p.vertices.length === 5 && p.vertices[0][0] === 100 && p.vertices[0][1] === 200,
    )).toBe(true)
    expect(texts.some(t => t.text.endsWith('.jpg'))).toBe(false)
  })
})
