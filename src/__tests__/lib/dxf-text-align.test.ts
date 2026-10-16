/**
 * TEXT 정렬(gc 72/73/74) 회귀 테스트.
 *
 * 파서가 **가로 정렬만 보고 세로를 통째로 버렸다.** 그래서
 *
 *  - 가운데+중간 정렬된 도면틀 글씨가 글자 높이의 절반만큼 내려앉고
 *  - 위 정렬이면 한 칸 통째로 어긋나고
 *  - 정렬 코드가 아예 없는 평범한 글씨는 attachPt 가 비어서, 렌더러가
 *    MTEXT 기본값인 TL(위에 매달기)로 떨어뜨렸다 — baseline 이 맞다.
 *
 * 실제 도면(26.08.07_리닝)의 표제란 글자가 칸 밖으로 비어져 나왔다.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { textAttachPoint, usesAlignPoint } from '../../lib/dxf-shared'
import { commitCadImportV2, unpackTextsJson } from '../../lib/dxf'
import { createMockEditor } from '../helpers/mockEditor'

// ── 순수 매핑 ──
//
// attachment point: 1=TL 2=TC 3=TR 4=ML 5=MC 6=MR 7=BL 8=BC 9=BR
// gc 72 (가로): 0=Left 1=Center 2=Right 3=Aligned 4=Middle 5=Fit
// gc 73 (세로): 0=Baseline 1=Bottom 2=Middle 3=Top

describe('textAttachPoint', () => {
  it('정렬이 없으면 baseline-left 다 (TL 이 아니다)', () => {
    // 이게 1 로 돌아오면 모든 평범한 글씨가 한 줄 높이만큼 내려앉는다.
    expect(textAttachPoint(0, 0)).toBe(7)
  })

  it('가로만 걸린 경우 (예전에도 맞던 것)', () => {
    expect(textAttachPoint(1, 0)).toBe(8)   // Center  → BC
    expect(textAttachPoint(2, 0)).toBe(9)   // Right   → BR
  })

  it('세로를 반영한다 — 여기가 통째로 빠져 있었다', () => {
    expect(textAttachPoint(0, 3)).toBe(1)   // Left   + Top    → TL
    expect(textAttachPoint(1, 3)).toBe(2)   // Center + Top    → TC
    expect(textAttachPoint(2, 3)).toBe(3)   // Right  + Top    → TR
    expect(textAttachPoint(0, 2)).toBe(4)   // Left   + Middle → ML
    expect(textAttachPoint(1, 2)).toBe(5)   // Center + Middle → MC
    expect(textAttachPoint(2, 2)).toBe(6)   // Right  + Middle → MR
    expect(textAttachPoint(0, 1)).toBe(7)   // Left   + Bottom → BL
  })

  it('Middle(72=4) 은 세로 코드와 무관하게 MC 다', () => {
    expect(textAttachPoint(4, 0)).toBe(5)
    expect(textAttachPoint(4, 3)).toBe(5)
  })

  it('Aligned/Fit 은 왼쪽 기준으로 둔다', () => {
    expect(textAttachPoint(3, 0)).toBe(7)
    expect(textAttachPoint(5, 0)).toBe(7)
  })
})

describe('usesAlignPoint', () => {
  it('둘 다 0 이면 10/20 을 쓴다', () => {
    expect(usesAlignPoint(0, 0)).toBe(false)
  })

  it('하나라도 걸려 있으면 11/21 이 기준점이다', () => {
    expect(usesAlignPoint(1, 0)).toBe(true)
    expect(usesAlignPoint(0, 2)).toBe(true)   // 세로만 걸린 경우도 — 예전엔 가로만 봤다
  })

  it('Aligned/Fit 의 11/21 은 끝점이라 기준으로 쓰지 않는다', () => {
    // 끝점에 왼쪽 정렬로 찍으면 글자가 통째로 오른쪽으로 밀려난다.
    expect(usesAlignPoint(3, 0)).toBe(false)
    expect(usesAlignPoint(5, 0)).toBe(false)
  })
})

// ── 파서를 통과시켜 확인 ──

const gc = (code: number, value: string | number) => `${code}\n${value}\n`

type AlignedText = {
  text: string
  x: number; y: number
  /** 정렬점 (11/21). 주면 같이 내보낸다. */
  ax?: number; ay?: number
  h72?: number; v73?: number
  /** ATTRIB 로 내보낼지 (세로 정렬이 74 로 들어간다) */
  attrib?: boolean
}

function makeDxf(texts: AlignedText[]): string {
  let s = gc(0, 'SECTION') + gc(2, 'HEADER') + gc(9, '$INSUNITS') + gc(70, 4) + gc(0, 'ENDSEC')
  s += gc(0, 'SECTION') + gc(2, 'ENTITIES')
  // DxfGroup 경로로 들어가도록 선을 충분히 넣는다
  for (let i = 0; i < 120; i++) {
    s += gc(0, 'LINE') + gc(8, 'A') +
      gc(10, 0) + gc(20, i * 10) + gc(30, 0) +
      gc(11, 1000) + gc(21, i * 10) + gc(31, 0)
  }
  for (const t of texts) {
    s += gc(0, t.attrib ? 'ATTRIB' : 'TEXT') + gc(8, 'A') +
      gc(10, t.x) + gc(20, t.y) + gc(30, 0) + gc(40, 50) + gc(1, t.text)
    if (t.ax !== undefined) s += gc(11, t.ax) + gc(21, t.ay ?? 0) + gc(31, 0)
    if (t.h72 !== undefined) s += gc(72, t.h72)
    if (t.v73 !== undefined) s += gc(t.attrib ? 74 : 73, t.v73)
  }
  return s + gc(0, 'ENDSEC') + gc(0, 'EOF')
}

class InlineWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  constructor(_url: URL, _opts?: unknown) { /* noop */ }
  postMessage(data: unknown) {
    void (async () => {
      await import('../../lib/dxf-fast-worker')
      const origPost = self.postMessage
      self.postMessage = (msg: unknown) => {
        this.onmessage?.(new MessageEvent('message', { data: msg }))
      }
      try {
        ;(self.onmessage as (e: MessageEvent) => void)(new MessageEvent('message', { data }))
      } finally {
        self.postMessage = origPost
      }
    })()
  }
  terminate() { /* noop */ }
}

type Shape = { type: string; props: { textsJson: string }; meta: { dxfLayer?: string } }

type PackedText = { t: string; x: number; y: number; ap?: number }

async function importTexts(texts: AlignedText[]): Promise<PackedText[]> {
  const created: Shape[] = []
  await commitCadImportV2(
    createMockEditor({ created, instanceMeta: {}, viewport: { width: 1920, height: 1080 } }) as never,
    makeDxf(texts), new Set(['A']), 'test.dxf', 1234, false, undefined, null,
  )
  const out: PackedText[] = []
  for (const sh of created) {
    if (!sh.props?.textsJson) continue
    out.push(...(unpackTextsJson(sh.props.textsJson) as PackedText[]))
  }
  return out
}

const find = (list: PackedText[], t: string) => list.find(p => p.t === t)

beforeAll(() => {
  ;(globalThis as unknown as { Worker: unknown }).Worker = InlineWorker
})

afterEach(() => vi.restoreAllMocks())

describe('파서를 통과한 TEXT 정렬', () => {
  it('정렬 코드가 없으면 baseline-left 로 나간다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const got = await importTexts([{ text: '평면도', x: 500, y: 600 }])
    expect(find(got, '평면도')?.ap).toBe(7)
  })

  it('가운데+중간 정렬이 MC 로 나간다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const got = await importTexts([
      { text: 'ALT 1', x: 0, y: 0, ax: 500, ay: 600, h72: 1, v73: 2 },
    ])
    expect(find(got, 'ALT 1')?.ap).toBe(5)
  })

  it('세로만 걸려 있어도 정렬점(11/21)을 쓴다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    // 좌표는 임포트 중에 스케일·이동을 거치므로 절대값 대신 **같은 자리에
    // 찍히는지**로 본다. 10/20 을 그대로 썼다면 둘이 갈라진다.
    const got = await importTexts([
      { text: '기준', x: 500, y: 600 },
      { text: '세로정렬', x: 0, y: 0, ax: 500, ay: 600, v73: 3 },
    ])
    const base = find(got, '기준')!
    const aligned = find(got, '세로정렬')!
    expect(aligned.x).toBeCloseTo(base.x, 3)
    expect(aligned.y).toBeCloseTo(base.y, 3)
    expect(aligned.ap).toBe(1)   // Left + Top → TL
  })

  it('ATTRIB 의 세로 정렬은 74 에서 읽는다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    // 73 을 읽으면 ATTRIB 에선 필드 길이가 들어와 엉뚱한 칸으로 간다.
    const got = await importTexts([
      { text: '속성값', x: 0, y: 0, ax: 500, ay: 600, h72: 1, v73: 2, attrib: true },
    ])
    expect(find(got, '속성값')?.ap).toBe(5)   // Center + Middle → MC
  })

  it('Fit(72=5) 은 끝점으로 끌려가지 않는다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const got = await importTexts([
      { text: '기준', x: 500, y: 600 },
      { text: '맞춤', x: 500, y: 600, ax: 9000, ay: 600, h72: 5 },
    ])
    const base = find(got, '기준')!
    const fit = find(got, '맞춤')!
    expect(fit.x).toBeCloseTo(base.x, 3)
    expect(fit.ap).toBe(7)
  })
})
