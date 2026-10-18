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
 * DXF 바이트를 엔진이 읽을 수 있는 모양으로 고친다.
 *
 * DWG→DXF 변환기(dwgdxf)가 **코드페이지를 거짓말한다** — 헤더엔
 * `$DWGCODEPAGE=ANSI_1252` 라 써놓고 내용은 EUC-KR 바이트다. 그대로 주면
 * 엔진이 서유럽으로 읽어서 한글이 깨진다.
 *
 * 우리는 이미 그걸 가려내는 코드가 있다 (detectDxfEncoding +
 * reverseDoubleEncodingIfNeeded). 제대로 디코딩한 뒤 UTF-8 로 다시 쓰고,
 * 헤더도 사실대로 고쳐서 넘긴다.
 */
export function normalizeDxfBytes(bytes: Uint8Array): Uint8Array {
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
