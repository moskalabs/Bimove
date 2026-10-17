/**
 * DXF 바이트 → 텍스트.
 *
 * CRLF 정규화에 테스트가 없었다. 그게 깨지면 윈도우 오토캐드 DXF 가 **에러
 * 없이 빈 도면으로** 들어온다 (파서 전체가 LF 기준 바늘로 indexOf 를 한다).
 * 제자리 수정으로 바꾸면서 먼저 덮는다.
 *
 * 사본을 안 만드는 게 목적이므로 "CR 이 없으면 원본을 그대로 돌려준다" 와
 * "제자리에서 고친다" 도 같이 본다 — 그게 깨지면 조용히 수백 MB 를 더 쓴다.
 */
import { describe, it, expect } from 'vitest'
import { decodeDxfBytes } from '../../lib/dxf'

const utf8 = (s: string) => new TextEncoder().encode(s)

describe('decodeDxfBytes: 줄바꿈', () => {
  it('CRLF 를 LF 로 바꾼다', () => {
    expect(decodeDxfBytes(utf8('0\r\nSECTION\r\n2\r\nENTITIES\r\n')))
      .toBe('0\nSECTION\n2\nENTITIES\n')
  })

  it('홀로 있는 CR 도 LF 로 바꾼다 (옛 정규식 /\\r\\n?/g 과 같은 동작)', () => {
    expect(decodeDxfBytes(utf8('0\rSECTION\r'))).toBe('0\nSECTION\n')
  })

  it('CR 과 CRLF 가 섞여 있어도 된다', () => {
    expect(decodeDxfBytes(utf8('a\r\nb\rc\r\n\r\nd')))
      .toBe('a\nb\nc\n\nd')
  })

  it('LF 만 있으면 그대로 둔다', () => {
    const text = '0\nSECTION\n2\nENTITIES\n'
    expect(decodeDxfBytes(utf8(text))).toBe(text)
  })

  it('CR 이 없으면 바이트를 한 개도 건드리지 않는다', () => {
    // 복사도 순회도 없어야 한다 — 큰 도면에서 괜한 한 패스를 막는 지점이다.
    const bytes = utf8('0\nSECTION\n')
    // Array 로 비교한다 — TextEncoder 가 돌려주는 Uint8Array 는 이 테스트
    // 파일의 전역 Uint8Array 와 realm 이 달라서 toEqual 이 생성자로 떨어진다.
    const before = Array.from(bytes)
    decodeDxfBytes(bytes)
    expect(Array.from(bytes)).toEqual(before)
  })

  it('CR 이 있으면 제자리에서 고친다 (사본을 만들지 않는다)', () => {
    // 이게 이 구현의 전부다. 사본을 만들면 통과하지 못한다.
    const bytes = utf8('a\r\nb\r\n')
    decodeDxfBytes(bytes)
    // 'a','\n','b','\n' 가 앞으로 당겨져 있어야 한다
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x61, 0x0A, 0x62, 0x0A])
  })

  it('CR 로 끝나도 잘리지 않는다', () => {
    expect(decodeDxfBytes(utf8('ENDSEC\r'))).toBe('ENDSEC\n')
  })

  it('빈 입력', () => {
    expect(decodeDxfBytes(new Uint8Array(0))).toBe('')
  })
})

describe('decodeDxfBytes: 멀티바이트 안전', () => {
  it('한글(EUC-KR) + CRLF 가 같이 있어도 글자가 안 깨진다', () => {
    // 0x0D 는 EUC-KR 뒤바이트(0x41-0xFE) 범위 밖이라 늘 진짜 CR 이다.
    // 그 전제가 틀리면 한글 한 글자의 뒤바이트를 줄바꿈으로 바꿔버린다.
    // "현장" = C7 F6 C0 E5 (CP949), 코드페이지를 ANSI_949 로 선언해 둔다.
    const head = utf8('  9\n$DWGCODEPAGE\n  3\nANSI_949\r\n  0\nTEXT\r\n  1\n')
    const hangul = new Uint8Array([0xC7, 0xF6, 0xC0, 0xE5])
    const tail = utf8('\r\n  0\nENDSEC\r\n')
    const bytes = new Uint8Array([...head, ...hangul, ...tail])

    const out = decodeDxfBytes(bytes)
    expect(out).toContain('현장')
    expect(out).not.toContain('\r')
    expect(out).toContain('$DWGCODEPAGE')
    expect(out).toContain('ENDSEC')
  })

  it('UTF-8 한글 + CRLF', () => {
    const out = decodeDxfBytes(utf8('  1\n거실 바닥\r\n  0\nENDSEC\r\n'))
    expect(out).toBe('  1\n거실 바닥\n  0\nENDSEC\n')
  })

  it('CR 뒤에 한글이 바로 와도 된다', () => {
    // 당겨쓰기 루프가 한 칸 밀리면 여기서 깨진다.
    const out = decodeDxfBytes(utf8('a\r\n벽체\r\nb'))
    expect(out).toBe('a\n벽체\nb')
  })
})
