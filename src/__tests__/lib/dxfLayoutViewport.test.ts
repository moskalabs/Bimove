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

function layoutEntity(
  name: string,
  tabOrder: number,
  opts: { psltscale?: boolean; blockRecord?: string } = {},
) {
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
    // 330 = 이 레이아웃의 BLOCK_RECORD 핸들. ENTITIES 섹션의 뷰포트는
    // 이 핸들로 소유 레이아웃을 찾는다.
    ...(opts.blockRecord ? [330, opts.blockRecord] : []),
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

function buildDxf(
  layouts: string[],
  blocks: { name: string; entities: string[] }[],
  entities: string[] = [],
) {
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
    dxf(0, 'SECTION', 2, 'ENTITIES'),
    ...entities,
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

// ── ENTITIES 섹션의 종이공간 뷰포트 ──
//
// 실제 파일에서 터진 버그: 레이아웃 "평면도" 가 페이지로 안 만들어졌다.
// `*Paper_Space→평면도` 매핑은 맞는데 그 블록 정의 안엔 VIEWPORT 가 0개였다.
// DXF 는 **저장 당시 활성 레이아웃**의 종이공간 엔티티를 BLOCKS 가 아니라
// ENTITIES 섹션에 (67=1 로) 쓰기 때문이다. BLOCKS 만 뒤지면 활성 레이아웃은
// 항상 "뷰포트 없음" 이 된다.
describe('ENTITIES 섹션 VIEWPORT', () => {
  /** ENTITIES 섹션에 놓는 종이공간 뷰포트. 67=1 + 330(소유 BLOCK_RECORD) */
  function paperSpaceEntityVp(v: {
    owner?: string; id?: number; cx: number; cy: number
    w: number; h: number; viewH: number; paperFlag?: number
  }) {
    return dxf(
      0, 'VIEWPORT',
      10, 210, 20, 148.5,
      40, v.w, 41, v.h,
      12, v.cx, 22, v.cy,
      17, 0, 27, 0,
      45, v.viewH,
      67, v.paperFlag ?? 1,
      69, v.id ?? 0,
      ...(v.owner ? [330, v.owner] : []),
    )
  }

  it('330 으로 소유 레이아웃을 찾아 clip 을 만든다', () => {
    const text = buildDxf(
      [
        layoutEntity('Model', 0),
        layoutEntity('평면도', 1, { blockRecord: 'D2' }),
        layoutEntity('천정도', 2, { blockRecord: 'D6' }),
      ],
      // 활성 레이아웃(평면도)의 블록 정의는 비어 있다 — 실제 파일이 이랬다.
      [{ name: '*Paper_Space', entities: [] }],
      [paperSpaceEntityVp({ owner: 'D2', cx: 50000, cy: 30000, w: 200, h: 100, viewH: 4000 })],
    )

    const { viewportsByLayout } = extractLayoutsAndViewports(text)
    const vps = viewportsByLayout.get('평면도') ?? []
    expect(vps).toHaveLength(1)
    expect(vps[0].viewWidth).toBe(8000)      // 4000 * (200/100)
    expect(vps[0].clipMinX).toBe(46000)
    expect(vps[0].clipMaxY).toBe(32000)
    // 남의 레이아웃에 새지 않는다
    expect(viewportsByLayout.get('천정도') ?? []).toHaveLength(0)
  })

  // 67 이 없는 VIEWPORT 는 모형공간 활성 뷰 설정 레코드다. 레이아웃의 창이
  // 아니니 clip 으로 쓰면 도면이 엉뚱하게 잘린다.
  it('67(종이공간 플래그) 이 없는 VIEWPORT 는 무시한다', () => {
    const text = buildDxf(
      [layoutEntity('Model', 0), layoutEntity('평면도', 1, { blockRecord: 'D2' })],
      [],
      [paperSpaceEntityVp({
        owner: 'D2', cx: 50000, cy: 30000, w: 200, h: 100, viewH: 4000, paperFlag: 0,
      })],
    )

    expect(extractLayoutsAndViewports(text).viewportsByLayout.size).toBe(0)
  })

  // 330 은 DXF 버전/변환기에 따라 빠질 수 있다. 그때는 이름 규칙으로
  // 폴백한다 — *Paper_Space 가 (탭 순서가 아니라) 활성 레이아웃의 블록이다.
  it('330 이 없으면 *Paper_Space 레이아웃으로 폴백한다', () => {
    const text = buildDxf(
      [layoutEntity('Model', 0), layoutEntity('평면도', 1), layoutEntity('천정도', 2)],
      [],
      [paperSpaceEntityVp({ cx: 1000, cy: 2000, w: 200, h: 100, viewH: 4000 })],
    )

    const { viewportsByLayout } = extractLayoutsAndViewports(text)
    expect(viewportsByLayout.get('평면도')?.[0].centerX).toBe(1000)
    expect(viewportsByLayout.get('천정도') ?? []).toHaveLength(0)
  })

  // 의사 뷰포트 판별이 "그 레이아웃의 첫 번째" 를 쓴다. 활성 레이아웃은
  // 블록이 비어 있어 둘 다 ENTITIES 에서 나오므로, 순번 카운터가 두 스캔에
  // 걸쳐 이어지지 않으면 첫 뷰포트만 보고 둘 다 버리거나 둘 다 살린다.
  it('ENTITIES 안에서도 첫 뷰포트만 의사로 버린다', () => {
    const text = buildDxf(
      [layoutEntity('Model', 0), layoutEntity('평면도', 1, { blockRecord: 'D2' })],
      [],
      [
        // 45 ≈ 41 + target 원점 → 의사
        paperSpaceEntityVp({ owner: 'D2', cx: 210, cy: 148.5, w: 420, h: 297, viewH: 297 }),
        paperSpaceEntityVp({ owner: 'D2', cx: 50000, cy: 30000, w: 200, h: 100, viewH: 4000 }),
      ],
    )

    const vps = extractLayoutsAndViewports(text).viewportsByLayout.get('평면도') ?? []
    expect(vps).toHaveLength(1)
    expect(vps[0].centerX).toBe(50000)
  })

  // 블록 안 의사 뷰포트가 1번을 먹었으면 ENTITIES 의 것은 2번째다.
  it('블록 스캔과 뷰포트 순번을 공유한다', () => {
    const text = buildDxf(
      [layoutEntity('Model', 0), layoutEntity('평면도', 1, { blockRecord: 'D2' })],
      [{ name: '*Paper_Space', entities: [pseudoViewport()] }],
      // 1:1 축척 + target 원점 — 기하 조건만 보면 의사와 똑같다.
      // 순번이 2번째라서 살아남아야 한다.
      [paperSpaceEntityVp({ owner: 'D2', cx: 100, cy: 60, w: 180, h: 120, viewH: 120 })],
    )

    const vps = extractLayoutsAndViewports(text).viewportsByLayout.get('평면도') ?? []
    expect(vps).toHaveLength(1)
    expect(vps[0].clipMinX).toBeCloseTo(10, 3)
  })

  // 회귀: 본문을 줄바꿈+"0"+줄바꿈 으로 자르면 code 68(status) 값이 0 일 때
  // 엔티티가 거기서 끊겨 뒤의 45/67/330 을 못 읽는다 → 뷰포트가 사라진다.
  // 실제 파일의 VIEWPORT 가 `68=0` 을 갖고 있다.
  it('code 68 이 0 이어도 뒤쪽 45/67/330 을 읽는다', () => {
    const text = buildDxf(
      [layoutEntity('Model', 0), layoutEntity('평면도', 1, { blockRecord: 'D2' })],
      [],
      [dxf(
        0, 'VIEWPORT',
        10, 210, 20, 148.5,
        40, 200, 41, 100,
        68, 0,
        12, 7000, 22, 8000,
        17, 0, 27, 0,
        45, 4000,
        67, 1,
        69, 0,
        330, 'D2',
      )],
    )

    const vps = extractLayoutsAndViewports(text).viewportsByLayout.get('평면도') ?? []
    expect(vps).toHaveLength(1)
    expect(vps[0].centerX).toBe(7000)
    expect(vps[0].viewHeight).toBe(4000)
  })
})

describe('의사 뷰포트 판별 — 기하 휴리스틱의 범위', () => {
  /** id 가 1 이 아닌(DWG→DXF 변환기가 0 으로 쓰는) 종이 의사 뷰포트 */
  function pseudoViewportNoId() {
    return dxf(
      0, 'VIEWPORT',
      69, 0,
      12, 210, 22, 148.5,
      17, 0, 27, 0,          // view target = 원점
      40, 420, 41, 297,
      45, 297,               // 45 ≈ 41 → 1:1
    )
  }

  /** 1:1 축척으로 원점 근처를 비추는 **정상** 뷰포트 (상세도) */
  function unityScaleRealViewport() {
    return dxf(
      0, 'VIEWPORT',
      69, 0,
      12, 100, 22, 60,
      17, 0, 27, 0,
      40, 180, 41, 120,
      45, 120,               // 역시 45 ≈ 41 — 기하 조건만으로는 의사와 구분 불가
    )
  }

  it('id 가 0 이어도 블록 안 첫 뷰포트면 의사로 보고 버린다', () => {
    const dxfText = buildDxf(
      [layoutEntity('Model', 0), layoutEntity('평면도', 1)],
      [{ name: '*Paper_Space', entities: [pseudoViewportNoId()] }],
    )
    const { viewportsByLayout } = extractLayoutsAndViewports(dxfText)
    expect(viewportsByLayout.get('평면도') ?? []).toHaveLength(0)
  })

  it('의사 뷰포트 뒤에 오는 1:1 정상 뷰포트는 살린다', () => {
    const dxfText = buildDxf(
      [layoutEntity('Model', 0), layoutEntity('평면도', 1)],
      [{ name: '*Paper_Space', entities: [pseudoViewportNoId(), unityScaleRealViewport()] }],
    )
    const { viewportsByLayout } = extractLayoutsAndViewports(dxfText)
    const vps = viewportsByLayout.get('평면도') ?? []
    expect(vps).toHaveLength(1)
    // 12/22 ± view 크기의 절반 — 180x120 이 아니라 41(=120) 기준 폭 180
    expect(vps[0].clipMinX).toBeCloseTo(100 - 90, 3)
    expect(vps[0].clipMaxY).toBeCloseTo(60 + 60, 3)
  })

  it('블록이 바뀌면 "첫 뷰포트" 카운트가 다시 시작된다', () => {
    const dxfText = buildDxf(
      [layoutEntity('Model', 0), layoutEntity('평면도', 1), layoutEntity('천정도', 2)],
      [
        { name: '*Paper_Space', entities: [pseudoViewportNoId(), unityScaleRealViewport()] },
        { name: '*Paper_Space0', entities: [pseudoViewportNoId(), unityScaleRealViewport()] },
      ],
    )
    const { viewportsByLayout } = extractLayoutsAndViewports(dxfText)
    expect(viewportsByLayout.get('평면도') ?? []).toHaveLength(1)
    expect(viewportsByLayout.get('천정도') ?? []).toHaveLength(1)
  })

  it('code 69 == 1 이면 몇 번째든 의사로 본다', () => {
    const dxfText = buildDxf(
      [layoutEntity('Model', 0), layoutEntity('평면도', 1)],
      [{ name: '*Paper_Space', entities: [
        realViewport({ id: 2, cx: 5000, cy: 3000, w: 400, h: 280, viewH: 28000 }),
        pseudoViewport(),
      ] }],
    )
    const { viewportsByLayout } = extractLayoutsAndViewports(dxfText)
    expect(viewportsByLayout.get('평면도') ?? []).toHaveLength(1)
  })
})
