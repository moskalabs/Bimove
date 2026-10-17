/**
 * 블록 안 글자의 **크기와 각도**가 INSERT 변환을 따라가는지.
 *
 * 위치는 따라가는데 크기는 안 따라가고 있었다. 그래서 배치 탭의 도면틀 글씨
 * ("11/11_최종") 가 제자리에 선 채로 혼자 거대하게 나왔다 — 축소 삽입된
 * 블록이라 원본 높이가 그대로 쓰인 것이다.
 *
 * 보정이 **블록 펼치기 쪽에만** 있고 extractTextEntity 안에는 없던 게 원인이라,
 * 여기서는 두 경로를 다 지난다. 한쪽만 고치면 또 갈라진다.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'

const gc = (code: number, value: string | number) => `${code}\n${value}\n`

type Text = { t: string; height: number; rotation?: number; x: number; y: number }

/** BLOCK 하나에 TEXT 를 넣고, 주어진 스케일/회전으로 INSERT 한다. */
function dxfWithBlockText(opts: {
  height: number
  sx: number; sy: number; rot?: number
  insertAt?: [number, number]
}): string {
  const { height, sx, sy, rot = 0, insertAt = [0, 0] } = opts
  let s = gc(0, 'SECTION') + gc(2, 'HEADER') + gc(9, '$INSUNITS') + gc(70, 4) + gc(0, 'ENDSEC')

  s += gc(0, 'SECTION') + gc(2, 'BLOCKS')
  s += gc(0, 'BLOCK') + gc(2, 'TITLEBLK') + gc(10, 0) + gc(20, 0) + gc(30, 0)
  s += gc(0, 'TEXT') + gc(8, 'A') + gc(10, 100) + gc(20, 50) + gc(30, 0) +
       gc(40, height) + gc(1, '11/11_최종')
  s += gc(0, 'ENDBLK')
  s += gc(0, 'ENDSEC')

  s += gc(0, 'SECTION') + gc(2, 'ENTITIES')
  s += gc(0, 'INSERT') + gc(8, 'A') + gc(2, 'TITLEBLK') +
       gc(10, insertAt[0]) + gc(20, insertAt[1]) + gc(30, 0) +
       gc(41, sx) + gc(42, sy) + gc(43, 1) + gc(50, rot)
  // 글자만 있으면 덩어리가 안 생길 수 있으니 선을 하나 깔아둔다
  s += gc(0, 'LINE') + gc(8, 'A') + gc(10, 0) + gc(20, 0) + gc(30, 0) +
       gc(11, 500) + gc(21, 300) + gc(31, 0)
  s += gc(0, 'ENDSEC') + gc(0, 'EOF')
  return s
}

async function parse(dxf: string): Promise<Text[]> {
  const mod = await import('../../lib/dxf-fast-worker')
  const out: Text[] = []
  const origPost = self.postMessage
  self.postMessage = ((msg: { type?: string; texts?: Array<{ text: string; height: number; rotation?: number; x: number; y: number }> }) => {
    if (msg?.type === 'result' && msg.texts) {
      for (const t of msg.texts) {
        out.push({ t: t.text, height: t.height, rotation: t.rotation, x: t.x, y: t.y })
      }
    }
  }) as typeof self.postMessage
  try {
    ;(self.onmessage as (e: MessageEvent) => void)(new MessageEvent('message', {
      data: { type: 'parse', dxfText: dxf, selectedLayers: ['A'] },
    }))
  } finally {
    self.postMessage = origPost
  }
  void mod
  return out
}

beforeAll(async () => { await import('../../lib/dxf-fast-worker') })
afterEach(() => vi.restoreAllMocks())

describe('블록 안 글자 크기', () => {
  it('스케일 1 이면 원본 높이 그대로', async () => {
    const texts = await parse(dxfWithBlockText({ height: 10, sx: 1, sy: 1 }))
    const t = texts.find(t => t.t === '11/11_최종')
    expect(t?.height).toBeCloseTo(10, 5)
  })

  it('축소 삽입하면 글자도 작아진다 — 이게 터져서 "11/11_최종" 이 거대했다', async () => {
    const texts = await parse(dxfWithBlockText({ height: 10, sx: 0.25, sy: 0.25 }))
    const t = texts.find(t => t.t === '11/11_최종')
    expect(t?.height).toBeCloseTo(2.5, 5)
  })

  it('확대 삽입하면 글자도 커진다', async () => {
    const texts = await parse(dxfWithBlockText({ height: 2, sx: 4, sy: 4 }))
    const t = texts.find(t => t.t === '11/11_최종')
    expect(t?.height).toBeCloseTo(8, 5)
  })

  it('비균등 스케일은 |sx|,|sy| 평균을 쓴다', async () => {
    const texts = await parse(dxfWithBlockText({ height: 10, sx: 2, sy: 4 }))
    const t = texts.find(t => t.t === '11/11_최종')
    expect(t?.height).toBeCloseTo(30, 5)   // 10 × (2+4)/2
  })

  it('음수 스케일(미러)에도 높이는 양수다', async () => {
    // 절댓값을 안 쓰면 높이가 음수가 되어 글자가 사라지거나 뒤집힌다.
    const texts = await parse(dxfWithBlockText({ height: 10, sx: -1, sy: -1 }))
    const t = texts.find(t => t.t === '11/11_최종')
    expect(t?.height).toBeCloseTo(10, 5)
    expect(t!.height).toBeGreaterThan(0)
  })
})

describe('블록 안 글자 각도', () => {
  it('블록을 돌리면 글자도 돈다', async () => {
    const texts = await parse(dxfWithBlockText({ height: 10, sx: 1, sy: 1, rot: 90 }))
    const t = texts.find(t => t.t === '11/11_최종')
    expect(t?.rotation).toBeCloseTo(90, 5)
  })

  it('안 돌리면 각도를 만들어내지 않는다', async () => {
    const texts = await parse(dxfWithBlockText({ height: 10, sx: 0.5, sy: 0.5 }))
    const t = texts.find(t => t.t === '11/11_최종')
    expect(t?.rotation ?? 0).toBeCloseTo(0, 5)
  })
})

describe('MTEXT 인라인 높이 (한의 "11/11_최종")', () => {
  /** 한의 도면에 있던 그대로: gc40=1500 + `{\H0.4x;...}` → 600 이어야 한다. */
  function dxfWithMtext(content: string, height = 1500): string {
    let s = gc(0, 'SECTION') + gc(2, 'HEADER') + gc(9, '$INSUNITS') + gc(70, 4) + gc(0, 'ENDSEC')
    s += gc(0, 'SECTION') + gc(2, 'ENTITIES')
    s += gc(0, 'MTEXT') + gc(8, 'A') + gc(10, 100) + gc(20, 50) + gc(30, 0) +
         gc(40, height) + gc(71, 1) + gc(72, 1) + gc(1, content)
    s += gc(0, 'LINE') + gc(8, 'A') + gc(10, 0) + gc(20, 0) + gc(30, 0) +
         gc(11, 500) + gc(21, 300) + gc(31, 0)
    return s + gc(0, 'ENDSEC') + gc(0, 'EOF')
  }

  it('배율을 gc 40 에 곱한다 — 이게 버려져서 2.5배로 나왔다', async () => {
    const texts = await parse(dxfWithMtext('{\\H0.4x;11/11_최종}'))
    const t = texts.find(t => t.t === '11/11_최종')
    expect(t).toBeDefined()
    expect(t!.height).toBeCloseTo(600, 5)
  })

  it('지정이 없으면 gc 40 그대로 (옆 칸 "FLOOR PLAN _7F" 는 멀쩡했다)', async () => {
    const texts = await parse(dxfWithMtext('FLOOR PLAN _7F'))
    expect(texts.find(t => t.t === 'FLOOR PLAN _7F')?.height).toBeCloseTo(1500, 5)
  })

  it('절대 꼴은 gc 40 을 대신한다', async () => {
    const texts = await parse(dxfWithMtext('{\\H600;11/11_최종}'))
    expect(texts.find(t => t.t === '11/11_최종')?.height).toBeCloseTo(600, 5)
  })

  it('글자 내용에는 서식 코드가 안 남는다', async () => {
    const texts = await parse(dxfWithMtext('{\\H0.4x;11/11_최종}'))
    expect(texts.map(t => t.t)).toContain('11/11_최종')
    expect(texts.some(t => t.t.includes('\\H'))).toBe(false)
  })
})

describe('치수 문자도 변환을 따라간다', () => {
  /**
   * 축소 삽입된 블록 **안의 DIMENSION**. 치수 문자(MTEXT)는 치수 블록에 있다.
   *
   * 이 길은 중첩 블록의 subTexts 보정을 타고 내려간다 — 같은 보정 로직이
   * 세 군데 복사돼 있던 것을 applyTextMetrics 하나로 합쳤고, 이 테스트가
   * 그 합치기로 치수 문자가 안 깨졌는지 지킨다.
   */
  function dxfWithScaledDimension(scale: number, textHeight = 10): string {
    let s = gc(0, 'SECTION') + gc(2, 'HEADER') + gc(9, '$INSUNITS') + gc(70, 4) + gc(0, 'ENDSEC')
    s += gc(0, 'SECTION') + gc(2, 'BLOCKS')
    // 치수 블록 — 치수선 하나 + 치수 문자
    s += gc(0, 'BLOCK') + gc(2, '*D1') + gc(10, 0) + gc(20, 0) + gc(30, 0)
    s += gc(0, 'LINE') + gc(8, 'A') + gc(10, 0) + gc(20, 0) + gc(30, 0) +
         gc(11, 200) + gc(21, 0) + gc(31, 0)
    s += gc(0, 'MTEXT') + gc(8, 'A') + gc(10, 100) + gc(20, 20) + gc(30, 0) +
         gc(40, textHeight) + gc(71, 1) + gc(1, '3000')
    s += gc(0, 'ENDBLK')
    // 그 DIMENSION 을 품은 바깥 블록
    s += gc(0, 'BLOCK') + gc(2, 'OUTER') + gc(10, 0) + gc(20, 0) + gc(30, 0)
    s += gc(0, 'DIMENSION') + gc(8, 'A') + gc(2, '*D1') + gc(10, 0) + gc(20, 0) + gc(30, 0)
    s += gc(0, 'ENDBLK')
    s += gc(0, 'ENDSEC')

    s += gc(0, 'SECTION') + gc(2, 'ENTITIES')
    s += gc(0, 'INSERT') + gc(8, 'A') + gc(2, 'OUTER') +
         gc(10, 0) + gc(20, 0) + gc(30, 0) +
         gc(41, scale) + gc(42, scale) + gc(43, 1) + gc(50, 0)
    s += gc(0, 'LINE') + gc(8, 'A') + gc(10, 0) + gc(20, 0) + gc(30, 0) +
         gc(11, 500) + gc(21, 300) + gc(31, 0)
    return s + gc(0, 'ENDSEC') + gc(0, 'EOF')
  }

  it('블록을 축소하면 치수 문자도 작아진다', async () => {
    const texts = await parse(dxfWithScaledDimension(0.5, 10))
    const t = texts.find(t => t.t === '3000')
    expect(t, '치수 문자를 못 찾았다 — fixture 가 DIMENSION 경로를 안 탄다').toBeDefined()
    expect(t!.height).toBeCloseTo(5, 5)
  })

  it('스케일 1 이면 그대로', async () => {
    const texts = await parse(dxfWithScaledDimension(1, 10))
    expect(texts.find(t => t.t === '3000')?.height).toBeCloseTo(10, 5)
  })
})

describe('위치와 크기가 같은 변환을 탄다', () => {
  it('축소하면 위치도 크기도 같이 줄어든다', async () => {
    // 이 둘이 갈라진 게 버그였다. 한쪽만 보는 테스트는 그걸 못 잡는다.
    const texts = await parse(dxfWithBlockText({ height: 10, sx: 0.25, sy: 0.25 }))
    const t = texts.find(t => t.t === '11/11_최종')!
    // 블록 안 (100,50) · 기준점 (0,0) · 스케일 0.25 → (25, 12.5)
    expect(t.x).toBeCloseTo(25, 5)
    expect(t.y).toBeCloseTo(12.5, 5)
    expect(t.height).toBeCloseTo(2.5, 5)
  })
})
