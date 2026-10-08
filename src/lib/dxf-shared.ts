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
}

/** Viewport 기반 클리핑 영역 */
export type ViewportClip = { minX: number; minY: number; maxX: number; maxY: number }

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
