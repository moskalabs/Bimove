/**
 * OLE 파서가 **파일이 말하는 숫자를 그대로 믿지 않는가.**
 *
 * 외부 바이너리를 읽는 코드라 경계 검사가 곳곳에 있었는데, 정작 **할당** 두
 * 군데가 비어 있었다.
 *
 *   1. CFBF 스트림 크기는 디렉터리의 32비트 필드다 — 4GB 까지 적힌다.
 *      `new Uint8Array(size)` 를 그대로 하면 100바이트짜리 헤더 하나로 탭이 죽는다.
 *   2. 비트맵은 가로·세로를 각각 32768 로 막고 있었다. 그 둘을 곱하면
 *      10억 7천만 화소 = RGBA 로 **4GB** 다. 막은 게 아니었다.
 *
 * 둘 다 "선언한 크기" 와 "실제로 있는 바이트" 가 다를 수 있다는 같은 종류의
 * 구멍이다. 잘린 파일은 정상 경로라(복원해서 쓴다) 거절하면 안 되고,
 * **할당만** 막아야 한다.
 */
import { describe, it, expect } from 'vitest'
import { clampStreamSize, decodeDib } from '../../lib/dxfOle'

describe('clampStreamSize', () => {
  it('문서보다 크게 적혀 있으면 **문서 크기로** 자른다', () => {
    // 4GB 라고 적힌 스트림. 채울 바이트가 애초에 없다.
    expect(clampStreamSize(0xffffffff, 50_000)).toBe(50_000)
  })

  it('안쪽이면 그대로 둔다 — 잘린 파일 복원을 막으면 안 된다', () => {
    expect(clampStreamSize(1234, 50_000)).toBe(1234)
  })

  it('말이 안 되는 값은 0', () => {
    expect(clampStreamSize(-1, 50_000)).toBe(0)
    expect(clampStreamSize(NaN, 50_000)).toBe(0)
    expect(clampStreamSize(0, 50_000)).toBe(0)
  })

  it('문서가 비었으면 0 (음수 길이를 만들지 않는다)', () => {
    expect(clampStreamSize(1000, 0)).toBe(0)
  })
})

/**
 * BITMAPINFOHEADER + **조금의** 픽셀 데이터.
 *
 * 선언한 크기보다 데이터가 한참 모자란 꼴이다 — 변환기가 고정 버퍼에서 잘라
 * 내놓으면 실제로 이렇게 온다. 파서는 있는 데까지만 복원한다. 여기서 재려는
 * 건 **그 선언값을 믿고 통째로 할당하지는 않는가** 다.
 *
 * (픽셀이 0바이트면 파서가 원래 거절한다 — 그건 이 변경과 무관한 기존 계약이다.)
 */
function dibHeader(width: number, height: number, bpp = 24, pixelBytes = 256): Uint8Array {
  const b = new Uint8Array(40 + pixelBytes)
  const dv = new DataView(b.buffer)
  dv.setUint32(0, 40, true)        // biSize
  dv.setInt32(4, width, true)
  dv.setInt32(8, height, true)
  dv.setUint16(12, 1, true)        // planes
  dv.setUint16(14, bpp, true)
  dv.setUint32(16, 0, true)        // BI_RGB
  return b
}

describe('decodeDib — 할당 상한', () => {
  it('32768 x 32768 은 **거절한다** (RGBA 로 4GB)', () => {
    // 각 변은 옛 상한을 통과한다. 곱이 문제다.
    expect(decodeDib(dibHeader(32768, 32768))).toBeNull()
  })

  it('현실적인 크기는 받아준다', () => {
    // 800x600, 24bpp → 한 줄 2400바이트. 세 줄치를 준다.
    const r = decodeDib(dibHeader(800, 600, 24, 2400 * 3))
    expect(r).not.toBeNull()
    expect(r!.width).toBe(800)
    expect(r!.height).toBe(600)
  })

  it('변 하나가 상한을 넘으면 여전히 거절', () => {
    expect(decodeDib(dibHeader(40000, 10))).toBeNull()
  })

  it('데이터가 모자라도 **있는 줄까지는** 복원한다 (잘린 파일)', () => {
    // 선언은 600줄인데 데이터는 세 줄뿐. 거절하면 복원 가능한 윗줄까지 버린다.
    const r = decodeDib(dibHeader(800, 600, 24, 2400 * 3))!
    expect(r.rgba.length).toBe(800 * 600 * 4)
  })

  it('**한 줄도 못 채우면 할당 전에** 돌아간다', () => {
    // 전엔 여기서도 선언 크기(수백 MB)를 먼저 잡고 나서 거절했다.
    // 헤더에 큰 숫자만 적어 넣는 공격이 노리는 게 그 사이다.
    expect(decodeDib(dibHeader(8000, 8000, 24, 100))).toBeNull()
  })

  it('픽셀이 아예 0바이트면 거절 — 기존 계약 그대로', () => {
    expect(decodeDib(dibHeader(10, 10, 24, 0))).toBeNull()
  })
})
