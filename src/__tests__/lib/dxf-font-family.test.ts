/**
 * STYLE → CSS font-family 위생 테스트
 *
 * 알 수 없는 TTF 는 basename 을 그대로 font-family 로 넘긴다 (시스템에 설치돼
 * 있으면 브라우저가 찾아 쓰도록). 문제는 "그대로" 가 너무 그대로였던 것 —
 * group code 오탐이나 깨진 인코딩으로 들어온 값도 통과해서 렌더러의
 * `'${t.f}', 'Noto Sans KR', ...` 리스트에 박혔다. 따옴표가 하나 섞이면
 * 리스트 전체가 무효가 되어 한글 폴백까지 날아간다.
 */
import { describe, it, expect } from 'vitest'
import '../../lib/dxf-fast-worker'

const u = (c: number) => String(c)
function gcLines(...pairs: [number, string | number][]): string {
  return pairs.map(([c, v]) => `${u(c)}\n${v}\n`).join('')
}

/** STYLE 하나 + 그 스타일을 쓰는 TEXT 하나로 된 최소 DXF */
function dxfWithFont(fontFile: string, label: string): string {
  return (
    gcLines([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC']) +
    gcLines([0, 'SECTION'], [2, 'TABLES']) +
    gcLines(
      [0, 'TABLE'], [2, 'STYLE'], [70, 1],
      [0, 'STYLE'], [2, 'S1'], [70, 0], [40, '0.0'], [41, '1.0'], [3, fontFile],
      [0, 'ENDTAB'],
    ) +
    gcLines([0, 'ENDSEC']) +
    gcLines([0, 'SECTION'], [2, 'ENTITIES']) +
    gcLines(
      [0, 'TEXT'], [8, 'A'],
      [10, '0.0'], [20, '0.0'], [30, 0], [40, '2.5'], [1, label], [7, 'S1'],
    ) +
    gcLines([0, 'ENDSEC'], [0, 'EOF'])
  )
}

type TextData = { text: string; fontName?: string }

function callWorkerSync(dxfText: string): Promise<TextData[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker mock timeout (15s)')), 15000)
    const origPost = self.postMessage
    self.postMessage = (msg: Record<string, unknown>) => {
      if (msg.type === 'result') {
        clearTimeout(timeout); self.postMessage = origPost
        resolve((msg.texts || []) as TextData[])
      } else if (msg.type === 'error') {
        clearTimeout(timeout); self.postMessage = origPost
        reject(new Error(msg.message as string))
      }
    }
    ;(self.onmessage as (e: MessageEvent) => void)(
      new MessageEvent('message', { data: { type: 'parse', dxfText, selectedLayers: ['A'] } }),
    )
  })
}

async function fontOf(fontFile: string): Promise<string | undefined> {
  const texts = await callWorkerSync(dxfWithFont(fontFile, 'T'))
  expect(texts).toHaveLength(1)
  return texts[0].fontName
}

/** STYLE 없이 MTEXT 하나만 — 인라인 폰트 지정(\f...;) 경로 확인용 */
function dxfMtext(body: string, styleFont?: string): string {
  const styleTable = styleFont
    ? gcLines([0, 'SECTION'], [2, 'TABLES']) +
      gcLines(
        [0, 'TABLE'], [2, 'STYLE'], [70, 1],
        [0, 'STYLE'], [2, 'S1'], [70, 0], [40, '0.0'], [3, styleFont],
        [0, 'ENDTAB'],
      ) + gcLines([0, 'ENDSEC'])
    : ''
  return (
    gcLines([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC']) +
    styleTable +
    gcLines([0, 'SECTION'], [2, 'ENTITIES']) +
    gcLines(
      [0, 'MTEXT'], [8, 'A'],
      [10, '0.0'], [20, '0.0'], [30, 0], [40, '2.5'], [71, 1], [1, body], [7, 'S1'],
    ) +
    gcLines([0, 'ENDSEC'], [0, 'EOF'])
  )
}

describe('MTEXT 인라인 폰트 지정', () => {
  it('cleanMtextFormatting 이 지우기 전에 뽑아낸다', async () => {
    // 예전엔 서식 코드가 제거된 **뒤의** 문자열에서 찾아서 절대 매칭되지 않았다
    const texts = await callWorkerSync(dxfMtext('{\\fgulim|b0|i0|c129|p50;한글도면}'))

    expect(texts).toHaveLength(1)
    expect(texts[0].text).toBe('한글도면')     // 서식 코드는 본문에서 제거
    expect(texts[0].fontName).toBe('Gulim')   // 폰트는 살아남는다
  })

  it('인라인 폰트도 이름 위생 검사를 받는다', async () => {
    const texts = await callWorkerSync(dxfMtext('{\\f40|b0;본문}'))

    expect(texts).toHaveLength(1)
    expect(texts[0].fontName).toBeUndefined()
  })

  it('STYLE 이 풀리면 인라인보다 STYLE 을 쓴다 (구간별 폰트를 전체에 적용하지 않음)', async () => {
    const texts = await callWorkerSync(dxfMtext('{\\fgulim|b0;본문}', 'batang.ttc'))

    expect(texts).toHaveLength(1)
    expect(texts[0].fontName).toBe('Batang')
  })

  it('인라인 지정이 없으면 undefined', async () => {
    const texts = await callWorkerSync(dxfMtext('그냥 본문'))

    expect(texts).toHaveLength(1)
    expect(texts[0].fontName).toBeUndefined()
  })
})

describe('fontFileToFamily: 미지 폰트 통과 조건', () => {
  it('알려진 한글 폰트는 매핑된다', async () => {
    expect(await fontOf('gulim.ttc')).toBe('Gulim')
    expect(await fontOf('malgun.ttf')).toBe('Malgun Gothic')
  })

  it('경로가 붙어 있어도 basename 으로 매핑된다', async () => {
    expect(await fontOf('C:\\Windows\\Fonts\\batang.ttc')).toBe('Batang')
  })

  it('알려지지 않은 TTF 는 이름으로 통과한다', async () => {
    expect(await fontOf('PretendardGOV.ttf')).toBe('PretendardGOV')
  })

  it('숫자만 있는 값은 버린다 (group code 오탐의 흔적)', async () => {
    expect(await fontOf('40')).toBeUndefined()
    expect(await fontOf('0.7')).toBeUndefined()
  })

  it('따옴표가 섞인 값은 버린다 — font-family 리스트를 깬다', async () => {
    expect(await fontOf("ev'il.ttf")).toBeUndefined()
    expect(await fontOf('a", monospace; x: y.ttf')).toBeUndefined()
  })

  it('한 글자짜리 값은 버린다', async () => {
    expect(await fontOf('A')).toBeUndefined()
  })

  it('SHX 는 여전히 기본 폴백에 맡긴다', async () => {
    expect(await fontOf('romans.shx')).toBeUndefined()
    expect(await fontOf('unknown_shape.shx')).toBeUndefined()
  })
})
