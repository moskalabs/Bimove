/**
 * CADCraft 엔진에 넘기기 전 DXF 바이트 손질.
 *
 * DWG→DXF 변환기가 **코드페이지를 거짓말한다** — 헤더엔 `ANSI_1252`(서유럽)라
 * 써놓고 내용은 EUC-KR 바이트다. 그대로 넘기면 엔진이 그 말을 믿고 한글을
 * 깨뜨린다. 실제로 한의 도면을 그렇게 열었다가 제목이 통째로 깨져 나왔고,
 * 한참을 "폰트 문제" 로 오해했다.
 *
 * 여기서 보는 건 "엔진이 믿을 수 있는 바이트가 나가는가" 다.
 */
import { describe, it, expect } from 'vitest'
import { normalizeDxfBytes, OSNAP } from '../../lib/cadcraft'

/** EUC-KR 바이트로 "현장" (C7 F6 C0 E5) */
const HANGUL_EUCKR = new Uint8Array([0xC7, 0xF6, 0xC0, 0xE5])

function bytes(...parts: Array<string | Uint8Array>): Uint8Array {
  const chunks = parts.map(p => (typeof p === 'string' ? new TextEncoder().encode(p) : p))
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

const decode = (b: Uint8Array) => new TextDecoder('utf-8').decode(b)

describe('normalizeDxfBytes', () => {
  it('ANSI_949 로 선언된 EUC-KR 한글을 되살린다', () => {
    const src = bytes(
      '  9\n$DWGCODEPAGE\n  3\nANSI_949\n  0\nTEXT\n  1\n', HANGUL_EUCKR, '\n  0\nENDSEC\n',
    )
    expect(decode(normalizeDxfBytes(src))).toContain('현장')
  })

  it('헤더를 UTF8 로 고쳐 넘긴다 — 안 그러면 엔진이 또 틀리게 읽는다', () => {
    const src = bytes('  9\n$DWGCODEPAGE\n  3\nANSI_949\n  0\nEOF\n')
    const out = decode(normalizeDxfBytes(src))
    expect(out).toContain('$DWGCODEPAGE')
    expect(out).toContain('UTF8')
    expect(out).not.toContain('ANSI_949')
  })

  it('이미 UTF-8 인 한글은 그대로 둔다', () => {
    const src = bytes('  9\n$DWGCODEPAGE\n  3\nANSI_949\n  1\n거실 바닥\n  0\nEOF\n')
    expect(decode(normalizeDxfBytes(src))).toContain('거실 바닥')
  })

  it('코드페이지 줄이 없어도 터지지 않는다', () => {
    const src = bytes('  0\nSECTION\n  2\nENTITIES\n  0\nEOF\n')
    expect(decode(normalizeDxfBytes(src))).toContain('ENTITIES')
  })

  it('CRLF 파일도 헤더를 고친다', () => {
    // 윈도우 오토캐드가 내보낸 DXF 는 CRLF 다. 정규식이 \n 만 보면 안 걸린다.
    const src = bytes('  9\r\n$DWGCODEPAGE\r\n  3\r\nANSI_1252\r\n  0\r\nEOF\r\n')
    const out = decode(normalizeDxfBytes(src))
    expect(out).toContain('UTF8')
    expect(out).not.toContain('ANSI_1252')
  })

  it('빈 입력', () => {
    expect(normalizeDxfBytes(new Uint8Array(0)).length).toBe(0)
  })

  // ── 큰 파일에서 사본을 만들지 않는다 ──
  //
  // 150MB DXF 를 디코딩하면 문자열만 300MB(한글 2바이트/자) 고, replace 와
  // 인코딩이 또 하나씩이다. 그런데 고칠 게 없는 파일이 대부분이다.
  // "내용이 같다" 로는 이걸 못 지킨다 — 같은 바이트를 **그대로** 돌려주는지
  // 신원(===)으로 본다.

  it('멀쩡한 파일은 원본 배열을 그대로 돌려준다 — 사본 0', () => {
    const src = bytes('  9\n$DWGCODEPAGE\n  3\nUTF8\n  1\n거실 바닥\n  0\nEOF\n')
    expect(normalizeDxfBytes(src)).toBe(src)
  })

  it('코드페이지 줄이 없고 UTF-8 이면 그대로 돌려준다', () => {
    const src = bytes('  0\nSECTION\n  2\nENTITIES\n  1\n현장 도면\n  0\nEOF\n')
    expect(normalizeDxfBytes(src)).toBe(src)
  })

  it('UTF-8 인데 헤더만 거짓말이면 헤더만 갈아끼운다 — 본문은 건드리지 않는다', () => {
    const body = '  1\n거실 바닥 마감\n  0\nEOF\n'
    const src = bytes('  9\n$DWGCODEPAGE\n  3\nANSI_1252\n', body)
    const out = normalizeDxfBytes(src)
    expect(out).not.toBe(src)
    expect(decode(out)).toBe('  9\n$DWGCODEPAGE\n  3\nUTF8\n' + body)
    // 'ANSI_1252'(9) → 'UTF8'(4) 만큼만 줄어든다
    expect(out.length).toBe(src.length - 5)
  })

  it('CRLF 파일도 헤더만 갈아끼운다', () => {
    const src = bytes('  9\r\n$DWGCODEPAGE\r\n  3\r\nANSI_1252\r\n  1\r\n현장\r\n  0\r\nEOF\r\n')
    const out = decode(normalizeDxfBytes(src))
    expect(out).toBe('  9\r\n$DWGCODEPAGE\r\n  3\r\nUTF8\r\n  1\r\n현장\r\n  0\r\nEOF\r\n')
  })

  it('UTF-8 이 아니면 옛 경로로 간다 — 깨진 바이트를 그냥 넘기지 않는다', () => {
    const src = bytes('  9\n$DWGCODEPAGE\n  3\nANSI_949\n  1\n', HANGUL_EUCKR, '\n  0\nEOF\n')
    const out = normalizeDxfBytes(src)
    expect(out).not.toBe(src)
    expect(decode(out)).toContain('현장')
  })
})

describe('OSNAP 비트', () => {
  it('오토캐드 OSMODE 값과 같다', () => {
    // 엔진이 이 숫자를 그대로 받는다. 하나라도 어긋나면 "끝점을 켰는데
    // 중간점에 붙는" 식으로 조용히 엉뚱해진다.
    expect(OSNAP.END).toBe(1)
    expect(OSNAP.MID).toBe(2)
    expect(OSNAP.CEN).toBe(4)
    expect(OSNAP.INT).toBe(32)
    expect(OSNAP.PER).toBe(128)
    expect(OSNAP.NEA).toBe(512)
    expect(OSNAP.EXT).toBe(4096)
  })

  it('전부 2의 거듭제곱이고 서로 겹치지 않는다', () => {
    const vals = Object.values(OSNAP)
    for (const v of vals) expect(v & (v - 1)).toBe(0)
    expect(new Set(vals).size).toBe(vals.length)
  })
})
