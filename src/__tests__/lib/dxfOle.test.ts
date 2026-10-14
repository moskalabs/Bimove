/**
 * OLE2FRAME 안에 박혀 있는 래스터 이미지 회귀 테스트
 *
 * 증상: AutoCAD 에서 DWG 하나만 열면 배치도 사진이 같이 뜨는데, Bimove 로
 * 불러오면 선과 글자만 나오고 사진이 없었다. 원인 셋.
 *   1. OLE2FRAME 이 "비기하 엔티티" 스킵 목록에 들어 있었다 (LEADER/IMAGE 와
 *      같은 사고). 덩치가 수십 MB 라 OOM 방지 커밋에 휩쓸려 들어갔는데, 그
 *      덩치의 정체가 바로 **도면 위에 보이는 사진**이었다.
 *   2. 배치 좌표 gc 10/11 이 쓰레기였다 — 성수 파일은 10=(1,1), 11=(0,0) 인
 *      1×1 뒤집힌 상자다. 그대로 믿으면 원점에 점 하나가 찍힌다. 실제 네
 *      꼭지점은 gc 310 덩어리 앞머리(바이트 2)에 double 12개로 들어 있다.
 *   3. 32bpp BI_RGB 의 알파 채널은 "패딩"이라 전부 0 이다. 그대로 그리면
 *      완전 투명 — 불러왔는데 아무것도 안 보인다.
 *
 * DXF 는 OLE2 복합문서(CFBF)를 hex 로 적어 품는다. 여기서는 그 구조를 직접
 * 조립해서 꺼내는 쪽을 검증한다 — 실제 성수 파일(100MB+)은 못 넣으니까.
 */
import { describe, it, expect } from 'vitest'
import {
  hexChunksToBytes, rectFromCorners, readOleFrameRect,
  findCompoundDoc, openCompound, decodeBmp, decodeDib, findDibHeader,
  sniffEncodedImage, readOleBitmap, readOleImage,
} from '../../lib/dxfOle'
// Worker 모듈을 static import — jsdom 에선 self === window 라 onmessage 가 붙는다
import '../../lib/dxf-fast-worker'

// ───────────────────────── 픽스처 조립 ─────────────────────────

/**
 * 3×2 24bpp 상향식(bottom-up) BMP.
 *
 * 폭 3 → 한 줄 9바이트인데 4의 배수로 올려 12바이트 (패딩 3). 패딩을 건너뛰지
 * 못하면 둘째 줄부터 색이 밀린다 — 그걸 잡으려고 일부러 3픽셀이다.
 *
 * 파일의 첫 줄이 **이미지 맨 아래 줄**이다 (상향식). 즉 top-down 결과에서
 * 0번 줄은 파일 둘째 줄이어야 한다.
 */
function makeBmp(): Uint8Array {
  const stride = 12
  const pixels = new Uint8Array(stride * 2)
  // 파일 0번 줄 = 이미지 아래 줄. BGR 순서.
  pixels.set([10, 20, 30, 40, 50, 60, 70, 80, 90], 0)
  // 파일 1번 줄 = 이미지 위 줄.
  pixels.set([1, 2, 3, 4, 5, 6, 7, 8, 9], stride)

  const pixOff = 14 + 40
  const bmp = new Uint8Array(pixOff + pixels.byteLength)
  const dv = new DataView(bmp.buffer)
  bmp[0] = 0x42; bmp[1] = 0x4d               // 'BM'
  dv.setUint32(2, bmp.byteLength, true)
  dv.setUint32(10, pixOff, true)
  dv.setUint32(14, 40, true)                 // BITMAPINFOHEADER
  dv.setInt32(18, 3, true)                   // width
  dv.setInt32(22, 2, true)                   // height > 0 → 상향식
  dv.setUint16(26, 1, true)                   // planes
  dv.setUint16(28, 24, true)                  // bpp
  dv.setUint32(30, 0, true)                   // BI_RGB
  bmp.set(pixels, pixOff)
  return bmp
}

const SECTOR = 512
const ENDOFCHAIN = 0xfffffffe
const FATSECT = 0xfffffffd
const FREESECT = 0xffffffff

/**
 * 스트림 하나만 든 최소 CFBF 복합문서.
 *
 * 미니스트림 분기까지 흉내내면 픽스처가 배로 복잡해지므로, 헤더의 미니 컷오프
 * (0x38)를 0 으로 둬서 모든 스트림이 일반 섹터로 가게 한다.
 */
function makeCompound(streamName: string, payload: Uint8Array): Uint8Array {
  const dataSectors = Math.max(1, Math.ceil(payload.byteLength / SECTOR))
  const total = 1 + 1 + 1 + dataSectors   // 헤더 + FAT + 디렉터리 + 데이터
  const out = new Uint8Array(total * SECTOR)
  const dv = new DataView(out.buffer)

  // ── 헤더 ──
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0)
  dv.setUint16(0x1a, 3, true)            // major version
  dv.setUint16(0x1c, 0xfffe, true)       // byte order
  dv.setUint16(0x1e, 9, true)            // 섹터 = 2^9 = 512
  dv.setUint16(0x20, 6, true)            // 미니 섹터 = 64
  dv.setUint32(0x2c, 1, true)            // FAT 섹터 1개
  dv.setUint32(0x30, 1, true)            // 디렉터리 시작 = 섹터 1
  dv.setUint32(0x38, 0, true)            // 미니 컷오프 0 → 전부 일반 스트림
  dv.setUint32(0x3c, ENDOFCHAIN, true)   // 미니 FAT 없음
  dv.setUint32(0x40, 0, true)
  dv.setUint32(0x44, ENDOFCHAIN, true)   // DIFAT 없음
  dv.setUint32(0x48, 0, true)
  dv.setUint32(0x4c, 0, true)            // DIFAT[0] = FAT 가 섹터 0
  for (let i = 1; i < 109; i++) dv.setUint32(0x4c + i * 4, FREESECT, true)

  // ── 섹터 0: FAT ──
  const fat = SECTOR
  for (let i = 0; i < SECTOR / 4; i++) dv.setUint32(fat + i * 4, FREESECT, true)
  dv.setUint32(fat + 0 * 4, FATSECT, true)      // 0 = FAT 자신
  dv.setUint32(fat + 1 * 4, ENDOFCHAIN, true)   // 1 = 디렉터리 (한 섹터)
  for (let i = 0; i < dataSectors; i++) {
    const s = 2 + i
    dv.setUint32(fat + s * 4, i === dataSectors - 1 ? ENDOFCHAIN : s + 1, true)
  }

  // ── 섹터 1: 디렉터리 ──
  const dir = 2 * SECTOR
  const putEntry = (slot: number, name: string, type: number, start: number, size: number) => {
    const base = dir + slot * 128
    for (let i = 0; i < name.length; i++) dv.setUint16(base + i * 2, name.charCodeAt(i), true)
    dv.setUint16(base + 0x40, (name.length + 1) * 2, true)   // 종단 NUL 포함 바이트 수
    out[base + 0x42] = type
    dv.setUint32(base + 0x44, FREESECT, true)                // left
    dv.setUint32(base + 0x48, FREESECT, true)                // right
    dv.setUint32(base + 0x4c, FREESECT, true)                // child
    dv.setUint32(base + 0x74, start, true)
    dv.setUint32(base + 0x78, size, true)
  }
  putEntry(0, 'Root Entry', 5, ENDOFCHAIN, 0)
  putEntry(1, streamName, 2, 2, payload.byteLength)

  out.set(payload, 3 * SECTOR)
  return out
}

/** 성수 파일과 같은 배치: u16 + double 12개(네 꼭지점) + 메타 → 128바이트에서 CFBF. */
function makeOleBlob(
  quad: Array<[number, number]>, doc: Uint8Array, truncateTo?: number,
): Uint8Array {
  const head = new Uint8Array(128)
  const hv = new DataView(head.buffer)
  hv.setUint16(0, 0x5580, true)
  quad.forEach(([x, y], i) => {
    hv.setFloat64(2 + i * 24, x, true)
    hv.setFloat64(2 + i * 24 + 8, y, true)
    hv.setFloat64(2 + i * 24 + 16, 0, true)
  })
  const full = new Uint8Array(head.byteLength + doc.byteLength)
  full.set(head, 0)
  full.set(doc, head.byteLength)
  return truncateTo === undefined ? full : full.subarray(0, truncateTo)
}

const QUAD: Array<[number, number]> = [[100, 200], [300, 200], [300, 50], [100, 50]]

function toHexChunks(bytes: Uint8Array, per = 127): string[] {
  const chunks: string[] = []
  for (let i = 0; i < bytes.byteLength; i += per) {
    let s = ''
    for (let j = i; j < Math.min(i + per, bytes.byteLength); j++) {
      s += bytes[j].toString(16).padStart(2, '0').toUpperCase()
    }
    chunks.push(s)
  }
  return chunks
}

// ───────────────────────── 테스트 ─────────────────────────

describe('hexChunksToBytes', () => {
  it('127바이트씩 끊긴 hex 조각을 원래 바이트로 되돌린다', () => {
    const bytes = new Uint8Array(300)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff
    const back = hexChunksToBytes(toHexChunks(bytes))
    expect(back.byteLength).toBe(300)
    expect([...back]).toEqual([...bytes])
  })

  it('소문자 hex 도 읽는다', () => {
    expect([...hexChunksToBytes(['d0cf11e0'])]).toEqual([0xd0, 0xcf, 0x11, 0xe0])
  })

  it('hex 가 아닌 글자를 만나면 거기까지만 돌려준다 (예외 아님)', () => {
    expect([...hexChunksToBytes(['414243zz4445'])]).toEqual([0x41, 0x42, 0x43])
  })
})

describe('rectFromCorners', () => {
  it('좌상/우하가 제대로 들어오면 사각형을 만든다', () => {
    expect(rectFromCorners({ x: 10, y: 90 }, { x: 50, y: 20 }))
      .toEqual({ minX: 10, minY: 20, maxX: 50, maxY: 90 })
  })

  it('성수 파일의 쓰레기값(1×1 뒤집힘)은 거부한다', () => {
    // 이걸 통과시키면 도면 원점에 점 하나가 찍히고 자동 맞춤이 통째로 망한다.
    expect(rectFromCorners({ x: 1, y: 1 }, { x: 0, y: 0 })).toBeNull()
  })

  it('폭이나 높이가 0 이면 거부한다', () => {
    expect(rectFromCorners({ x: 5, y: 9 }, { x: 5, y: 1 })).toBeNull()
    expect(rectFromCorners({ x: 1, y: 9 }, { x: 5, y: 9 })).toBeNull()
  })

  it('NaN 이 섞이면 거부한다', () => {
    expect(rectFromCorners({ x: NaN, y: 9 }, { x: 5, y: 1 })).toBeNull()
  })
})

describe('readOleFrameRect', () => {
  it('덩어리 앞머리의 네 꼭지점에서 사각형을 뽑는다', () => {
    const rect = readOleFrameRect(makeOleBlob(QUAD, makeCompound('Ole10Native', new Uint8Array(8))))
    expect(rect).toEqual({ minX: 100, minY: 50, maxX: 300, maxY: 200 })
  })

  it('꼭지점 자리에 쓰레기가 있으면 null', () => {
    const junk = new Uint8Array(200)
    junk.fill(0x7f)   // double 로 읽으면 전부 거대한 값
    expect(readOleFrameRect(junk)).toBeNull()
  })
})

describe('decodeBmp', () => {
  it('상향식 24bpp 를 top-down RGBA 로 뒤집어 읽는다 (줄 패딩 포함)', () => {
    const bm = decodeBmp(makeBmp())
    expect(bm).not.toBeNull()
    expect(bm!.width).toBe(3)
    expect(bm!.height).toBe(2)
    expect(bm!.validRows).toBe(2)
    // 0번 줄(위) = 파일 1번 줄, BGR → RGBA
    expect([...bm!.rgba.subarray(0, 12)])
      .toEqual([3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255])
    // 1번 줄(아래) = 파일 0번 줄
    expect([...bm!.rgba.subarray(12, 24)])
      .toEqual([30, 20, 10, 255, 60, 50, 40, 255, 90, 80, 70, 255])
  })

  it('데이터가 잘리면 채운 줄 수만 알려주고 나머지는 비워둔다', () => {
    const bmp = makeBmp()
    // 픽셀 한 줄(12바이트)만 유효하게 잘라본다
    const bm = decodeBmp(bmp, 14 + 40 + 12)
    expect(bm).not.toBeNull()
    expect(bm!.height).toBe(2)
    expect(bm!.validRows).toBe(1)
    // 상향식이라 복원되는 건 **아래** 줄이다
    expect([...bm!.rgba.subarray(12, 24)])
      .toEqual([30, 20, 10, 255, 60, 50, 40, 255, 90, 80, 70, 255])
    expect([...bm!.rgba.subarray(0, 12)]).toEqual(new Array(12).fill(0))
  })

  it("'BM' 이 아니면 null", () => {
    const bmp = makeBmp()
    bmp[0] = 0x00
    expect(decodeBmp(bmp)).toBeNull()
  })

  it('32bpp BI_RGB 의 알파 0 패딩은 불투명으로 올려준다', () => {
    // 이걸 안 하면 완전 투명 — "불러왔는데 아무것도 안 보인다" 의 정체다.
    const pixOff = 14 + 40
    const bmp = new Uint8Array(pixOff + 8)
    const dv = new DataView(bmp.buffer)
    bmp[0] = 0x42; bmp[1] = 0x4d
    dv.setUint32(2, bmp.byteLength, true)
    dv.setUint32(10, pixOff, true)
    dv.setUint32(14, 40, true)
    dv.setInt32(18, 2, true)
    dv.setInt32(22, 1, true)
    dv.setUint16(28, 32, true)
    dv.setUint32(30, 0, true)
    bmp.set([11, 22, 33, 0, 44, 55, 66, 0], pixOff)   // BGRA, 알파 전부 0
    const bm = decodeBmp(bmp)
    expect(bm).not.toBeNull()
    expect([...bm!.rgba]).toEqual([33, 22, 11, 255, 66, 55, 44, 255])
  })
})

describe('복합문서 열기', () => {
  it('CFBF 서명 위치를 찾는다', () => {
    const blob = makeOleBlob(QUAD, makeCompound('Ole10Native', new Uint8Array(8)))
    expect(findCompoundDoc(blob)).toBe(128)
  })

  it('서명이 없으면 -1', () => {
    expect(findCompoundDoc(new Uint8Array(500))).toBe(-1)
  })

  it('디렉터리를 읽고 스트림 바이트를 꺼낸다', () => {
    const payload = new Uint8Array(700)
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 3) & 0xff
    const doc = makeCompound('Ole10Native', payload)
    const cf = openCompound(doc, 0)
    expect(cf).not.toBeNull()
    // 이름 앞에 제어문자가 붙으므로 === 비교로는 절대 안 걸린다
    const e = cf!.entries.find((x) => x.type === 2 && x.name.endsWith('Ole10Native'))
    expect(e).toBeDefined()
    expect(e!.size).toBe(700)
    const { data, validBytes } = cf!.read(e!.start, e!.size)
    expect(validBytes).toBe(700)
    expect([...data.subarray(0, 700)]).toEqual([...payload])
  })
})

describe('readOleBitmap', () => {
  it('OLE2FRAME 덩어리 → 비트맵 (Ole10Native 의 u32 길이 접두사까지 건너뛴다)', () => {
    const bmp = makeBmp()
    const native = new Uint8Array(4 + bmp.byteLength)
    new DataView(native.buffer).setUint32(0, bmp.byteLength, true)
    native.set(bmp, 4)

    const blob = makeOleBlob(QUAD, makeCompound('Ole10Native', native))
    const bm = readOleBitmap(blob)
    expect(bm).not.toBeNull()
    expect(bm!.width).toBe(3)
    expect(bm!.height).toBe(2)
    expect(bm!.validRows).toBe(2)
    expect([...bm!.rgba.subarray(0, 12)])
      .toEqual([3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255])
  })

  it('접두사 없이 바로 BMP 인 스트림(OlePres000)도 읽는다', () => {
    const blob = makeOleBlob(QUAD, makeCompound('OlePres000', makeBmp()))
    const bm = readOleBitmap(blob)
    expect(bm).not.toBeNull()
    expect(bm!.width).toBe(3)
  })

  it('hex 로 왕복해도 같은 결과가 나온다 (DXF 가 품는 모양 그대로)', () => {
    const blob = makeOleBlob(QUAD, makeCompound('OlePres000', makeBmp()))
    const back = hexChunksToBytes(toHexChunks(blob))
    expect(readOleFrameRect(back)).toEqual({ minX: 100, minY: 50, maxX: 300, maxY: 200 })
    expect(readOleBitmap(back)?.width).toBe(3)
  })

  it('복합문서가 없으면 null', () => {
    expect(readOleBitmap(new Uint8Array(400))).toBeNull()
  })

  it('변환기가 중간에서 자른 덩어리도 버티고 채운 줄 수를 알려준다', () => {
    // dwgdxf 는 고정 버퍼(10MB)에서 임베디드 바이너리를 잘라 내놓는다.
    // 거기서 터지면 사진은커녕 임포트 전체가 날아간다.
    const blob = makeOleBlob(QUAD, makeCompound('OlePres000', makeBmp()))
    // 스트림 데이터는 뚝어리 머리(128) + 헤더/FAT/디렉터리 3섹터 뒤에 있다.
    // 거기서 DIB 헤더(54) + 픽셀 한 줄(12) 만 남기고 자른다 — 섹터 하나가
    // 반만 들어온 상황이라, 섹터 단위로 버리면 그 한 줄도 날아간다.
    const cut = blob.subarray(0, 128 + 3 * 512 + 54 + 12)
    const bm = readOleBitmap(cut)
    expect(bm).not.toBeNull()
    expect(bm!.height).toBe(2)
    expect(bm!.validRows).toBe(1)
  })
})

// ───────── 워커 왕복: OLE2FRAME 이 다시 스킵 목록에 들어가면 여기서 터진다 ─────────

/** Pad group code to 3 chars (standard DXF convention) */
const g = (c: number) => String(c).padStart(3)

type OleOut = {
  layer: string; width: number; height: number
  minX: number; minY: number; maxX: number; maxY: number
  kind: 'rgba' | 'encoded'
  /** kind === 'rgba' 일 때만 */
  validRows?: number
  rgba?: Uint8Array
  /** kind === 'encoded' 일 때만 */
  mime?: string
  bytes?: Uint8Array
  truncated?: boolean
}

function parseViaWorker(dxfText: string, selectedLayers: string[]): Promise<OleOut[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker mock timeout (10s)')), 10000)
    const origPost = self.postMessage
    self.postMessage = (msg: Record<string, unknown>) => {
      if (msg.type === 'result') {
        clearTimeout(timeout)
        self.postMessage = origPost
        resolve((msg.oleImages || []) as OleOut[])
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
 * OLE2FRAME 한 장이 들어간 최소 DXF.
 *
 * gc 10/11 은 성수 파일과 같은 쓰레기값(1×1 뒤집힘)을 넣는다 — 그걸 믿으면
 * 원점에 점 하나가 찍히므로, 덩어리 앞머리의 꼭지점을 썼는지가 바로 드러난다.
 * gc 310 은 실제 DXF 처럼 127바이트(= hex 254자)씩 끊는다.
 */
function makeOleDxf(blob: Uint8Array, layer = 'IMG'): string {
  const header = `${g(0)}\nSECTION\n${g(2)}\nHEADER\n${g(9)}\n$INSUNITS\n${g(70)}\n4\n${g(0)}\nENDSEC\n`
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `${g(0)}\nLINE\n${g(8)}\n${layer}\n${g(10)}\n${x1}\n${g(20)}\n${y1}\n${g(30)}\n0\n` +
    `${g(11)}\n${x2}\n${g(21)}\n${y2}\n${g(31)}\n0\n`

  const chunks = toHexChunks(blob).map((c) => `${g(310)}\n${c}\n`).join('')
  const ole =
    `${g(0)}\nOLE2FRAME\n${g(5)}\n3A\n${g(8)}\n${layer}\n${g(70)}\n2\n` +
    `${g(10)}\n1.0\n${g(20)}\n1.0\n${g(30)}\n0.0\n` +
    `${g(11)}\n0.0\n${g(21)}\n0.0\n${g(31)}\n0.0\n` +
    `${g(71)}\n2\n${g(72)}\n0\n${g(73)}\n0\n` +
    `${g(90)}\n${blob.byteLength}\n${chunks}${g(1)}\nOLE\n`

  const entities = `${g(0)}\nSECTION\n${g(2)}\nENTITIES\n` +
    line(100, 50, 300, 50) + line(300, 50, 300, 200) + ole + `${g(0)}\nENDSEC\n`
  return header + entities + `${g(0)}\nEOF\n`
}

describe('워커: OLE2FRAME', () => {
  it('엔티티를 버리지 않고 래스터 이미지를 꺼낸다', async () => {
    const bmp = makeBmp()
    const native = new Uint8Array(4 + bmp.byteLength)
    new DataView(native.buffer).setUint32(0, bmp.byteLength, true)
    native.set(bmp, 4)
    const blob = makeOleBlob(QUAD, makeCompound('\x01Ole10Native', native))

    const images = await parseViaWorker(makeOleDxf(blob), ['IMG'])
    expect(images.length).toBe(1)
    const im = images[0]
    expect(im.layer).toBe('IMG')
    expect(im.width).toBe(3)
    expect(im.height).toBe(2)
    expect(im.kind).toBe('rgba')
    expect(im.validRows).toBe(2)
    // gc 10/11 의 1×1 쓰레기가 아니라 덩어리 앞머리의 꼭지점을 썼어야 한다
    expect(im.minX).toBe(100)
    expect(im.maxX).toBe(300)
    expect(im.minY).toBe(50)
    expect(im.maxY).toBe(200)
    expect([...im.rgba!.subarray(0, 4)]).toEqual([3, 2, 1, 255])
  })

  it('덩어리가 이미지가 아니면 조용히 건너뛴다 (임포트 전체를 날리지 않는다)', async () => {
    const junk = new Uint8Array(400)
    junk.fill(0x41)
    const images = await parseViaWorker(makeOleDxf(junk), ['IMG'])
    expect(images.length).toBe(0)
  })
})

// ───────── 파일 헤더 없는 DIB · 브라우저가 푸는 포맷 ─────────

/** makeBmp 와 같은 그림을, 'BM' 파일 헤더 없이 BITMAPINFOHEADER 부터. */
function makeDibOnly(): Uint8Array {
  return makeBmp().subarray(14)
}

/** 2x2 8bpp 팔레트 DIB (상향식). 팔레트 오프셋 계산을 잡으려고 둔다. */
function makePaletteDib(): Uint8Array {
  const colors = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]]   // RGB
  const stride = 4            // 폭 2 → 2바이트지만 4의 배수로 올림
  const dib = new Uint8Array(40 + colors.length * 4 + stride * 2)
  const dv = new DataView(dib.buffer)
  dv.setUint32(0, 40, true)
  dv.setInt32(4, 2, true)      // width
  dv.setInt32(8, 2, true)      // height > 0 → 상향식
  dv.setUint16(12, 1, true)    // planes
  dv.setUint16(14, 8, true)    // bpp
  dv.setUint32(16, 0, true)    // BI_RGB
  dv.setUint32(32, colors.length, true)   // biClrUsed
  colors.forEach(([r, g_, b], i) => {
    const o = 40 + i * 4
    dib[o] = b; dib[o + 1] = g_; dib[o + 2] = r; dib[o + 3] = 0   // BGRA
  })
  const pix = 40 + colors.length * 4
  dib[pix] = 1; dib[pix + 1] = 2                 // 파일 0번 줄 = 아래 줄: 빨강, 초록
  dib[pix + stride] = 3; dib[pix + stride + 1] = 0  // 파일 1번 줄 = 위 줄: 파랑, 검정
  return dib
}

function makePng(width: number, height: number): Uint8Array {
  const out = new Uint8Array(8 + 25)
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const dv = new DataView(out.buffer)
  dv.setUint32(8, 13, false)                       // IHDR 길이
  out.set([0x49, 0x48, 0x44, 0x52], 12)            // 'IHDR'
  dv.setUint32(16, width, false)
  dv.setUint32(20, height, false)
  out[24] = 8; out[25] = 2                         // 8bit, truecolor
  return out
}

function makeJpeg(width: number, height: number): Uint8Array {
  const out = new Uint8Array(2 + 18 + 19 + 2)
  const dv = new DataView(out.buffer)
  let p = 0
  out[p++] = 0xff; out[p++] = 0xd8                 // SOI
  out[p++] = 0xff; out[p++] = 0xe0                 // APP0
  dv.setUint16(p, 16, false); p += 16              // 길이 16 (자신 포함)
  out[p++] = 0xff; out[p++] = 0xc0                 // SOF0
  dv.setUint16(p, 17, false); p += 2               // 길이 17
  out[p++] = 8                                      // precision
  dv.setUint16(p, height, false); p += 2
  dv.setUint16(p, width, false); p += 2
  out[p++] = 3                                      // 컴포넌트 3개
  p += 9
  out[p++] = 0xff; out[p++] = 0xd9                 // EOI
  return out.subarray(0, p)
}

function makeGif(width: number, height: number): Uint8Array {
  const out = new Uint8Array(13)
  out.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0)   // 'GIF89a'
  const dv = new DataView(out.buffer)
  dv.setUint16(6, width, true)
  dv.setUint16(8, height, true)
  return out
}

/** 앞에 쓰레기 머리말을 붙인다 (OlePres000 의 가변 메타파일 헤더 흉내). */
function withPreamble(body: Uint8Array, len: number): Uint8Array {
  const out = new Uint8Array(len + body.byteLength)
  for (let i = 0; i < len; i++) out[i] = (i * 13 + 7) & 0xff
  out.set(body, len)
  return out
}

describe('decodeDib (파일 헤더 없는 DIB)', () => {
  it('BITMAPINFOHEADER 부터 시작하는 DIB 를 읽는다', () => {
    const bm = decodeDib(makeDibOnly())
    expect(bm).not.toBeNull()
    expect(bm!.width).toBe(3)
    expect(bm!.height).toBe(2)
    expect(bm!.validRows).toBe(2)
    // 상향식이므로 top-down 0번 줄은 파일의 둘째 줄 (BGR → RGB 뒤집기까지 확인)
    expect([...bm!.rgba.subarray(0, 12)])
      .toEqual([3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255])
  })

  it('8bpp 팔레트의 픽셀 오프셋을 팔레트 크기만큼 밀어서 읽는다', () => {
    const bm = decodeDib(makePaletteDib())
    expect(bm).not.toBeNull()
    expect(bm!.width).toBe(2)
    // 위 줄 = 파일 둘째 줄 = 파랑, 검정
    expect([...bm!.rgba.subarray(0, 8)]).toEqual([0, 0, 255, 255, 0, 0, 0, 255])
    // 아래 줄 = 파일 첫 줄 = 빨강, 초록
    expect([...bm!.rgba.subarray(8, 16)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  })

  it('DIB 가 아니면 null', () => {
    expect(decodeDib(new Uint8Array(100))).toBeNull()
  })
})

describe('findDibHeader', () => {
  it('가변 머리말 뒤의 BITMAPINFOHEADER 를 찾는다', () => {
    expect(findDibHeader(withPreamble(makeDibOnly(), 24))).toBe(24)
  })

  it('머리말이 없으면 0', () => {
    expect(findDibHeader(makeDibOnly())).toBe(0)
  })

  it('DIB 가 없으면 -1 (쓰레기를 이미지로 착각하지 않는다)', () => {
    const junk = new Uint8Array(512)
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 31 + 5) & 0xff
    expect(findDibHeader(junk)).toBe(-1)
  })
})

describe('sniffEncodedImage', () => {
  it('PNG 의 IHDR 에서 치수를 읽는다', () => {
    expect(sniffEncodedImage(makePng(640, 480)))
      .toEqual({ mime: 'image/png', width: 640, height: 480, offset: 0 })
  })

  it('JPEG 는 APP0 를 건너뛰고 SOF0 에서 치수를 읽는다', () => {
    expect(sniffEncodedImage(makeJpeg(1792, 2326)))
      .toEqual({ mime: 'image/jpeg', width: 1792, height: 2326, offset: 0 })
  })

  it('GIF 는 논리 화면 크기를 읽는다 (리틀엔디언)', () => {
    expect(sniffEncodedImage(makeGif(320, 200)))
      .toEqual({ mime: 'image/gif', width: 320, height: 200, offset: 0 })
  })

  it('가변 머리말 뒤에 묻힌 매직도 찾아 오프셋을 알려준다', () => {
    const enc = sniffEncodedImage(withPreamble(makeJpeg(80, 60), 37))
    expect(enc?.mime).toBe('image/jpeg')
    expect(enc?.offset).toBe(37)
    expect(enc?.width).toBe(80)
  })

  it('이미지가 없으면 null', () => {
    const junk = new Uint8Array(512)
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 17 + 3) & 0xff
    expect(sniffEncodedImage(junk)).toBeNull()
  })

  it('프레임 헤더 없이 스캔이 시작되는 JPEG 는 거부한다', () => {
    // FFD8 FF DA (SOI 직후 SOS) — 치수를 알 길이 없으니 넘기면 안 된다
    expect(sniffEncodedImage(new Uint8Array([
      0xff, 0xd8, 0xff, 0xda, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]))).toBeNull()
  })
})

describe('readOleImage', () => {
  it('OlePres000 의 raw DIB(파일 헤더 없음)를 꺼낸다', () => {
    const blob = makeOleBlob(QUAD, makeCompound('\x02OlePres000', withPreamble(makeDibOnly(), 40)))
    const img = readOleImage(blob)
    expect(img?.kind).toBe('rgba')
    expect(img?.width).toBe(3)
  })

  it('CONTENTS 의 JPEG 는 풀지 않고 바이트째로 넘긴다', () => {
    const jpg = makeJpeg(1024, 768)
    const blob = makeOleBlob(QUAD, makeCompound('CONTENTS', jpg))
    const img = readOleImage(blob)
    expect(img?.kind).toBe('encoded')
    if (img?.kind !== 'encoded') throw new Error('encoded 가 아니다')
    expect(img.mime).toBe('image/jpeg')
    expect(img.width).toBe(1024)
    expect(img.height).toBe(768)
    expect(img.truncated).toBe(false)
    expect([...img.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  })

  it('Ole10Native(Package) 의 가변 라벨·경로 뒤에 있는 PNG 도 찾는다', () => {
    // 실제 Package 는 u32 크기 + 라벨\0 + 경로\0 + ... 뒤에 파일이 온다.
    // 길이가 들쭉날쭉해서 고정 오프셋으로는 못 잡는다.
    const png = makePng(500, 400)
    const label = new TextEncoder().encode('plan.png\0C:\\work\\plan.png\0')
    const native = new Uint8Array(4 + label.byteLength + png.byteLength)
    new DataView(native.buffer).setUint32(0, native.byteLength, true)
    native.set(label, 4)
    native.set(png, 4 + label.byteLength)

    const img = readOleImage(makeOleBlob(QUAD, makeCompound('\x01Ole10Native', native)))
    expect(img?.kind).toBe('encoded')
    if (img?.kind !== 'encoded') throw new Error('encoded 가 아니다')
    expect(img.mime).toBe('image/png')
    expect(img.width).toBe(500)
    expect(img.height).toBe(400)
  })

  it('잘린 encoded 이미지는 truncated 로 표시하고 받은 데까지만 넘긴다', () => {
    const jpg = makeJpeg(200, 100)
    const payload = new Uint8Array(900)      // 섹터 두 개짜리로 키운다
    payload.set(jpg, 0)
    const doc = makeCompound('CONTENTS', payload)
    const full = makeOleBlob(QUAD, doc)
    // 데이터 둘째 섹터가 반만 들어온 상태
    const cut = full.subarray(0, 128 + 3 * 512 + 200)

    const img = readOleImage(cut)
    expect(img?.kind).toBe('encoded')
    if (img?.kind !== 'encoded') throw new Error('encoded 가 아니다')
    expect(img.truncated).toBe(true)
    expect(img.bytes.byteLength).toBeLessThan(payload.byteLength)
    expect(img.bytes.byteLength).toBeGreaterThan(0)
  })

  it('readOleBitmap 은 encoded 를 rgba 로 둔갑시키지 않는다 (null)', () => {
    const blob = makeOleBlob(QUAD, makeCompound('CONTENTS', makePng(10, 10)))
    expect(readOleBitmap(blob)).toBeNull()
    expect(readOleImage(blob)?.kind).toBe('encoded')
  })
})

describe('워커: OLE2FRAME 의 JPEG/PNG', () => {
  it('JPEG 는 rgba 로 풀지 않고 mime 과 바이트로 넘어온다', async () => {
    const jpg = makeJpeg(1792, 2326)
    const blob = makeOleBlob(QUAD, makeCompound('CONTENTS', jpg))
    const images = await parseViaWorker(makeOleDxf(blob), ['IMG'])
    expect(images.length).toBe(1)
    const im = images[0]
    expect(im.kind).toBe('encoded')
    expect(im.mime).toBe('image/jpeg')
    expect(im.width).toBe(1792)
    expect(im.height).toBe(2326)
    expect(im.rgba).toBeUndefined()
    expect([...im.bytes!.subarray(0, 2)]).toEqual([0xff, 0xd8])
    // 좌표는 BMP 경로와 똑같이 덩어리 앞머리의 꼭지점을 쓴다
    expect(im.minX).toBe(100)
    expect(im.maxY).toBe(200)
  })
})
