/**
 * DXF **인코딩** 처리.
 *
 * ── 2026-10-19: 엔티티 변환 테스트를 걷어냈다 ──
 *
 * 이 파일의 대부분(61개 중 50여 개)은 `dxf.ts` 의 `parseDxfSegments` /
 * `parseDxfHatches` 를 보고 있었다. 그 둘은 **원문이 아니라 이미 파싱된 엔티티
 * 객체**를 받았는데, 그걸 만들어 주던 dxf-parser(npm) 경로가 지워지면서
 * 호출자가 사라졌다 — 앱에서도 라이브러리 안에서도 안 불리는 죽은 코드였다.
 *
 * 초록불이 지키던 게 없었다는 뜻이다. 실제로 DXF 를 읽는 건 dxf-fast-worker
 * 하나고, 공통 수학(호 샘플링·mtext·레이아웃)은 dxf-shared 에 있으며 둘 다
 * 직접 테스트된다. 그래서 파서와 함께 지웠다.
 *
 * 여기 남긴 건 **아직 출하되는** 인코딩 판별/복구다.
 */
import { describe, it, expect } from 'vitest'
import { detectDxfEncoding, reverseDoubleEncodingIfNeeded } from '../../lib/dxf'

describe('detectDxfEncoding: raw byte detection', () => {
  /** Helper: string → ArrayBuffer (UTF-8) */
  function strToBuffer(s: string): ArrayBuffer {
    return new TextEncoder().encode(s).buffer
  }

  /** Helper: raw byte array → ArrayBuffer */
  function bytesToBuffer(arr: number[]): ArrayBuffer {
    return new Uint8Array(arr).buffer
  }

  it('detects $DWGCODEPAGE ANSI_949 from raw bytes', () => {
    const dxf = '  9\n$DWGCODEPAGE\n  3\nANSI_949\n  0\nEOF\n'
    expect(detectDxfEncoding(strToBuffer(dxf))).toBe('euc-kr')
  })

  it('detects $DWGCODEPAGE ANSI_936 (Chinese)', () => {
    const dxf = '  9\n$DWGCODEPAGE\n  3\nANSI_936\n  0\nEOF\n'
    expect(detectDxfEncoding(strToBuffer(dxf))).toBe('euc-kr')
  })

  it('returns utf-8 for ASCII-only DXF', () => {
    const dxf = '  0\nSECTION\n  2\nHEADER\n  9\n$INSUNITS\n 70\n4\n  0\nENDSEC\n  0\nEOF\n'
    expect(detectDxfEncoding(strToBuffer(dxf))).toBe('utf-8')
  })

  it('returns utf-8 for DXF with valid UTF-8 Korean', () => {
    // 유효한 UTF-8 한글 → euc-kr 패턴 없음 → utf-8
    const dxf = '  0\nTEXT\n  1\n평면도\n  0\nEOF\n'
    expect(detectDxfEncoding(strToBuffer(dxf))).toBe('utf-8')
  })

  it('detects EUC-KR byte patterns without $DWGCODEPAGE header', () => {
    // "평면" in EUC-KR = 0xC6, 0xF2, 0xB8, 0xE9
    // 0xB8 is in range 0xB0-0xC8, 0xE9 is in range 0xA1-0xFE → detected
    const eucKrBytes = [
      0x20, 0x20, 0x30, 0x0A, // "  0\n"
      0x54, 0x45, 0x58, 0x54, 0x0A, // "TEXT\n"
      0x20, 0x20, 0x31, 0x0A, // "  1\n"
      0xC6, 0xF2, 0xB8, 0xE9, 0x0A, // "평면" in EUC-KR + \n
      0x20, 0x20, 0x30, 0x0A, // "  0\n"
      0x45, 0x4F, 0x46, 0x0A, // "EOF\n"
    ]
    expect(detectDxfEncoding(bytesToBuffer(eucKrBytes))).toBe('euc-kr')
  })

  it('detects EUC-KR even when bytes form valid UTF-8 sequences', () => {
    // "타일" in EUC-KR = 0xC5, 0xB8, 0xC0, 0xCF
    // 0xC5 0xB8 is a valid UTF-8 2-byte sequence → no U+FFFD!
    // But 0xC5 is in range 0xB0-0xC8, would fail. Let's use enough chars
    // "가나다라" in EUC-KR: B0 A1, B3 AA, B4 D9, B6 F3
    const eucKrBytes = [
      0x20, 0x20, 0x30, 0x0A,
      0x54, 0x45, 0x58, 0x54, 0x0A,
      0x20, 0x20, 0x31, 0x0A,
      0xB0, 0xA1, // 가
      0xB3, 0xAA, // 나
      0xB4, 0xD9, // 다
      0xB6, 0xF3, // 라
      0x0A,
      0x20, 0x20, 0x30, 0x0A,
      0x45, 0x4F, 0x46, 0x0A,
    ]
    expect(detectDxfEncoding(bytesToBuffer(eucKrBytes))).toBe('euc-kr')
  })
})

// ─── Double encoding reversal ──────────────────────────────────────────────

describe('reverseDoubleEncodingIfNeeded: Latin-1 → EUC-KR', () => {
  it('reverses double-encoded "현장명" (ÇöÀå¸í → 현장명)', () => {
    // EUC-KR 현장명 = C7 F6 C0 E5 B8 ED
    // Double-encoded as Latin-1 in UTF-8: Ç ö À å ¸ í
    const mojibake = '\u00C7\u00F6\u00C0\u00E5\u00B8\u00ED'
    const result = reverseDoubleEncodingIfNeeded(mojibake)
    expect(result).toBe('현장명')
  })

  it('reverses "내부 리모델링" from Latin-1 mojibake', () => {
    const mojibake = '\u00B3\u00BB\u00BA\u00CE \u00B8\u00AE\u00B8\u00F0\u00B5\u00A8\u00B8\u00B5'
    const result = reverseDoubleEncodingIfNeeded(mojibake)
    expect(result).toBe('내부 리모델링')
  })

  it('reverses "디자인 설계도면" from Latin-1 mojibake', () => {
    const mojibake = '\u00B5\u00F0\u00C0\u00DA\u00C0\u00CE \u00BC\u00B3\u00B0\u00E8\u00B5\u00B5\u00B8\u00E9'
    const result = reverseDoubleEncodingIfNeeded(mojibake)
    expect(result).toBe('디자인 설계도면')
  })

  it('preserves text that already contains Korean', () => {
    const korean = '이미 한글이 있는 텍스트'
    expect(reverseDoubleEncodingIfNeeded(korean)).toBe(korean)
  })

  it('preserves plain ASCII text', () => {
    const ascii = 'SECTION\nHEADER\nENDSEC\nEOF'
    expect(reverseDoubleEncodingIfNeeded(ascii)).toBe(ascii)
  })

  it('preserves legitimate Latin text without Korean', () => {
    // Few high chars that don't form EUC-KR pairs = no reversal
    const latin = 'CAD file v2.0'
    expect(reverseDoubleEncodingIfNeeded(latin)).toBe(latin)
  })
})
