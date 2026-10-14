/**
 * OLE2FRAME 안에 박혀 있는 래스터 이미지를 꺼내는 순수 함수들.
 *
 * AutoCAD 에서 DWG 하나만 열어도 항공사진/배치도 스캔이 같이 보이는 이유는,
 * 그 이미지가 외부 파일 참조(IMAGE + IMAGEDEF)가 아니라 **OLE2FRAME 엔티티
 * 안에 OLE2 복합문서(CFBF)로 통째로 들어 있기** 때문이다. 우리는 이걸
 * 통째로 버렸으니 당연히 아무것도 안 나왔다.
 *
 * 꺼내는 경로:
 *   gc 310 hex 청크들 → 바이트 blob
 *     → blob[0..1] 미지의 u16, blob[2..97] 네 꼭지점 double 12개  (배치 좌표)
 *     → blob[128..]  CFBF 복합문서 → \x01Ole10Native 스트림
 *       → u32 길이 + 원본 파일 바이트 (여기서는 BMP)
 *
 * **gc 10 / 11 (좌상·우하) 은 믿을 수 없다.** 성수 파일에서 실제 값이
 * 10=(1,1,0), 11=(0,0,0) 으로 1x1 뒤집힌 상자였다. 그래서 blob 앞머리의
 * 꼭지점 double 을 쓴다 — AutoCAD 화면과 픽셀 단위로 맞춰 검증했다.
 *
 * 캔버스/DOM 을 쓰지 않는다. 워커에서도 node 테스트에서도 그대로 돈다.
 */

export type OleRect = { minX: number; minY: number; maxX: number; maxY: number }

export type OleBitmap = {
  width: number
  height: number
  /** RGBA, 위에서 아래로(top-down). 길이 = width * height * 4 */
  rgba: Uint8Array
  /** 데이터가 잘려서 못 채운 줄이 있으면 실제로 채운 줄 수 (= height 면 완전) */
  validRows: number
}

// ── gc 310 hex → 바이트 ──

const HEX: Int8Array = (() => {
  const t = new Int8Array(128).fill(-1)
  for (let c = 0; c < 10; c++) t[48 + c] = c            // '0'-'9'
  for (let c = 0; c < 6; c++) t[65 + c] = 10 + c        // 'A'-'F'
  for (let c = 0; c < 6; c++) t[97 + c] = 10 + c        // 'a'-'f'
  return t
})()

/**
 * gc 310 청크 문자열들을 하나의 바이트 배열로. 청크마다 127바이트(254글자)라
 * 20MB 짜리면 청크가 15만 개쯤 된다 — join 으로 40MB 문자열을 만들지 않고
 * 청크별로 바로 버퍼에 써넣는다.
 *
 * 홀수 길이나 hex 아닌 글자가 나오면 그 지점에서 멈추고 거기까지 돌려준다.
 * 변환기가 중간에 잘라먹은 데이터라도 앞부분은 쓸 수 있어야 한다.
 */
export function hexChunksToBytes(chunks: string[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total >> 1)
  let w = 0
  for (const c of chunks) {
    const n = c.length >> 1
    for (let i = 0; i < n; i++) {
      const hi = HEX[c.charCodeAt(i * 2) & 0x7f]
      const lo = HEX[c.charCodeAt(i * 2 + 1) & 0x7f]
      if (hi < 0 || lo < 0) return out.subarray(0, w)
      out[w++] = (hi << 4) | lo
    }
  }
  return out.subarray(0, w)
}

// ── 배치 사각형 ──

/** 좌상/우하 꼭지점이 제대로 된 상자를 이루는지 (gc 10/11 검증용) */
export function rectFromCorners(
  ul: { x: number; y: number }, lr: { x: number; y: number },
): OleRect | null {
  const { x: x1, y: y1 } = ul
  const { x: x2, y: y2 } = lr
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null
  // 좌상 → 우하 니까 x 는 커지고 y 는 작아져야 한다. 뒤집혔으면 쓰레기값이다.
  if (!(x2 > x1) || !(y1 > y2)) return null
  return { minX: x1, minY: y2, maxX: x2, maxY: y1 }
}

/** 값들을 오차 tol 로 묶었을 때 서로 다른 값이 몇 개인지 */
function distinctCount(vals: number[], tol: number): number {
  const s = [...vals].sort((a, b) => a - b)
  let n = 1
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > tol) n++
  return n
}

const QUAD_OFFSETS = [2, 0, 4, 6, 8, 10, 12]
const COORD_SANE = 1e12

/**
 * blob 앞머리의 꼭지점 double 12개(= 점 4개)에서 배치 사각형을 읽는다.
 *
 * 오프셋을 못 믿어서(성수 파일은 2, 다른 변환기는 다를 수 있다) 후보를 차례로
 * 시도하고 **축에 평행한 사각형인지**로 맞았는지 판정한다 — x 가 두 값,
 * y 가 두 값으로만 모이면 그게 사각형이다. 우연히 통과할 확률은 거의 없다.
 */
export function readOleFrameRect(blob: Uint8Array): OleRect | null {
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  for (const off of QUAD_OFFSETS) {
    if (off + 96 > blob.byteLength) continue
    const xs: number[] = []
    const ys: number[] = []
    let ok = true
    for (let p = 0; p < 4 && ok; p++) {
      const x = dv.getFloat64(off + p * 24, true)
      const y = dv.getFloat64(off + p * 24 + 8, true)
      const z = dv.getFloat64(off + p * 24 + 16, true)
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) ok = false
      else if (Math.abs(x) > COORD_SANE || Math.abs(y) > COORD_SANE) ok = false
      else { xs.push(x); ys.push(y) }
    }
    if (!ok) continue
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const w = maxX - minX, h = maxY - minY
    if (!(w > 0) || !(h > 0)) continue
    if (distinctCount(xs, w * 1e-6) !== 2) continue
    if (distinctCount(ys, h * 1e-6) !== 2) continue
    return { minX, minY, maxX, maxY }
  }
  return null
}

// ── CFBF (OLE2 복합문서) ──

const CFBF_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const MAXREGSECT = 0xfffffffa

/** 복합문서 서명이 blob 안 어디서 시작하는지 (성수 파일은 128). 없으면 -1 */
export function findCompoundDoc(blob: Uint8Array, searchLimit = 65536): number {
  const end = Math.min(blob.byteLength - CFBF_SIG.length, searchLimit)
  for (let i = 0; i <= end; i++) {
    if (blob[i] !== CFBF_SIG[0]) continue
    let hit = true
    for (let k = 1; k < CFBF_SIG.length; k++) {
      if (blob[i + k] !== CFBF_SIG[k]) { hit = false; break }
    }
    if (hit) return i
  }
  return -1
}

export type CompoundEntry = { name: string; type: number; start: number; size: number }

type Compound = {
  entries: CompoundEntry[]
  read: (start: number, size: number) => { data: Uint8Array; validBytes: number }
}

/**
 * 복합문서를 열어 디렉터리 목록과 스트림 읽기 함수를 돌려준다.
 *
 * 변환기가 데이터를 잘라먹었을 수 있으므로 **범위 밖 섹터는 0으로 메우고 몇
 * 바이트가 진짜인지 같이 보고한다**. 중간에 끊겼다고 전부 버리면 59% 라도
 * 보여줄 수 있는 걸 못 보여준다.
 */
export function openCompound(blob: Uint8Array, docOffset: number): Compound | null {
  const doc = blob.subarray(docOffset)
  if (doc.byteLength < 512) return null
  const dv = new DataView(doc.buffer, doc.byteOffset, doc.byteLength)

  const sectShift = dv.getUint16(0x1e, true)
  const miniShift = dv.getUint16(0x20, true)
  if (sectShift < 7 || sectShift > 20 || miniShift < 2 || miniShift > sectShift) return null
  const SS = 1 << sectShift
  const MS = 1 << miniShift
  const dirStart = dv.getUint32(0x30, true)
  const miniCutoff = dv.getUint32(0x38, true)
  const miniFatStart = dv.getUint32(0x3c, true)
  const difatStart = dv.getUint32(0x44, true)

  const sectOff = (s: number) => 512 + s * SS
  const have = (s: number) => s < MAXREGSECT && sectOff(s) + SS <= doc.byteLength

  // DIFAT: 헤더 안에 109개 + 추가 DIFAT 섹터 체인
  const difat: number[] = []
  for (let k = 0; k < 109; k++) {
    const v = dv.getUint32(0x4c + k * 4, true)
    if (v < MAXREGSECT) difat.push(v)
  }
  const perSect = SS >> 2
  let ds = difatStart
  const seenDifat = new Set<number>()
  while (have(ds) && !seenDifat.has(ds)) {
    seenDifat.add(ds)
    const base = sectOff(ds)
    for (let k = 0; k < perSect - 1; k++) {
      const v = dv.getUint32(base + k * 4, true)
      if (v < MAXREGSECT) difat.push(v)
    }
    ds = dv.getUint32(base + SS - 4, true)
  }

  // FAT: DIFAT 이 가리키는 섹터들을 이어붙인 u32 배열
  const fat = new Map<number, number>()
  difat.forEach((fs, idx) => {
    if (!have(fs)) return
    const base = sectOff(fs)
    for (let k = 0; k < perSect; k++) {
      fat.set(idx * perSect + k, dv.getUint32(base + k * 4, true))
    }
  })
  if (fat.size === 0) return null

  const chainOf = (start: number, fatMap: Map<number, number>): number[] => {
    const out: number[] = []
    const seen = new Set<number>()
    let s = start
    while (s < MAXREGSECT && !seen.has(s) && out.length < 1 << 22) {
      seen.add(s)
      out.push(s)
      s = fatMap.get(s) ?? 0xfffffffe
    }
    return out
  }

  const readSectors = (start: number, size: number): { data: Uint8Array; validBytes: number } => {
    const buf = new Uint8Array(size)
    let w = 0
    let valid = 0
    for (const s of chainOf(start, fat)) {
      if (w >= size) break
      const n = Math.min(SS, size - w)
      if (s < MAXREGSECT) {
        // 변환기가 고정 버퍼에서 잘라 내놓으면 **마지막 섹터만 반쯤** 들어 있다.
        // have() 처럼 섹터 단위로 통째로 버리면 멀쩡한 500바이트가 같이 날아가
        // 이미지 아래쪽 한 줄이 더 비는데, 그 줄은 실제로 복원 가능한 줄이다.
        const off = sectOff(s)
        const avail = Math.max(0, Math.min(n, doc.byteLength - off))
        if (avail > 0) {
          buf.set(doc.subarray(off, off + avail), w)
          valid = w + avail
        }
        if (avail < n) break   // 여기서 파일이 끝났다 — 뒤는 없다
      }
      w += n
    }
    return { data: buf, validBytes: valid }
  }

  // ── 디렉터리 ──
  const entries: CompoundEntry[] = []
  let rootStart = -1
  let rootSize = 0
  for (const s of chainOf(dirStart, fat)) {
    if (!have(s)) continue
    const base = sectOff(s)
    for (let k = 0; k + 128 <= SS; k += 128) {
      const e = base + k
      const etype = doc[e + 0x42]
      if (etype === 0) continue
      const nlen = dv.getUint16(e + 0x40, true)
      let name = ''
      for (let c = 0; c + 1 < Math.max(0, nlen - 2) && c < 64; c += 2) {
        name += String.fromCharCode(dv.getUint16(e + c, true))
      }
      const start = dv.getUint32(e + 0x74, true)
      // u64 크기. 4GB 넘는 OLE 이미지는 없으니 하위 32비트만 봐도 된다.
      const size = dv.getUint32(e + 0x78, true)
      if (etype === 5) { rootStart = start; rootSize = size }
      entries.push({ name, type: etype, start, size })
    }
  }
  if (entries.length === 0) return null

  // ── 미니 스트림 (작은 스트림은 루트 스트림 안에 64바이트 단위로 들어간다) ──
  let mini: Uint8Array | null = null
  let miniFat: Map<number, number> | null = null
  const loadMini = (): boolean => {
    if (mini && miniFat) return true
    if (rootStart < 0 || rootSize === 0) return false
    mini = readSectors(rootStart, rootSize).data
    miniFat = new Map<number, number>()
    let idx = 0
    for (const s of chainOf(miniFatStart, fat)) {
      if (!have(s)) break
      const base = sectOff(s)
      for (let k = 0; k < perSect; k++) miniFat.set(idx++, dv.getUint32(base + k * 4, true))
    }
    return miniFat.size > 0
  }

  const read = (start: number, size: number): { data: Uint8Array; validBytes: number } => {
    if (size === 0) return { data: new Uint8Array(0), validBytes: 0 }
    if (size >= miniCutoff) return readSectors(start, size)
    if (!loadMini() || !mini || !miniFat) return { data: new Uint8Array(size), validBytes: 0 }
    const buf = new Uint8Array(size)
    let w = 0
    let valid = 0
    for (const s of chainOf(start, miniFat)) {
      if (w >= size) break
      const n = Math.min(MS, size - w)
      const off = s * MS
      if (off + n <= mini.byteLength) {
        buf.set(mini.subarray(off, off + n), w)
        valid = w + n
      }
      w += n
    }
    return { data: buf, validBytes: valid }
  }

  return { entries, read }
}

// ── BMP/DIB 디코딩 ──

const BI_RGB = 0
const BI_BITFIELDS = 3

/**
 * BMP(DIB) → top-down RGBA.
 *
 * 32bpp BI_RGB 는 알파 자리가 **패딩**이라 보통 전부 0 이다. 그대로 쓰면
 * 투명한 그림이 나오므로, 알파가 전부 0 이면 불투명으로 간주한다.
 *
 * RLE·JPEG·PNG 로 압축된 DIB 는 지원하지 않는다 (null).
 */
export function decodeBmp(bmp: Uint8Array, validBytes = bmp.byteLength): OleBitmap | null {
  if (bmp.byteLength < 54 || bmp[0] !== 0x42 || bmp[1] !== 0x4d) return null  // 'BM'
  const dv = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength)
  const pixOff = dv.getUint32(10, true)
  const dibSize = dv.getUint32(14, true)
  if (dibSize < 40) return null  // BITMAPCOREHEADER(12) 는 실무에서 안 나온다
  const width = dv.getInt32(18, true)
  const rawHeight = dv.getInt32(22, true)
  const bpp = dv.getUint16(28, true)
  const comp = dv.getUint32(30, true)
  const height = Math.abs(rawHeight)
  const bottomUp = rawHeight > 0

  if (width <= 0 || height <= 0 || width > 32768 || height > 32768) return null
  if (comp !== BI_RGB && comp !== BI_BITFIELDS) return null
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) return null

  // 팔레트 (bpp <= 8): DIB 헤더 바로 뒤, 항목당 BGRA 4바이트
  let palette: Uint8Array | null = null
  if (bpp <= 8) {
    const declared = dv.getUint32(46, true)
    const count = declared > 0 ? Math.min(declared, 1 << bpp) : 1 << bpp
    const pBase = 14 + dibSize
    palette = new Uint8Array(count * 4)
    for (let i = 0; i < count; i++) {
      const o = pBase + i * 4
      if (o + 3 >= bmp.byteLength) break
      palette[i * 4] = bmp[o + 2]      // R
      palette[i * 4 + 1] = bmp[o + 1]  // G
      palette[i * 4 + 2] = bmp[o]      // B
      palette[i * 4 + 3] = 255
    }
  }

  const stride = ((width * bpp + 31) >> 5) << 2
  if (pixOff >= bmp.byteLength) return null

  const rgba = new Uint8Array(width * height * 4)
  let validRows = 0

  for (let row = 0; row < height; row++) {
    const srcRow = pixOff + row * stride
    if (srcRow + stride > validBytes) break
    // bottom-up 이면 데이터 첫 줄이 화면 맨 아랫줄이다.
    const dstRow = bottomUp ? height - 1 - row : row
    let d = dstRow * width * 4
    for (let x = 0; x < width; x++) {
      if (bpp === 32) {
        const s = srcRow + x * 4
        rgba[d++] = bmp[s + 2]; rgba[d++] = bmp[s + 1]; rgba[d++] = bmp[s]; rgba[d++] = bmp[s + 3]
      } else if (bpp === 24) {
        const s = srcRow + x * 3
        rgba[d++] = bmp[s + 2]; rgba[d++] = bmp[s + 1]; rgba[d++] = bmp[s]; rgba[d++] = 255
      } else if (bpp === 16) {
        // BI_RGB 16bpp 은 X1R5G5B5 가 기본이다.
        const v = dv.getUint16(srcRow + x * 2, true)
        const r5 = (v >> 10) & 31, g5 = (v >> 5) & 31, b5 = v & 31
        rgba[d++] = (r5 * 255 / 31) | 0; rgba[d++] = (g5 * 255 / 31) | 0
        rgba[d++] = (b5 * 255 / 31) | 0; rgba[d++] = 255
      } else {
        const idx = bpp === 8 ? bmp[srcRow + x]
          : bpp === 4 ? (bmp[srcRow + (x >> 1)] >> (x & 1 ? 0 : 4)) & 0xf
            : (bmp[srcRow + (x >> 3)] >> (7 - (x & 7))) & 1
        const p = palette ? idx * 4 : -1
        if (p >= 0 && p + 3 < palette!.byteLength) {
          rgba[d++] = palette![p]; rgba[d++] = palette![p + 1]
          rgba[d++] = palette![p + 2]; rgba[d++] = 255
        } else {
          rgba[d++] = 0; rgba[d++] = 0; rgba[d++] = 0; rgba[d++] = 255
        }
      }
    }
    validRows++
  }
  if (validRows === 0) return null

  // 32bpp 의 알파가 전부 0 이면 그건 패딩이다 → 불투명으로 되살린다.
  if (bpp === 32) {
    let maxA = 0
    for (let i = 3; i < rgba.byteLength && maxA === 0; i += 4) maxA = rgba[i]
    if (maxA === 0) {
      // 데이터가 못 닿은 줄은 투명하게 남겨둔다 (반쪽 그림을 흰 띠로 덮지 않게).
      const from = bottomUp ? height - validRows : 0
      for (let r = from; r < from + validRows; r++) {
        for (let i = r * width * 4 + 3; i < (r + 1) * width * 4; i += 4) rgba[i] = 255
      }
    }
  }

  return { width, height, rgba, validRows }
}

// ── 전체 경로 ──

/** OLE2 복합문서에서 원본 파일 바이트를 들고 있을 만한 스트림 이름 (우선순위 순) */
const NATIVE_STREAMS = ['Ole10Native', 'OlePres000', 'CONTENTS', 'BITMAP']

/**
 * OLE2FRAME blob → 비트맵. 복합문서를 찾아 네이티브 스트림을 꺼내고,
 * 그 안에서 BMP 를 찾아 디코딩한다.
 *
 * Ole10Native 는 **u32 길이 접두사 + 원본 파일 바이트** 형식이다. 길이 필드를
 * 건너뛰지 않으면 'BM' 매직이 4바이트 밀려서 아무것도 안 나온다.
 */
export function readOleBitmap(blob: Uint8Array): OleBitmap | null {
  const docOff = findCompoundDoc(blob)
  if (docOff < 0) return null
  const cf = openCompound(blob, docOff)
  if (!cf) return null

  for (const want of NATIVE_STREAMS) {
    // 스트림 이름 앞에는 \x01 같은 제어문자가 붙는다 (\x01Ole10Native) — endsWith 로 찾는다.
    const e = cf.entries.find((x) => x.type === 2 && x.size > 0 && x.name.endsWith(want))
    if (!e) continue
    const { data, validBytes } = cf.read(e.start, e.size)

    // 'BM' 을 앞머리에서 찾는다. Ole10Native 는 보통 4바이트 길이 뒤 바로.
    for (const skip of [4, 0]) {
      if (skip + 2 > data.byteLength) continue
      if (data[skip] !== 0x42 || data[skip + 1] !== 0x4d) continue
      const body = data.subarray(skip)
      const bm = decodeBmp(body, Math.max(0, validBytes - skip))
      if (bm) return bm
    }
  }
  return null
}
