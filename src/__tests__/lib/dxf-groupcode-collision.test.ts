/**
 * Group code vs. 값(value) 줄 충돌 회귀 테스트
 *
 * 파서는 `\n<code>\n` 문자열을 찾아 필드를 뽑는다. 패딩 없는 DXF 에서는
 * **값 줄**도 같은 모양이라 오탐한다. 예를 들어 `62\n7\n` (ACI 7 = 기본 색) 은
 * `\n7\n` 과 맞아떨어져서, 텍스트 스타일(gc 7) 대신 그 다음 group code 를 읽는다.
 *
 * DXF 필드 순서상 충돌을 일으키는 코드가 항상 먼저 온다:
 *   엔티티  8 → 6 → 62 → 370 → … → 7     (62 가 7 보다 먼저)
 *   LAYER   2 → 70 → 62 → 6               (62 가 6 보다 먼저)
 *   LTYPE   2 → 70 → 3 → 72 → 73 → 40     (73 이 40 보다 먼저)
 *   STYLE   2 → 70 → 40 → 41 → 50 → 71 → 42 → 3 → 4
 *
 * 그래서 아래 케이스들은 전부 "흔한 도면" 이다 — 색이 7(기본)/6(마젠타) 이거나
 * 요소 2개짜리 파선이면 바로 걸린다. 코드 줄 자리에서만 비교해야 막힌다.
 */
import { describe, it, expect } from 'vitest'

// Worker 모듈을 static import — jsdom 에서 self === window 이므로 onmessage 설정됨
import '../../lib/dxf-fast-worker'

// ─── 패딩 없는(unpadded) 합성 DXF ──────────────────────────────────────

/** unpadded group code: AutoCAD 외 CAD(ZWCAD, 일부 변환기) 가 쓰는 형식 */
const u = (c: number) => String(c)

/** (code, value) 쌍들을 DXF 줄로 */
function gcLines(...pairs: [number, string | number][]): string {
  return pairs.map(([c, v]) => `${u(c)}\n${v}\n`).join('')
}

const HEADER = gcLines(
  [0, 'SECTION'], [2, 'HEADER'],
  [9, '$ACADVER'], [1, 'AC1009'],
  [9, '$INSUNITS'], [70, 4],
  [9, '$LTSCALE'], [40, '1.0'],
  [0, 'ENDSEC'],
)

// LTYPE: 요소 2개 → `73\n2\n40\n` 이 생겨서 gc2(이름) 가 "40" 으로 오탐된다
const LTYPE_TABLE = gcLines(
  [0, 'TABLE'], [2, 'LTYPE'], [70, 2],
  [0, 'LTYPE'], [2, 'DASHED'], [70, 0], [3, '__ __ __'],
  [72, 65], [73, 2], [40, '15.0'], [49, '12.0'], [74, 0], [49, '-3.0'], [74, 0],
  [0, 'LTYPE'], [2, 'HIDDEN'], [70, 0], [3, '. . . .'],
  [72, 65], [73, 2], [40, '6.0'], [49, '4.0'], [74, 0], [49, '-2.0'], [74, 0],
  [0, 'ENDTAB'],
)

// LAYER: 62=6(마젠타) → `\n62\n6\n` 이 gc6(linetype) 보다 먼저 걸린다
const LAYER_TABLE = gcLines(
  [0, 'TABLE'], [2, 'LAYER'], [70, 1],
  [0, 'LAYER'], [2, 'W1'], [70, 0], [62, 6], [6, 'DASHED'],
  [0, 'ENDTAB'],
)

// STYLE:
//  KOR  — 정상 gc3
//  VERT — 70=4(vertical) → `\n70\n4\n40\n` 이 gc4(bigfont) 보다 먼저 걸려
//         bigfont 가 "40" 으로 읽히고, 알 수 없는 폰트는 그대로 통과하므로
//         CSS font-family 에 "40" 이 박힌다
const STYLE_TABLE = gcLines(
  [0, 'TABLE'], [2, 'STYLE'], [70, 2],
  [0, 'STYLE'], [2, 'KOR'], [70, 0],
  [40, '0.0'], [41, '1.0'], [50, '0.0'], [71, 0], [42, '2.5'], [3, 'gulim.ttc'],
  [0, 'STYLE'], [2, 'VERT'], [70, 4],
  [40, '0.0'], [41, '1.0'], [50, '0.0'], [71, 0], [42, '2.5'], [4, 'whgtxt.shx'],
  [0, 'ENDTAB'],
)

const TABLES =
  gcLines([0, 'SECTION'], [2, 'TABLES']) +
  LTYPE_TABLE + LAYER_TABLE + STYLE_TABLE +
  gcLines([0, 'ENDSEC'])

/** 62=6 → 엔티티 gc6 오탐. linetype 은 레이어에서 상속해야 한다 */
const LINE_MAGENTA = gcLines(
  [0, 'LINE'], [8, 'W1'], [62, 6],
  [10, 0], [20, 0], [30, 0], [11, 100], [21, 0], [31, 0],
)

/** 엔티티 레벨 gc6 명시 — 정상 경로가 깨지지 않았는지 */
const LINE_EXPLICIT_LT = gcLines(
  [0, 'LINE'], [8, 'W1'], [6, 'HIDDEN'], [62, 1],
  [10, 0], [20, 50], [30, 0], [11, 100], [21, 50], [31, 0],
)

/** 62=7 → gc7(style) 오탐. 기본 색이라 실제 도면 대부분이 여기 해당 */
const TEXT_DEFAULT_COLOR = gcLines(
  [0, 'TEXT'], [8, 'W1'], [62, 7],
  [10, '10.0'], [20, '20.0'], [30, 0], [40, '2.5'], [1, '한글도면'], [7, 'KOR'],
)

/** 70=4 STYLE 을 쓰는 텍스트 */
const TEXT_VERT_STYLE = gcLines(
  [0, 'TEXT'], [8, 'W1'], [62, 3],
  [10, '10.0'], [20, '30.0'], [30, 0], [40, '2.5'], [1, '세로쓰기'], [7, 'VERT'],
)

const DXF =
  HEADER + TABLES +
  gcLines([0, 'SECTION'], [2, 'ENTITIES']) +
  LINE_MAGENTA + LINE_EXPLICIT_LT + TEXT_DEFAULT_COLOR + TEXT_VERT_STYLE +
  gcLines([0, 'ENDSEC'], [0, 'EOF'])

// ─── Worker 호출 헬퍼 ───────────────────────────────────────────────────

type PolylineData = {
  vertices: number[][]; layer: string; colorNumber: number
  linetypeName?: string; lineweight?: number
}
type TextData = {
  x: number; y: number; text: string; height: number; layer: string
  colorNumber: number; fontName?: string
}
type LinetypeDef = { name: string; pattern: number[]; totalLen: number }

interface WorkerResult {
  polylines: PolylineData[]
  texts: TextData[]
  linetypes: LinetypeDef[]
  ltscale: number
}

function callWorkerSync(dxfText: string, selectedLayers: string[]): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker mock timeout (15s)')), 15000)
    const origPost = self.postMessage
    self.postMessage = (msg: Record<string, unknown>) => {
      if (msg.type === 'result') {
        clearTimeout(timeout)
        self.postMessage = origPost
        resolve({
          polylines: (msg.polylines || []) as PolylineData[],
          texts: (msg.texts || []) as TextData[],
          linetypes: (msg.linetypes || []) as LinetypeDef[],
          ltscale: msg.ltscale as number,
        })
      } else if (msg.type === 'error') {
        clearTimeout(timeout)
        self.postMessage = origPost
        reject(new Error(msg.message as string))
      }
      // 'progress' 는 무시
    }

    if (typeof self.onmessage === 'function') {
      self.onmessage(new MessageEvent('message', {
        data: { type: 'parse', dxfText, selectedLayers },
      }))
    } else {
      clearTimeout(timeout)
      self.postMessage = origPost
      reject(new Error('self.onmessage not set — worker import failed'))
    }
  })
}

// ─── 테스트 ────────────────────────────────────────────────────────────

describe('패딩 없는 DXF: group code / 값 줄 충돌', () => {
  it('LTYPE 이름이 gc73 의 값("40")으로 오탐되지 않는다', async () => {
    const r = await callWorkerSync(DXF, ['W1'])
    const names = r.linetypes.map(lt => lt.name).sort()

    expect(names).toEqual(['DASHED', 'HIDDEN'])
    expect(names).not.toContain('40')

    const dashed = r.linetypes.find(lt => lt.name === 'DASHED')!
    expect(dashed.totalLen).toBeCloseTo(15.0)
    expect(dashed.pattern).toEqual([12.0, -3.0])

    const hidden = r.linetypes.find(lt => lt.name === 'HIDDEN')!
    expect(hidden.totalLen).toBeCloseTo(6.0)
    expect(hidden.pattern).toEqual([4.0, -2.0])
  })

  it('마젠타 레이어(62=6)의 linetype 이 상속된다', async () => {
    const r = await callWorkerSync(DXF, ['W1'])
    const magenta = r.polylines.find(p => p.colorNumber === 6)

    expect(magenta).toBeDefined()
    // gc6 이 없는 엔티티 → 레이어 linetype(DASHED) 상속.
    // 오탐 시엔 `\n62\n6\n` 다음 줄인 "10" 이 들어온다.
    expect(magenta!.linetypeName).toBe('DASHED')
  })

  it('엔티티 레벨 gc6 은 그대로 읽힌다', async () => {
    const r = await callWorkerSync(DXF, ['W1'])
    const explicit = r.polylines.find(p => p.colorNumber === 1)

    expect(explicit).toBeDefined()
    expect(explicit!.linetypeName).toBe('HIDDEN')
  })

  it('기본 색(62=7) 텍스트의 폰트가 STYLE 에서 해석된다', async () => {
    const r = await callWorkerSync(DXF, ['W1'])
    const t = r.texts.find(x => x.text === '한글도면')

    expect(t).toBeDefined()
    expect(t!.colorNumber).toBe(7)
    // 오탐 시엔 styleName 이 "10" 이 되어 매칭 실패 → fontName undefined
    expect(t!.fontName).toBe('Gulim')
  })

  it('vertical STYLE(70=4)의 bigfont 가 "40" 으로 오탐되지 않는다', async () => {
    const r = await callWorkerSync(DXF, ['W1'])
    const t = r.texts.find(x => x.text === '세로쓰기')

    expect(t).toBeDefined()
    // 오탐 시 gc4 값이 "40" → 알 수 없는 폰트로 통과해서 font-family: "40"
    expect(t!.fontName).not.toBe('40')
    expect(t!.fontName).toBe('Noto Sans KR')
  })
})
