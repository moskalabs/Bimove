// CADCraft 엔진(WASM) 을 띄우고 도면 하나를 여는 자리.
//
// tldraw 를 대신할 바닥이다. tldraw 2.4.6 의 라이선스가 **비상업 전용**이라
// 상용 제품에 쓸 수 없어서 걷어내기로 했다 (moskalabs/cadcraft 의 bimove
// 브랜치, crates/bimove-wasm).
//
// wasm 은 `public/cadcraft/` 에 있다 — 이미 쓰고 있는 `public/dwgdxf/` 와 같은
// 방식이다. 번들러를 태우지 않으므로 빌드가 12MB 를 들고 씨름하지 않는다.
// 만드는 쪽은 scripts/build-cadcraft-wasm.mjs.

import { detectDxfEncoding, reverseDoubleEncodingIfNeeded } from './dxf'

/** `bimove_wasm.d.ts` 가 내주는 모양 중 우리가 쓰는 것만. */
export interface CadDoc {
  free(): void
  layoutNames(): string[]
  revision(): number
  exec(id: string, paramsJson: string): string
  buildFrame(layout: string, tolerance: number): CadFrame
  pick(layout: string, x: number, y: number, aperture: number): string | undefined
  pickWindow(layout: string, x0: number, y0: number, x1: number, y1: number, crossing: boolean): number
  snap(
    layout: string, x: number, y: number, aperture: number, osmode: number,
    baseX: number, baseY: number,
  ): CadSnap | undefined
  renderPixels(
    layout: string, cx: number, cy: number, scale: number, w: number, h: number, bg: number,
  ): CadRaster | undefined
}

export interface CadFrame {
  free(): void
  /** `[minX, minY, maxX, maxY]` */
  bounds(): Float64Array
  primCount(): number
}

export interface CadSnap {
  free(): void
  x(): number
  y(): number
  /** "Endpoint" / "Midpoint" / "Perpendicular" … */
  name(): string
  mode(): number
}

export interface CadRaster {
  free(): void
  rgba(): Uint8Array
  width(): number
  height(): number
}

interface CadModule {
  default: (init: { module_or_path: string }) => Promise<unknown>
  BimoveDoc: { openDxf(bytes: Uint8Array): CadDoc }
  registerFont(name: string, bytes: Uint8Array): void
  setFallbackFonts(list: string): void
}

/** 오토캐드 OSMODE 비트. 스냅 패널의 토글이 하나씩 여기 대응한다. */
export const OSNAP = {
  END: 1, MID: 2, CEN: 4, NOD: 8, QUA: 16, INT: 32, INS: 64,
  PER: 128, TAN: 256, NEA: 512, GCEN: 1024, APP: 2048, EXT: 4096, PAR: 8192,
} as const

const BASE = 'cadcraft'
const FONT_NAME = 'Noto Sans KR'

let modPromise: Promise<CadModule> | null = null

/**
 * 엔진을 한 번만 띄운다.
 *
 * 12MB 짜리라 두 번 받으면 안 된다. 호출이 겹쳐도 같은 약속을 돌려준다.
 */
function loadModule(): Promise<CadModule> {
  if (modPromise) return modPromise
  modPromise = (async () => {
    const url = new URL(`${BASE}/bimove_wasm.js`, document.baseURI).href
    const mod = (await import(/* @vite-ignore */ url)) as unknown as CadModule
    await mod.default({ module_or_path: new URL(`${BASE}/bimove_wasm_bg.wasm`, document.baseURI).href })
    await registerKoreanFont(mod)
    return mod
  })().catch((e) => {
    // 실패를 캐시에 남기면 새로고침 전까지 영영 안 된다.
    modPromise = null
    throw e
  })
  return modPromise
}

/**
 * 한글 폰트를 엔진에 넣는다.
 *
 * **wasm 에는 시스템 폰트가 없다.** 이걸 안 하면 도면 글씨가 전부 □ 로 나온다
 * (네이티브로 돌릴 땐 윈도우 폰트를 찾아서 멀쩡해 보이므로 더 헷갈린다).
 *
 * 폰트가 없으면 글씨만 네모가 되고 도면 자체는 멀쩡하다. 그래서 막지 않고
 * 경고만 남긴다 — 폰트 하나 때문에 도면을 못 보는 게 더 나쁘다.
 */
async function registerKoreanFont(mod: CadModule) {
  try {
    const res = await fetch(new URL(`fonts/NotoSansKR.ttf`, document.baseURI).href)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    mod.registerFont(FONT_NAME, new Uint8Array(await res.arrayBuffer()))
    // 등록만 해선 안 된다. 도면이 지정한 폰트에 한글이 없을 때 뒤질 차례에
    // 올려야 실제로 쓰인다.
    mod.setFallbackFonts(FONT_NAME)
  } catch (e) {
    console.warn('[cadcraft] 한글 폰트를 못 넣었다 — 글씨가 □ 로 나올 수 있다', e)
  }
}

/**
 * DXF 바이트를 글자로 푼다. **바이트를 먼저 믿고, 헤더는 그 다음이다.**
 *
 * `detectDxfEncoding` 은 `$DWGCODEPAGE` 를 먼저 본다. 그게 맞는 선택인 파일이
 * 많지만, 헤더는 `ANSI_949` 인데 내용은 이미 UTF-8 인 파일에서는 멀쩡한 한글을
 * EUC-KR 로 읽어 깨뜨린다 (우리가 한 번 디코딩해 둔 DXF 를 다시 넣을 때가
 * 그렇다).
 *
 * 그래서 **엄격 UTF-8 로 먼저 시도한다.** EUC-KR 한글 바이트는 유효한 UTF-8 이
 * 거의 될 수 없어서(0xC7 0xF6 처럼 이어바이트가 아닌 게 따라온다) 이 판정은
 * 잘 갈린다. 실패했을 때만 헤더를 보는 기존 감지기로 간다.
 *
 * 기존 임포트 경로의 detectDxfEncoding 은 건드리지 않는다 — 거기선 잘 돌고
 * 있고, 바꾸면 되던 게 깨질 수 있다.
 */
function decodeDxfText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // 유효한 UTF-8 이 아니다 — 헤더와 바이트 패턴으로 가린다.
  }
  const encoding = detectDxfEncoding(bytes)
  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/**
 * `$DWGCODEPAGE` 를 찾는 범위.
 *
 * HEADER 섹션 맨 앞쪽이고 실제로는 1KB 안에 있다. 그래도 넉넉히 둔다 —
 * 못 찾으면 "헤더가 멀쩡하다" 로 판정해서 고칠 걸 안 고치게 된다.
 * (값 자체는 이 한계와 무관하게 끝까지 읽는다.)
 */
const CODEPAGE_SCAN_BYTES = 1 << 20

/**
 * `$DWGCODEPAGE` 값의 바이트 범위. 없으면 null.
 *
 * 옛 정규식 `/(\$DWGCODEPAGE\r?\n\s*3\r?\n)([^\r\n]*)/` 와 같은 자리를 짚는다 —
 * 그룹코드가 `3` 이 아니면(그런 DXF 는 본 적 없지만) 손대지 않는 것까지 같다.
 */
function findCodePageValue(bytes: Uint8Array): { start: number; end: number; value: string } | null {
  const needle = '$DWGCODEPAGE'
  const limit = Math.min(bytes.length, CODEPAGE_SCAN_BYTES)
  // 헤더는 ASCII 다 — 바이트를 그대로 글자로 봐도 된다.
  let at = -1
  outer: for (let i = 0; i + needle.length <= limit; i++) {
    if (bytes[i] !== 0x24) continue              // '$'
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer
    }
    at = i
    break
  }
  if (at < 0) return null

  const n = bytes.length
  /** 줄 하나를 읽고 다음 줄머리를 돌려준다 (CR/LF/CRLF 다 받는다). */
  const line = (from: number): { text: string; next: number } => {
    let e = from
    while (e < n && bytes[e] !== 0x0A && bytes[e] !== 0x0D) e++
    let s = ''
    for (let i = from; i < e; i++) s += String.fromCharCode(bytes[i])
    let next = e
    if (next < n && bytes[next] === 0x0D) next++
    if (next < n && bytes[next] === 0x0A) next++
    return { text: s, next }
  }

  // `$DWGCODEPAGE` 줄 → 그룹코드 줄 → 값 줄
  const rest = line(at)
  if (rest.text.trim() !== needle) return null
  const code = line(rest.next)
  if (code.text.trim() !== '3') return null

  const start = code.next
  let end = start
  while (end < n && bytes[end] !== 0x0A && bytes[end] !== 0x0D) end++
  let value = ''
  for (let i = start; i < end; i++) value += String.fromCharCode(bytes[i])
  return { start, end, value: value.trim() }
}

/**
 * 바이트가 그대로 유효한 UTF-8 인가. **문자열을 만들지 않는다.**
 *
 * `TextDecoder('utf-8', {fatal:true})` 로도 가릴 수 있지만 그건 150MB 짜리
 * 문자열(한글이 섞이면 300MB)을 먼저 만들어 놓고 판정한다. 알고 싶은 건
 * 예/아니오 하나뿐이다.
 */
function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0
  const n = bytes.length
  while (i < n) {
    const b = bytes[i]
    if (b < 0x80) { i++; continue }
    let need: number, min: number, cp: number
    if (b >= 0xC2 && b <= 0xDF) { need = 1; min = 0x80; cp = b & 0x1F }
    else if (b >= 0xE0 && b <= 0xEF) { need = 2; min = 0x800; cp = b & 0x0F }
    else if (b >= 0xF0 && b <= 0xF4) { need = 3; min = 0x10000; cp = b & 0x07 }
    else return false                              // 0x80-0xC1, 0xF5-0xFF
    if (i + need >= n) return false                // 끝에서 잘렸다
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k]
      if (c < 0x80 || c > 0xBF) return false
      cp = (cp << 6) | (c & 0x3F)
    }
    if (cp < min || cp > 0x10FFFF) return false
    if (cp >= 0xD800 && cp <= 0xDFFF) return false  // 서러게이트는 UTF-8 에 없다
    i += need + 1
  }
  return true
}

/**
 * `reverseDoubleEncodingIfNeeded` 가 **손을 댈 가능성이 있나.**
 *
 * 그 함수는 (1) 한글이 이미 있으면, (2) U+0080-U+00FF 글자가 5개 미만이면,
 * (3) U+00FF 를 넘는 글자가 하나라도 있으면 원문을 그대로 돌려준다.
 * (3) 덕에 판정이 아주 싸다 — UTF-8 에서 U+0100 이상은 선두바이트가 0xC4
 * 이상이므로, 그런 바이트를 **하나라도** 만나면 즉시 "아니오" 다. 한글이 섞인
 * 파일은 보통 몇 KB 안에서 걸린다.
 */
function mayBeDoubleEncoded(bytes: Uint8Array): boolean {
  let high = 0
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b >= 0xC4) return false                    // U+0100 이상 → 되돌리기 대상 아님
    if (b === 0xC2 || b === 0xC3) high++
  }
  return high >= 5
}

/**
 * DXF 바이트를 엔진이 읽을 수 있는 모양으로 고친다.
 *
 * DWG→DXF 변환기(dwgdxf)가 **코드페이지를 거짓말한다** — 헤더엔
 * `$DWGCODEPAGE=ANSI_1252` 라 써놓고 내용은 EUC-KR 바이트다. 그대로 주면
 * 엔진이 서유럽으로 읽어서 한글이 깨진다.
 *
 * 우리는 이미 그걸 가려내는 코드가 있다 (detectDxfEncoding +
 * reverseDoubleEncodingIfNeeded). 제대로 디코딩한 뒤 UTF-8 로 다시 쓰고,
 * 헤더도 사실대로 고쳐서 넘긴다.
 *
 * ── 큰 파일에서 사본을 만들지 않는다 ──
 *
 * 디코딩 → replace → 인코딩 은 사본을 셋 만든다. 정작 **고칠 게 없는 파일이
 * 대부분이다** — 요즘 CAD 가 내보내는 DXF 는 UTF-8 이고 헤더도 맞다.
 * 그래서 세 갈래로 간다.
 *
 * 1. 이미 멀쩡하다 → **원본을 그대로** 돌려준다 (사본 0).
 * 2. UTF-8 은 맞는데 헤더만 거짓말한다 → 헤더 값만 **바이트로 이어붙인다**
 *    (사본 1, 문자열 0).
 * 3. 그 밖에 → 옛 경로. 인코딩이 틀린 파일은 디코딩 말고 길이 없다.
 *
 * 판정 자체는 전부 바이트 훑기라 할당이 0 이다. 한글이 섞인 43MB UTF-8 DXF
 * 로 재보니 **103ms, 사본 0** 이었다 (옛 경로는 195ms 에 86MB 문자열 +
 * 43MB 출력). 이중 인코딩 판정은 0xC4 이상 바이트를 만나면 바로 끝나므로
 * 한글이 있는 파일에선 몇 KB 안에서 떨어진다.
 */
export function normalizeDxfBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) return bytes

  const cp = findCodePageValue(bytes)
  const headerLies = cp !== null && !/^utf-?8$/i.test(cp.value)

  if (isValidUtf8(bytes) && !mayBeDoubleEncoded(bytes)) {
    if (!headerLies) return bytes                  // ① 손댈 게 없다
    // ② 헤더 값만 UTF8 로 바꿔 끼운다
    const tail = cp.end
    const out = new Uint8Array(cp.start + 4 + (bytes.length - tail))
    out.set(bytes.subarray(0, cp.start), 0)
    out.set([0x55, 0x54, 0x46, 0x38], cp.start)    // 'UTF8'
    out.set(bytes.subarray(tail), cp.start + 4)
    return out
  }

  // ③ 인코딩이 UTF-8 이 아니거나 이중 인코딩이다 — 글자로 풀어야 한다
  let text = decodeDxfText(bytes)
  text = reverseDoubleEncodingIfNeeded(text)
  // 이제 내용이 유니코드다. 헤더가 옛 코드페이지를 가리키고 있으면 엔진이
  // 그걸 믿고 또 틀리게 읽는다.
  text = text.replace(
    /(\$DWGCODEPAGE\r?\n\s*3\r?\n)([^\r\n]*)/,
    (_m, head: string) => `${head}UTF8`,
  )
  return new TextEncoder().encode(text)
}

/** DXF 를 열어 엔진 문서를 만든다. 바이트는 어떤 인코딩이어도 된다. */
export async function openDxf(bytes: Uint8Array): Promise<CadDoc> {
  const mod = await loadModule()
  return mod.BimoveDoc.openDxf(normalizeDxfBytes(bytes))
}

/** 엔진이 떠 있는지 (테스트·진단용). */
export function isLoaded(): boolean {
  return modPromise !== null
}
