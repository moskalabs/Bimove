/**
 * dxf-shared.ts — DXF 파싱에서 공유되는 유틸리티
 *
 * CadPreview, dxf-fast-worker, dxf.ts 등에서 중복되던 코드를 통합.
 * Web Worker에서도 사용 가능하도록 DOM 의존성 없음.
 */

// ── ACI (AutoCAD Color Index) → hex (full 256-color table) ──

export const ACI_TO_HEX: Record<number, string> = {
  1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff',
  5: '#0000ff', 6: '#ff00ff', 7: '#000000', 8: '#808080', 9: '#c0c0c0',
  10: '#ff0000', 11: '#ff7f7f', 12: '#cc0000', 13: '#cc6666', 14: '#990000',
  15: '#994c4c', 16: '#7f0000', 17: '#7f3f3f', 18: '#4c0000', 19: '#4c2626',
  20: '#ff3f00', 21: '#ff9f7f', 22: '#cc3200', 23: '#cc7f66', 24: '#992600',
  25: '#995f4c', 26: '#7f1f00', 27: '#7f4f3f', 28: '#4c1300', 29: '#4c2f26',
  30: '#ff7f00', 31: '#ffbf7f', 32: '#cc6500', 33: '#cc9966', 34: '#994c00',
  35: '#99724c', 36: '#7f3f00', 37: '#7f5f3f', 38: '#4c2600', 39: '#4c3926',
  40: '#ffbf00', 41: '#ffdf7f', 42: '#cc9900', 43: '#ccb266', 44: '#997200',
  45: '#99854c', 46: '#7f5f00', 47: '#7f6f3f', 48: '#4c3900', 49: '#4c4226',
  50: '#ffff00', 51: '#ffff7f', 52: '#cccc00', 53: '#cccc66', 54: '#999900',
  55: '#99994c', 56: '#7f7f00', 57: '#7f7f3f', 58: '#4c4c00', 59: '#4c4c26',
  60: '#bfff00', 61: '#dfff7f', 62: '#99cc00', 63: '#b2cc66', 64: '#729900',
  65: '#85994c', 66: '#5f7f00', 67: '#6f7f3f', 68: '#394c00', 69: '#424c26',
  70: '#7fff00', 71: '#bfff7f', 72: '#65cc00', 73: '#99cc66', 74: '#4c9900',
  75: '#72994c', 76: '#3f7f00', 77: '#5f7f3f', 78: '#264c00', 79: '#394c26',
  80: '#3fff00', 81: '#9fff7f', 82: '#32cc00', 83: '#7fcc66', 84: '#269900',
  85: '#5f994c', 86: '#1f7f00', 87: '#4f7f3f', 88: '#134c00', 89: '#2f4c26',
  90: '#00ff00', 91: '#7fff7f', 92: '#00cc00', 93: '#66cc66', 94: '#009900',
  95: '#4c994c', 96: '#007f00', 97: '#3f7f3f', 98: '#004c00', 99: '#264c26',
  100: '#00ff3f', 101: '#7fff9f', 102: '#00cc32', 103: '#66cc7f', 104: '#009926',
  105: '#4c995f', 106: '#007f1f', 107: '#3f7f4f', 108: '#004c13', 109: '#264c2f',
  110: '#00ff7f', 111: '#7fffbf', 112: '#00cc65', 113: '#66cc99', 114: '#00994c',
  115: '#4c9972', 116: '#007f3f', 117: '#3f7f5f', 118: '#004c26', 119: '#264c39',
  120: '#00ffbf', 121: '#7fffdf', 122: '#00cc99', 123: '#66ccb2', 124: '#009972',
  125: '#4c9985', 126: '#007f5f', 127: '#3f7f6f', 128: '#004c39', 129: '#264c42',
  130: '#00ffff', 131: '#7fffff', 132: '#00cccc', 133: '#66cccc', 134: '#009999',
  135: '#4c9999', 136: '#007f7f', 137: '#3f7f7f', 138: '#004c4c', 139: '#264c4c',
  140: '#00bfff', 141: '#7fdfff', 142: '#0099cc', 143: '#66b2cc', 144: '#007299',
  145: '#4c8599', 146: '#005f7f', 147: '#3f6f7f', 148: '#00394c', 149: '#26424c',
  150: '#007fff', 151: '#7fbfff', 152: '#0065cc', 153: '#6699cc', 154: '#004c99',
  155: '#4c7299', 156: '#003f7f', 157: '#3f5f7f', 158: '#00264c', 159: '#26394c',
  160: '#003fff', 161: '#7f9fff', 162: '#0032cc', 163: '#667fcc', 164: '#002699',
  165: '#4c5f99', 166: '#001f7f', 167: '#3f4f7f', 168: '#00134c', 169: '#262f4c',
  170: '#0000ff', 171: '#7f7fff', 172: '#0000cc', 173: '#6666cc', 174: '#000099',
  175: '#4c4c99', 176: '#00007f', 177: '#3f3f7f', 178: '#00004c', 179: '#26264c',
  180: '#3f00ff', 181: '#9f7fff', 182: '#3200cc', 183: '#7f66cc', 184: '#260099',
  185: '#5f4c99', 186: '#1f007f', 187: '#4f3f7f', 188: '#13004c', 189: '#2f264c',
  190: '#7f00ff', 191: '#bf7fff', 192: '#6500cc', 193: '#9966cc', 194: '#4c0099',
  195: '#724c99', 196: '#3f007f', 197: '#5f3f7f', 198: '#26004c', 199: '#39264c',
  200: '#bf00ff', 201: '#df7fff', 202: '#9900cc', 203: '#b266cc', 204: '#720099',
  205: '#854c99', 206: '#5f007f', 207: '#6f3f7f', 208: '#39004c', 209: '#42264c',
  210: '#ff00ff', 211: '#ff7fff', 212: '#cc00cc', 213: '#cc66cc', 214: '#990099',
  215: '#994c99', 216: '#7f007f', 217: '#7f3f7f', 218: '#4c004c', 219: '#4c264c',
  220: '#ff00bf', 221: '#ff7fdf', 222: '#cc0099', 223: '#cc66b2', 224: '#990072',
  225: '#994c85', 226: '#7f005f', 227: '#7f3f6f', 228: '#4c0039', 229: '#4c2642',
  230: '#ff007f', 231: '#ff7fbf', 232: '#cc0065', 233: '#cc6699', 234: '#99004c',
  235: '#994c72', 236: '#7f003f', 237: '#7f3f5f', 238: '#4c0026', 239: '#4c2639',
  240: '#ff003f', 241: '#ff7f9f', 242: '#cc0032', 243: '#cc667f', 244: '#990026',
  245: '#994c5f', 246: '#7f001f', 247: '#7f3f4f', 248: '#4c0013', 249: '#4c262f',
  250: '#333333', 251: '#505050', 252: '#696969', 253: '#808080',
  254: '#bebebe', 255: '#ffffff',
}

/** ACI index → hex color (full 256 table) */
export function aciToHex(idx: number): string | undefined {
  if (idx <= 0 || idx > 255) return undefined
  return ACI_TO_HEX[idx]
}

/** True color (24-bit int) → hex string */
export function trueColorToHex(tc: number): string {
  const r = (tc >> 16) & 0xff, g = (tc >> 8) & 0xff, b = tc & 0xff
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

// ── Padding detection ──

/** DXF 패딩 감지: 첫 바이트 체크 + 999 주석 fallback */
export function detectPadding(dxfText: string): boolean {
  return dxfText.charCodeAt(0) === 32 || dxfText.indexOf('\n  0\nSECTION') >= 0
}

/** 패딩 유무에 따른 그룹 코드 포맷터 */
export function makeGcFormatter(padded: boolean): (c: number) => string {
  return padded ? (c: number) => String(c).padStart(3) : (c: number) => String(c)
}

// ── Text decoding ──

/** DXF 특수문자 코드(%%X) → 유니코드 변환 */
export function decodeDxfSpecialChars(text: string): string {
  return text
    .replace(/%%[Pp]/g, '±')
    .replace(/%%[Dd]/g, '°')
    .replace(/%%[Cc]/g, '∅')
    .replace(/%%[Uu]/g, '')
    .replace(/%%[Oo]/g, '')
    .replace(/%%%/g, '%')
    .replace(/%%(\d{3})/g, (_, code) => String.fromCharCode(parseInt(code)))
}

/** MTEXT 서식 코드 제거 */
export function cleanMtextFormatting(text: string): string {
  return text
    .replace(/\\P/g, '\n')                        // 문단 구분 → 줄바꿈 (SVG tspan으로 렌더링)
    .replace(/\\S([^;]*);/g, (_, s) =>             // 적층/분수: \S1/2; → 1/2 (내용 보존)
      s.replace(/[#^]/g, '/'))
    .replace(/\\[a-zA-Z][^;]*;/g, '')              // 서식 코드 제거: \H..; \f..; \p..; 등
    .replace(/\\[OoLlKk]/g, '')                    // 단문자 서식: 취소선/밑줄/윗줄
    .replace(/\\~/g, ' ')                           // 줄바꿈 방지 공백
    .replace(/[{}]/g, '')                           // 그룹핑 괄호만 제거 (내용 보존!)
    .trim()
}

// ── DXF Layout / Viewport 타입 ──

/** AutoCAD Layout 정의 (OBJECTS 섹션의 LAYOUT 엔티티) */
export interface DxfLayout {
  name: string           // "Model", "A4", "plan", "elv (01)" 등
  /** 모형 탭인가. code 70 로는 알 수 없어서 이름으로 가린다 — isModelSpaceLayout() 참고. */
  isModelSpace: boolean
  tabOrder: number       // code 71
  paperWidth: number     // code 44 (mm)
  paperHeight: number    // code 45 (mm)
  // 아래 네 개는 **종이공간 limits** 다 (code 14/24 = min, 15/25 = max).
  // 모델공간 범위가 아니다 — 모델 좌표 clip 으로 쓰면 안 된다.
  extMinX?: number       // code 14 — paper space limits min X
  extMinY?: number       // code 24 — paper space limits min Y
  extMaxX?: number       // code 15 — paper space limits max X
  extMaxY?: number       // code 25 — paper space limits max Y
  /** 이 레이아웃의 종이공간 BLOCK 이름 (`*Paper_Space`, `*Paper_Space0` ...).
   *  저장 당시 활성 탭이었던 레이아웃은 종이공간 엔티티가 ENTITIES 섹션에
   *  (code 67=1 로) 들어 있고 이 블록은 비어 있다. 나머지 탭은 반대다.
   *  둘 다 읽어야 탭마다 제 도면틀이 들어온다. */
  blockName?: string | null
}

/** 모형(Model) 탭인지 레이아웃 이름으로 판별한다.
 *
 *  전엔 `((code70 ?? 0) & 1) !== 0` 으로 봤는데, LAYOUT 의 code 70 은
 *  모델공간 플래그가 아니다 — PSLTSCALE(비트 1) / LIMCHECK(비트 2) 다.
 *  그래서 PSLTSCALE 가 켜진 종이 레이아웃이 모형으로 잡혔고, 뷰포트 clip
 *  없이 모델공간 전체가 그 페이지에 그대로 복사됐다. 오토캐드에서 탭으로
 *  나뉘어 있던 도면이 페이지마다 똑같이 다 들어가던 원인이다.
 *
 *  DXF 는 모형 레이아웃 이름을 'Model' 로 고정해서 쓴다 (한글판에서 탭이
 *  '모형' 으로 보이는 건 화면 표시용이다). 손으로 고친 파일이나 다른 CAD
 *  가 내보낸 것까지 감안해서 '모형' 도 같이 받는다.
 *
 *  정석은 code 330 으로 BLOCK_RECORD 를 따라가 *Model_Space 인지 보는
 *  것이지만, 그러려면 핸들 테이블을 다 들고 있어야 한다. */
export function isModelSpaceLayout(name: string): boolean {
  const n = name.trim().toLowerCase()
  return n === 'model' || n === '모형'
}

/** VIEWPORT의 Model Space 클리핑 영역 */
export interface DxfViewport {
  layoutName: string
  centerX: number        // model space view center (code 12)
  centerY: number        // model space view center (code 22)
  viewWidth: number      // computed: viewHeight * (vpWidth / vpHeight)
  viewHeight: number     // model space view height (code 45)
  clipMinX: number       // centerX - viewWidth/2
  clipMinY: number       // centerY - viewHeight/2
  clipMaxX: number       // centerX + viewWidth/2
  clipMaxY: number       // centerY + viewHeight/2
  // 아래 네 개는 **종이 위의 창** 이다 (code 10/20 = 중심, 40/41 = 크기).
  // 위의 clip* 은 그 창이 비추는 모델공간 영역이고, 이건 창 자체의 위치다.
  paperCX: number        // code 10
  paperCY: number        // code 20
  paperW: number         // code 40
  paperH: number         // code 41
  /** 이 창에서 **동결된 레이어** 이름 (소문자). gc 331 참고.
   *  없거나 빈 배열이면 전부 보인다. */
  frozenLayers?: string[]
}

/** Viewport 기반 클리핑 영역 */
export type ViewportClip = { minX: number; minY: number; maxX: number; maxY: number }

/**
 * 뷰포트 하나의 **모델 → 종이** 사상.
 *
 * 종이 탭에는 도면틀만 있고 평면도는 없다. 평면도는 모델공간에 있고,
 * 뷰포트가 그걸 축척을 걸어 종이 위 창에 비춘다. 그 창 안으로 모델 도형을
 * 끌어오려면 좌표를 이렇게 옮긴다:
 *
 *   paperX = paperCX + (modelX - modelCX) * scale
 *
 * 그리고 종이 좌표의 창 사각형으로 잘라낸다 — 안 자르면 평면도가 도면틀
 * 밖으로 흘러넘쳐 표제란을 덮는다.
 */
export interface ViewportProjection {
  /** 종이 위 창 (mm) */
  paperCX: number; paperCY: number; paperW: number; paperH: number
  /** 이 창이 비추는 모델공간 중심 (gc 17+12 / 27+22) */
  modelCX: number; modelCY: number
  /** 종이 단위 / 모델 단위 = gc 41 / gc 45 */
  scale: number
  /**
   * 이 창에서만 끈 레이어 (소문자 이름).
   *
   * 오토캐드는 레이아웃마다 "이 창에서는 이 레이어를 안 보이게" 를 따로
   * 갖는다 (VP freeze). 같은 평면을 두 번 비춰 놓고 한쪽은 천장, 다른 쪽은
   * 바닥만 보여주는 식이다. 이걸 무시하면 두 창에 **모든 레이어가 겹쳐**
   * 들어와 조명 심볼과 천장 글자가 평면도 위에 올라앉는다.
   *
   * Set 이 아니라 배열인 이유: 이 객체는 ParseSpace 에 실려 워커로
   * postMessage 된다. 구조화 복제는 Set 도 나르지만, 배열이 JSON 경로가
   * 섞여도 안전하다. 조회용 Set 은 쓰는 쪽에서 한 번 만든다.
   */
  frozenLayers?: string[]
}

/** DxfViewport → 모델→종이 사상. 축척을 못 구하면 null. */
export function toViewportProjection(vp: DxfViewport): ViewportProjection | null {
  // viewHeight 는 parseViewportEntity 가 이미 > 0 을 보장하지만, 이 함수는
  // 테스트/외부에서도 불린다. 0 이면 scale 이 Infinity 가 되어 좌표가 전부
  // NaN 으로 번진다 — 그 전에 끊는다.
  if (!(vp.viewHeight > 0) || !(vp.paperH > 0) || !(vp.paperW > 0)) return null
  return {
    paperCX: vp.paperCX, paperCY: vp.paperCY, paperW: vp.paperW, paperH: vp.paperH,
    modelCX: vp.centerX, modelCY: vp.centerY,
    scale: vp.paperH / vp.viewHeight,
    frozenLayers: vp.frozenLayers,
  }
}

/** 종이 탭의 시트 범위 (종이 좌표, mm). ParseSpace 의 `sheet` 참고. */
export interface SheetRect { minX: number; minY: number; maxX: number; maxY: number }

/**
 * LAYOUT limits 를 시트 범위로 꺼낸다.
 *
 * 넷 다 있고 가로·세로가 양수여야 쓴다. DWG→DXF 변환물에 0,0~0,0 이 그대로
 * 남아 있는 파일이 있고, 그걸 시트로 믿으면 도형을 전부 잘라낸다.
 */
export function sheetRect(layout: DxfLayout): SheetRect | null {
  const { extMinX: a, extMinY: b, extMaxX: c, extMaxY: d } = layout
  if (a == null || b == null || c == null || d == null) return null
  if (!(c > a) || !(d > b)) return null
  return { minX: a, minY: b, maxX: c, maxY: d }
}

/**
 * 파서가 DXF 의 **어느 공간**을 읽을 것인가.
 *
 * DXF 의 ENTITIES 섹션에는 모델공간과 (저장 당시 활성이던) 한 레이아웃의
 * 종이공간 엔티티가 **섞여서** 들어 있다. code 67 = 1 이 종이공간 표시이고
 * code 410 이 어느 탭인지 이름으로 알려준다. 전엔 이 둘을 아예 안 봐서
 * 종이공간 도형(도면틀·표제란)이 모형 페이지에 같이 쏟아졌다.
 */
export type ParseSpace =
  /**
   * 모델공간. `excludePaper` 는 "종이 엔티티는 제 탭에서 따로 들어간다" 는
   * 뜻이다 — 탭을 여러 장으로 나눌 때만 켠다. 레이아웃이 하나뿐인 파일에서
   * 켜면 도면이 통째로 사라진다: DWG→DXF 변환물은 도형이 전부 종이공간에만
   * 있는 경우가 흔하고, 그 땐 한 장에 다 넣는 게 맞다.
   */
  | { kind: 'model'; excludePaper?: boolean }
  /**
   * 종이 레이아웃 한 장. ENTITIES 의 code 410 일치분 + blockName 블록 내용.
   *
   * `viewports` 가 있으면 그 창들을 통해 **모델공간 도형까지** 종이 좌표로
   * 끌어온다 (도면틀 + 평면도가 한 장에 들어온다). 워커는 이 필드를 안 본다 —
   * 사상은 메인 스레드(commitCadImportV2)에서 한다.
   */
  | {
      kind: 'paper'; layoutName: string; blockName?: string | null
      viewports?: ViewportProjection[]
      /**
       * ENTITIES 섹션에 있고 **gc 410(소속 레이아웃) 이 없는** 종이 엔티티를
       * 이 탭이 가져갈 것인가. `undefined` 면 가져간다 (예전 동작).
       *
       * unlabeledPaperOwner() 가 고른 한 탭만 true 여야 한다 — 안 그러면
       * 같은 시트가 탭마다 중복으로 들어온다.
       */
      ownsUnlabeledPaper?: boolean
      /**
       * 이 탭의 **시트 범위** (LAYOUT limits). 종이 좌표계다.
       *
       * 종이공간에선 "도면 본체" 가 추측이 아니다 — 시트 크기가 파일에 적혀
       * 있다. 시트 한참 밖에 나간 도형을 잘라내는 데 쓴다. 워커는 이 필드를
       * 안 본다 — 자르기는 메인 스레드(commitCadImportV2)에서 한다.
       */
      sheet?: SheetRect | null
    }

/**
 * gc 410 이 없는 ENTITIES 섹션 종이 엔티티를 **어느 탭** 것으로 볼 것인가.
 *
 * DXF 는 저장 당시 활성이던 탭의 종이공간을 ENTITIES 섹션에 (gc 67=1 로)
 * 넣고, 그 탭의 BLOCK_RECORD 이름을 접미사 없는 `*Paper_Space` 로 쓴다.
 * 나머지 탭은 `*Paper_Space0`, `*Paper_Space1` ... 로 BLOCKS 섹션에 들어간다.
 * 그래서 `*Paper_Space` 를 가진 레이아웃이 이 엔티티들의 주인이다.
 *
 * 왜 필요한가: gc 410 을 아예 안 쓰는 DWG→DXF 변환물이 있다 (리닝 파일의
 * 종이 엔티티 865개 전부 410 이 없다). 그 땐 "이름으로 가릴 수 없으니 넣는
 * 쪽이 낫다" 는 폴백이 **모든 탭에 같은 시트를 다 넣어** 버린다 — Layout1
 * 의 종이 범위가 배치1 영역인 X 193124 까지 뻗고, 화면맞춤이 덜 찼다.
 *
 * 못 고르면 null 을 준다 (주인 후보가 없거나 둘 이상). 그 땐 예전처럼 모든
 * 탭이 가져간다 — 중복이 나더라도 도형을 통째로 잃는 쪽이 더 나쁘다.
 */
export function unlabeledPaperOwner(layouts: DxfLayout[]): string | null {
  const owners = layouts.filter(l =>
    !l.isModelSpace && (l.blockName ?? '').trim().toLowerCase() === '*paper_space')
  return owners.length === 1 ? owners[0].name : null
}

/** 레이아웃 하나를 어떻게 페이지로 만들 것인가. */
export interface LayoutTarget {
  layout: DxfLayout
  /** 모델공간 클리핑 영역. 모형 탭이거나 뷰포트를 못 찾았으면 null. */
  clip: ViewportClip | null
  /** 도형을 넣을 것인가. false 면 탭 자리만 잡고 비워 둔다. */
  geometry: boolean
  /** 이 탭의 뷰포트들. 모델 도형을 종이 좌표로 끌어올 때 쓴다. */
  viewports: ViewportProjection[]
}

/**
 * 레이아웃 목록 → 만들 페이지 목록.
 *
 * 뷰포트를 못 찾은 종이 레이아웃도 **페이지는 만든다** (geometry: false).
 * 전엔 통째로 건너뛰어서, 오토캐드에 탭이 3개인 도면이 2개로 들어왔다 —
 * 뭐가 없어졌는지조차 안 보였다. 도형을 안 넣는 이유는 따로다: clip 없이
 * 임포트하면 모델공간 전체가 복사돼 모형 탭의 복제본이 생긴다.
 */
export function buildLayoutTargets(
  layouts: DxfLayout[],
  viewportsByLayout: Map<string, DxfViewport[]>,
): LayoutTarget[] {
  const targets: LayoutTarget[] = []
  for (const layout of [...layouts].sort((a, b) => a.tabOrder - b.tabOrder)) {
    if (layout.isModelSpace) {
      targets.push({ layout, clip: null, geometry: true, viewports: [] })
      continue
    }
    const vps = viewportsByLayout.get(layout.name)
    if (!vps || vps.length === 0) {
      targets.push({ layout, clip: null, geometry: false, viewports: [] })
      continue
    }
    targets.push({
      layout,
      clip: {
        minX: Math.min(...vps.map(v => v.clipMinX)),
        minY: Math.min(...vps.map(v => v.clipMinY)),
        maxX: Math.max(...vps.map(v => v.clipMaxX)),
        maxY: Math.max(...vps.map(v => v.clipMaxY)),
      },
      geometry: true,
      viewports: vps.map(toViewportProjection).filter((p): p is ViewportProjection => p !== null),
    })
  }
  return targets
}

// ── Structural layer detection ──

/** 구조 레이어 키워드 매칭 패턴 */
export const STRUCTURAL_KEYWORDS = /wall|window|win(?!ter)|door|stair|column|beam|slab|elev|건축|벽|창문|문/i

/**
 * HATCH 패턴 정의선 하나 (gc 53/45/46/49).
 *
 * HATCH 엔티티에 박혀 있는 정의선은 패턴명(.pat)을 축척·각도까지 반영해
 * 이미 해석한 최종 결과다. 즉 이것만 그리면 어떤 패턴이든 원본대로 나온다.
 */
export interface HatchPatternLine {
  angle: number    // gc 53: 선 각도 (deg, CCW)
  spacing: number  // 줄 간격 (도면 단위, 선에 수직)
  dashes: number[] // gc 49: 선 방향 길이. 양수=실선, 음수=공백, 0=점
}

/**
 * 패턴 정의선의 줄 간격 (선에 수직인 거리).
 *
 * gc 45/46 오프셋은 선 자체 좌표계가 아니라 **WCS** 기준이다 (90도 선의
 * 오프셋에 cos(90) 반올림 오차가 남아 있는 걸로 확인). 선 방향이 아닌
 * 수직 성분만 뽑아야 하고, 선 방향 성분은 dash 위상 밀림이라 무시한다.
 */
export function defLineSpacing(angleDeg: number, offX: number, offY: number): number {
  const t = angleDeg * Math.PI / 180
  return Math.abs(-offX * Math.sin(t) + offY * Math.cos(t))
}

/**
 * 호(弧)·타원 호를 선분으로 펴서 점 목록으로 돌려준다.
 *
 * **각도는 도(度) 다.** 이름에 Deg 를 박아둔 건 사고 이력 때문이다 — HATCH
 * 테두리의 타원 호 edge 네 군데가 gc 50/51 을 라디안으로 썼고, `51 = 360`
 * 이 57 바퀴가 되면서 고정 샘플링한 자기교차 다각형이 단색 채움(nonzero)
 * 으로 타원을 가득 메운 회색 원반이 됐다. 바로 옆 호 edge 는 변환을 제대로
 * 하고 있었으니, 복붙 네 벌이 각자 단위를 정하게 둔 게 원인이다.
 *
 * 그래서 샘플링은 여기 한 군데만 둔다. 주의: **ELLIPSE 엔티티**의 gc 41/42
 * 는 라디안이다 (그리고 dxf-parser 는 ARC 의 50/51 을 라디안으로 바꿔서
 * 준다). 그쪽 값을 여기 넣을 땐 도로 되돌려서 넣어야 한다.
 */
export interface ArcSampleDeg {
  /** 중심 */
  cx: number
  cy: number
  /** 장축 반경. 원이면 반지름. */
  rx: number
  /** 단축 반경. 원이면 rx 와 같은 값. 0 이하/비정상이면 rx 로 본다. */
  ry?: number
  /** 장축 기울기 (**라디안** — atan2 결과를 그대로 넣는 자리다). 원이면 0. */
  rot?: number
  /** 시작 각도 (도) */
  startDeg: number
  /** 끝 각도 (도) */
  endDeg: number
  /** gc 73. false(시계방향) 면 각도 부호를 뒤집어 음수로 쓸어간다. */
  ccw?: boolean
  /** 한 조각이 덮는 각도 (도). 기본 15. */
  stepDeg?: number
  /** 조각 수를 직접 지정 (stepDeg 를 무시한다). 기존 호출부 호환용. */
  segments?: number
}

/** 한 바퀴. 스윕은 이걸 넘을 수 없다. */
const FULL_TURN_DEG = 360

/**
 * 스윕(시작→끝 각도 차이)을 도 단위로 정규화한다. 항상 0 초과 360 이하.
 *
 * 이게 안전망의 핵심이다. 단위를 또 틀리든, DXF 가 쓰레기 값을 주든,
 * 테두리가 **한 바퀴를 넘게 돌 수는 없다** — 자기교차 다각형이 단색으로
 * 채워져 거대한 원반이 되는 사고가 여기서 끊긴다.
 *
 * ## gc 73 = 0 (시계방향)
 *
 * 이건 "경계를 시계방향으로 돌라" 가 아니다. **각도 자체가 시계방향으로
 * 적힐 있다** 는 뜻이다. 부호를 뒤집어야 반시계 좌표계로 돌아온다.
 *
 * 리닝 dwg 화붆4 분록의 HATCH 테들리 path1 에서 실젝한 것:
 *
 *   edge1  c=(-5964.17,-6951.06) r=2944.69 sa=1.5506 ea=3.4880 ccw=0
 *   edge2  c=(-3082.94,-7077.83) r=  78.15 sa=317.91 ea=397.05 ccw=1
 *
 * 시작/끝을 스앝하는 방식은 edge1 을 358.06도로 만들어 5885x5883 원반을
 * 낳고, 끝점도 edge2 와 y 로 300 떨어진다. 부호를 뒤짐으면 1.94도 호가
 * 되고 끝점이 edge2 와 소수점 둘째자리까지 맞아 고리가 닫힌다.
 *
 * 그래서 시계방향은 startDeg 를 네게이트하고 스솝을 **음수**로 낸다.
 * 크기 자체는 반시계와 동일한 endDeg - startDeg 다.
 */
export function normalizeArcSweepDeg(
  startDeg: number, endDeg: number, ccw = true,
): { startDeg: number; sweepDeg: number } {
  const a = Number.isFinite(startDeg) ? startDeg : 0
  const b = Number.isFinite(endDeg) ? endDeg : FULL_TURN_DEG
  let sweep = b - a
  // 끝각이 시작각보다 작으면 0도를 지나 돌아온 것이다.
  if (sweep <= 0) sweep += FULL_TURN_DEG
  // 그래도 음수거나 한 바퀴를 넘으면 값이 깨진 것이다. 한 바퀴로 자른다.
  if (!(sweep > 0) || sweep > FULL_TURN_DEG) sweep = FULL_TURN_DEG
  // 시계방향은 각도가 시계방향으로 적힐 있다. 부호를 뒤집어 돌려랬다.
  return ccw ? { startDeg: a, sweepDeg: sweep } : { startDeg: -a, sweepDeg: -sweep }
}

/**
 * 호/타원 호 샘플링. 끝점을 포함하므로 조각 N 개면 점은 N+1 개다.
 *
 * 조각 수는 **도 단위로** 센다. 라디안으로 되돌려 세면 한 바퀴가
 * 24.000000000000004 가 되어 ceil 이 조각을 하나 더 만든다.
 */
export function sampleArcDeg(o: ArcSampleDeg): Array<[number, number]> {
  const { startDeg, sweepDeg } = normalizeArcSweepDeg(o.startDeg, o.endDeg, o.ccw ?? true)
  const rx = Number.isFinite(o.rx) ? o.rx : 0
  const ry = o.ry !== undefined && Number.isFinite(o.ry) && o.ry > 0 ? o.ry : rx
  const rot = Number.isFinite(o.rot ?? 0) ? (o.rot ?? 0) : 0
  const cosR = Math.cos(rot), sinR = Math.sin(rot)

  const step = o.stepDeg !== undefined && o.stepDeg > 0 ? o.stepDeg : 15
  const N = o.segments !== undefined && o.segments >= 1
    ? Math.floor(o.segments)
    : Math.max(3, Math.ceil(Math.abs(sweepDeg) / step))

  const toRad = Math.PI / 180
  const t0 = startDeg * toRad
  const dt = (sweepDeg * toRad) / N

  const pts: Array<[number, number]> = []
  for (let i = 0; i <= N; i++) {
    const t = t0 + dt * i
    const lx = rx * Math.cos(t), ly = ry * Math.sin(t)
    pts.push([o.cx + lx * cosR - ly * sinR, o.cy + lx * sinR + ly * cosR])
  }
  return pts
}
