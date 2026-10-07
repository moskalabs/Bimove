/**
 * 섹션 스캔 — byte 0 / CRLF.
 *
 * 둘 다 "에러 없이 조용히 틀리는" 종류다:
 *
 * 1) extractSection 이 바늘 앞에 줄바꿈을 붙여 indexOf 했다. 표준 DXF 는
 *    HEADER 가 파일 맨 앞(인덱스 0)에 오므로 **한 번도 못 찾았다.**
 *    → $INSUNITS 를 못 읽어 늘 mm 로 가정. inch 도면이 25.4배 틀린 축척으로
 *      들어오는데 경고 한 줄 없다.
 *
 * 2) 파서 전체가 LF 기준 문자열로 indexOf 를 한다. 윈도우 오토캐드가 내보낸
 *    CRLF DXF 는 바늘이 하나도 안 맞아 섹션을 통째로 못 찾고 빈 도면이 된다.
 *    → decodeDxfBytes 가 디코딩 직후 CRLF 를 LF 로 통일한다.
 */
import { describe, it, expect } from 'vitest'
import { extractSection } from '../../lib/dxf-fast-worker'
import { decodeDxfBytes } from '../../lib/dxf'
import { detectPadding, makeGcFormatter } from '../../lib/dxf-shared'

/** (code, value) 쌍을 DXF 줄로 */
function lines(pad: boolean, ...pairs: [number, string | number][]): string {
  const gc = makeGcFormatter(pad)
  return pairs.map(([c, v]) => `${gc(c)}\n${v}`).join('\n')
}

function headerDxf(pad: boolean, prefix = ''): string {
  return prefix + lines(pad,
    [0, 'SECTION'], [2, 'HEADER'],
    [9, '$INSUNITS'], [70, 1],
    [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'TABLES'],
    [0, 'ENDSEC'],
    [0, 'EOF'],
  )
}

function scan(dxf: string, name: string) {
  return extractSection(dxf, name, makeGcFormatter(detectPadding(dxf)))
}

describe('extractSection', () => {
  it('파일 맨 앞(byte 0)에 있는 섹션을 찾는다 — unpadded', () => {
    const dxf = headerDxf(false)
    expect(dxf.startsWith('0\nSECTION')).toBe(true)  // 전제: 진짜 byte 0
    const body = scan(dxf, 'HEADER')
    expect(body).not.toBeNull()
    expect(body).toContain('$INSUNITS')
  })

  it('파일 맨 앞에 있는 섹션을 찾는다 — padded (오토캐드 형식)', () => {
    const dxf = headerDxf(true)
    expect(dxf.startsWith('  0\nSECTION')).toBe(true)
    const body = scan(dxf, 'HEADER')
    expect(body).not.toBeNull()
    expect(body).toContain('$INSUNITS')
  })

  // 앞에 999 주석이 붙은 DXF — 전에도 되던 경로가 안 깨졌는지
  it('앞에 다른 줄이 있어도 찾는다', () => {
    const dxf = headerDxf(false, '999\nmade by test\n')
    const body = scan(dxf, 'HEADER')
    expect(body).not.toBeNull()
    expect(body).toContain('$INSUNITS')
  })

  it('맨 앞이 아닌 섹션도 찾는다', () => {
    const body = scan(headerDxf(false), 'TABLES')
    expect(body).not.toBeNull()
  })

  it('없는 섹션은 null', () => {
    expect(scan(headerDxf(false), 'OBJECTS')).toBeNull()
  })

  // "HEADER" 로 시작하는 다른 이름에 걸려들지 않아야 한다
  it('이름이 정확히 맞아야 한다', () => {
    const dxf = lines(false, [0, 'SECTION'], [2, 'HEADERX'], [0, 'ENDSEC'], [0, 'EOF'])
    expect(scan(dxf, 'HEADER')).toBeNull()
  })

  it('ENDSEC 이 없으면 null (잘린 파일)', () => {
    const dxf = lines(false, [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 1])
    expect(scan(dxf, 'HEADER')).toBeNull()
  })
})

describe('decodeDxfBytes — 줄바꿈 통일', () => {
  const enc = (s: string) => new TextEncoder().encode(s)

  it('CRLF 를 LF 로 바꾼다', () => {
    const src = headerDxf(false).replace(/\n/g, '\r\n')
    const out = decodeDxfBytes(enc(src))
    expect(out).not.toContain('\r')
    expect(out).toBe(headerDxf(false))
  })

  it('CRLF DXF 도 섹션 스캔이 된다 (디코딩을 거치면)', () => {
    const src = headerDxf(false).replace(/\n/g, '\r\n')
    // 디코딩 전: 못 찾는다
    expect(scan(src, 'HEADER')).toBeNull()
    // 디코딩 후: 찾는다
    expect(scan(decodeDxfBytes(enc(src)), 'HEADER')).not.toBeNull()
  })

  it('CR 단독(구형 Mac) 도 LF 로', () => {
    const out = decodeDxfBytes(enc('0\rSECTION\r2\rHEADER\r0\rENDSEC\r0\rEOF'))
    expect(out).toBe('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF')
  })

  it('LF 뿐이면 그대로 둔다', () => {
    const src = headerDxf(false)
    expect(decodeDxfBytes(enc(src))).toBe(src)
  })
})
