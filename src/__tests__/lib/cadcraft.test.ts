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
