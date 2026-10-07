/**
 * extractLayoutsAndViewports — 레이아웃 탭 / 뷰포트 clip 추출.
 *
 * 여기서 잡으려는 버그: 레이아웃 페이지가 통째로 비거나, 반대로
 * 오토캐드에서 탭으로 나뉘어 있던 게 1페이지에 다 쏟아지는 증상.
 * 둘 다 "clip 사각형을 잘못 만들었다"에서 나왔다.
 */
import { describe, it, expect } from 'vitest'
import { extractLayoutsAndViewports } from '../../components/CadPreview'

/** group code / value 쌍을 DXF 줄로 */
function dxf(...pairs: (string | number)[]): string {
  const out: string[] = []
  for (let i = 0; i < pairs.length; i += 2) {
    out.push(String(pairs[i]), String(pairs[i + 1]))
  }
  return out.join('\n')
}

function layoutEntity(name: string, tabOrder: number, opts: { psltscale?: boolean } = {}) {
  return dxf(
    0, 'LAYOUT',
    100, 'AcDbPlotSettings',
    100, 'AcDbLayout',
    1, name,
    70, opts.psltscale ? 1 : 0,   // 모델공간 플래그가 아니다 — PSLTSCALE 이다
    71, tabOrder,
    44, 420,
    45, 297,
    // 종이공간 limits — 모델 좌표가 아니다. clip 으로 새면 안 된다.
    14, 0, 24, 0, 15, 420, 25, 297,
  )
}

/** 종이공간 의사 뷰포트: 오토캐드가 모든 레이아웃에 자동으로 넣는 ID 1 */
function pseudoViewport() {
  return dxf(
    0, 'VIEWPORT',
    69, 1,
    12, 210, 22, 148.5,
    40, 420, 41, 297,
    45, 297,
  )
}

function realViewport(v: {
  id: number; cx: number; cy: number; w: number; h: number; viewH: number
}) {
  return dxf(
    0, 'VIEWPORT',
    69, v.id,
    12, v.cx, 22, v.cy,
    40, v.w, 41, v.h,
    45, v.viewH,
  )
}

function buildDxf(layouts: string[], blocks: { name: string; entities: string[] }[]) {
  const blockBodies = blocks.map(b => [
    dxf(0, 'BLOCK', 2, b.name),
    ...b.entities,
    dxf(0, 'ENDBLK'),
  ].join('\n'))

  return [
    // 앞에 다른 섹션이 하나 있어야 한다 — 파서가 줄바꿈 + "0" + 줄바꿈 + "SECTION"
    // 을 찾으므로 파일 맨 앞(byte 0)에 붙은 섹션은 못 찾는다.
    // 실제 DXF 도 HEADER 가 먼저 온다.
    // 파일 맨 앞(byte 0)에 붙은 섹션은 못 찾는다. 실제 DXF 도 HEADER 가 먼저다.
    dxf(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1027'),
    dxf(0, 'ENDSEC'),
    dxf(0, 'SECTION', 2, 'BLOCKS'),
    ...blockBodies,
    dxf(0, 'ENDSEC'),
    dxf(0, 'SECTION', 2, 'OBJECTS'),
    ...layouts,
    dxf(0, 'ENDSEC'),
    dxf(0, 'EOF'),
  ].join('\n')
}

describe('extractLayoutsAndViewports', () => {
  it('Model + 레이아웃 두 개를 탭 순서대로 읽는다', () => {
    const text = buildDxf([
      layoutEntity('배치2', 2),
      layoutEntity('Model', 0),
      layoutEntity('배치1', 1),
    ], [])

    const { layouts } = extractLayoutsAndViewports(text)
    expect(layouts.map(l => l.name)).toEqual(['Model', '배치1', '배치2'])
    expect(layouts[0].isModelSpace).toBe(true)
    expect(layouts[1].isModelSpace).toBe(false)
  })

  it('실제 뷰포트의 clip 은 model space 중심 ± view 크기', () => {
    const text = buildDxf([
      layoutEntity('Model', 0),
      layoutEntity('배치1', 1),
    ], [
      { name: '*Paper_Space', entities: [
        pseudoViewport(),
        realViewport({ id: 2, cx: 50000, cy: 30000, w: 200, h: 100, viewH: 4000 }),
      ] },
    ])

    const { viewportsByLayout } = extractLayoutsAndViewports(text)
    const vps = viewportsByLayout.get('배치1')
    expect(vps).toHaveLength(1)
    const [vp] = vps!
    expect(vp.viewHeight).toBe(4000)
    expect(vp.viewWidth).toBe(8000)   // 4000 * (200/100)
    expect(vp.clipMinX).toBe(46000)
    expect(vp.clipMaxX).toBe(54000)
    expect(vp.clipMinY).toBe(28000)
    expect(vp.clipMaxY).toBe(32000)
  })

  // 핵심 회귀: 의사 뷰포트 하나만 있으면 전엔 그게 clip 이 되어
  // (0,0)~(420,297) 짜리 종이 상자로 모델을 잘라버렸다 → 페이지가 빈다.
  it('종이공간 의사 뷰포트(ID 1)만 있는 레이아웃은 clip 을 만들지 않는다', () => {
    const text = buildDxf([
      layoutEntity('Model', 0),
      layoutEntity('배치1', 1),
    ], [
      { name: '*Paper_Space', entities: [pseudoViewport()] },
    ])

    const { layouts, viewportsByLayout } = extractLayoutsAndViewports(text)
    expect(layouts.map(l => l.name)).toEqual(['Model', '배치1'])
    expect(viewportsByLayout.get('배치1') ?? []).toHaveLength(0)
  })

  // 전엔 여기서 EXTMIN/EXTMAX(종이 치수)로 clip 을 합성했다.
  it('뷰포트가 아예 없는 레이아웃도 종이 치수로 clip 을 합성하지 않는다', () => {
    const text = buildDxf([
      layoutEntity('Model', 0),
      layoutEntity('배치1', 1),
    ], [])

    const { viewportsByLayout } = extractLayoutsAndViewports(text)
    expect(viewportsByLayout.size).toBe(0)
  })

  it('*Paper_Space / *Paper_Space0 가 탭 순서대로 레이아웃에 매핑된다', () => {
    const text = buildDxf([
      layoutEntity('Model', 0),
      layoutEntity('배치1', 1),
      layoutEntity('배치2', 2),
    ], [
      { name: '*Paper_Space', entities: [
        realViewport({ id: 2, cx: 100, cy: 100, w: 100, h: 100, viewH: 1000 }),
      ] },
      { name: '*Paper_Space0', entities: [
        realViewport({ id: 2, cx: 900, cy: 900, w: 100, h: 100, viewH: 2000 }),
      ] },
    ])

    const { viewportsByLayout } = extractLayoutsAndViewports(text)
    expect(viewportsByLayout.get('배치1')?.[0].centerX).toBe(100)
    expect(viewportsByLayout.get('배치2')?.[0].centerX).toBe(900)
  })

  // 회귀: 전엔 줄바꿈+"0"+줄바꿈 으로 엔티티를 잘랐는데, LAYOUT 의
  // code 70 값이 0 (= 종이 레이아웃) 이면 바로 거기서 끊겨서 뒤따르는
  // 71/44/45 를 못 읽었다. 탭 순서가 전부 0 이 되면 *Paper_Space 매핑이
  // 어긋나 엉뚱한 페이지에 clip 이 붙는다.
  it('code 70 값이 0 이어도 탭 순서와 종이 크기를 읽는다', () => {
    const text = buildDxf([
      layoutEntity('Model', 0),
      layoutEntity('배치1', 1),
      layoutEntity('배치2', 2),
    ], [])

    const { layouts } = extractLayoutsAndViewports(text)
    expect(layouts.map(l => l.tabOrder)).toEqual([0, 1, 2])
    expect(layouts[1].paperWidth).toBe(420)
    expect(layouts[1].paperHeight).toBe(297)
  })

  // 같은 이유로 VIEWPORT 의 code 68(status) 이 0 이면 그 뒤의 45/69 가
  // 날아가서 뷰포트가 통째로 사라졌다.
  it('VIEWPORT 의 code 68 이 0 이어도 뒤쪽 45/69 를 읽는다', () => {
    const vpWithStatus = [
      0, 'VIEWPORT',
      10, 210, 20, 148.5,
      68, 0,
      69, 2,
      12, 1000, 22, 2000,
      40, 100, 41, 50,
      45, 500,
    ]
    const text = buildDxf([
      layoutEntity('Model', 0),
      layoutEntity('배치1', 1),
    ], [
      { name: '*Paper_Space', entities: [dxf(...vpWithStatus)] },
    ])

    const vps = extractLayoutsAndViewports(text).viewportsByLayout.get('배치1')
    expect(vps).toHaveLength(1)
    expect(vps![0].centerX).toBe(1000)
    expect(vps![0].viewHeight).toBe(500)
  })
  it('레이아웃이 Model 하나뿐이면 빈 결과', () => {
    const text = buildDxf([layoutEntity('Model', 0)], [])
    const { layouts, viewportsByLayout } = extractLayoutsAndViewports(text)
    expect(layouts).toHaveLength(0)
    expect(viewportsByLayout.size).toBe(0)
  })
  // ── 모형 탭 판별 ──
  //
  // 핵심 회귀: 전엔 code 70 의 비트 1 을 모델공간 플래그로 읽었다. 실제로는
  // PSLTSCALE 이라서, PSLTSCALE 가 켜진 종이 레이아웃이 모형으로 잡혔다.
  // 그러면 ImportPanel 이 clip 없이 임포트해서 모델공간 전체가 그 페이지에
  // 그대로 복사된다 — 오토캐드에서 탭으로 나뉘어 있던 게 페이지마다 똑같이
  // 다 들어가던 증상이 이거다.
  it('code 70 비트 1(PSLTSCALE) 이 켜진 종이 레이아웃을 모형으로 보지 않는다', () => {
    const text = buildDxf([
      layoutEntity('Model', 0),
      layoutEntity('배치1', 1, { psltscale: true }),
      layoutEntity('Layout1', 2, { psltscale: true }),
    ], [])

    const { layouts } = extractLayoutsAndViewports(text)
    expect(layouts.map(l => [l.name, l.isModelSpace])).toEqual([
      ['Model', true],
      ['배치1', false],
      ['Layout1', false],
    ])
  })

  it("code 70 이 0 이어도 'Model' 은 모형이다", () => {
    const text = buildDxf([
      layoutEntity('Model', 0),
      layoutEntity('배치1', 1),
    ], [])

    expect(extractLayoutsAndViewports(text).layouts[0].isModelSpace).toBe(true)
  })

  it("'MODEL' / '모형' 도 모형으로 받는다", () => {
    for (const name of ['MODEL', '모형', ' model ']) {
      const text = buildDxf([
        layoutEntity(name, 0),
        layoutEntity('배치1', 1),
      ], [])
      const { layouts } = extractLayoutsAndViewports(text)
      expect(layouts.find(l => l.name.trim() === name.trim())?.isModelSpace).toBe(true)
      expect(layouts.find(l => l.name === '배치1')?.isModelSpace).toBe(false)
    }
  })

  // 모형이 하나도 없으면 모형 페이지가 아예 안 만들어진다 — 도면이 통째로
  // 사라지는 쪽이라 전체 복사보다 나쁘다. 탭 순서 맨 앞을 모형으로 본다.
  it('모형 이름이 하나도 없으면 탭 순서 맨 앞을 모형으로 본다', () => {
    const text = buildDxf([
      layoutEntity('배치1', 1),
      layoutEntity('배치2', 2),
    ], [])

    const { layouts } = extractLayoutsAndViewports(text)
    expect(layouts.map(l => [l.name, l.isModelSpace])).toEqual([
      ['배치1', true],
      ['배치2', false],
    ])
  })
})
