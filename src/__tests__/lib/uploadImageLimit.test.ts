/**
 * 이미지 상한이 **읽기 전에** 걸리는지.
 *
 * importLimits.test.ts 는 숫자를 가르는 함수만 본다. 그 함수가 호출부에 실제로
 * 꽂혀 있는지는 별개다 — 상한을 잘 계산하고 아무도 안 부르면 그대로 터진다.
 *
 * 그래서 FileReader 가 **만들어지지 않는 것**을 본다. 거절 메시지만 확인하면
 * "읽고 나서 거절하는" 코드도 통과하는데, 그건 막으려던 것을 하나도 못 막는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Editor } from 'tldraw'
import { uploadImage } from '../../lib/project'
import { MAX_IMAGE_BYTES } from '../../lib/importLimits'

/** uploadImage 가 만든 file input 을 가로챈다. */
function captureInput(): HTMLInputElement {
  const inputs: HTMLInputElement[] = []
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = real(tag)
    if (tag === 'input') inputs.push(el as HTMLInputElement)
    return el
  }) as typeof document.createElement)

  // click() 은 jsdom 에서 파일 다이얼로그를 띄울 수 없으니 막아둔다
  const onError = vi.fn()
  uploadImage({} as Editor, { onError })
  const input = inputs[0]
  ;(input as unknown as { __onError: typeof onError }).__onError = onError
  return input
}

function errorsOf(input: HTMLInputElement) {
  return (input as unknown as { __onError: ReturnType<typeof vi.fn> }).__onError
}

function pick(input: HTMLInputElement, size: number) {
  const file = { name: 'ref.png', size, type: 'image/png' } as File
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  // onchange 는 async 다. 첫 await 앞의 코드(상한 검사 + FileReader 생성)는
  // 호출 시점에 동기로 돌아가므로, 기다리지 않아도 여기서 판정할 수 있다.
  void input.onchange?.(new Event('change'))
}

let readersMade = 0
let RealFileReader: typeof FileReader

beforeEach(() => {
  readersMade = 0
  RealFileReader = globalThis.FileReader
  class CountingReader {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    result: string | null = null
    constructor() { readersMade++ }
    readAsDataURL() { /* 아무것도 안 한다 — 여기까지 왔는지만 센다 */ }
  }
  globalThis.FileReader = CountingReader as unknown as typeof FileReader
})

afterEach(() => {
  globalThis.FileReader = RealFileReader
  vi.restoreAllMocks()
})

describe('uploadImage 크기 상한', () => {
  it('상한을 넘으면 파일을 아예 읽지 않는다', () => {
    const input = captureInput()
    pick(input, MAX_IMAGE_BYTES + 1)
    expect(readersMade).toBe(0)
    expect(errorsOf(input)).toHaveBeenCalledWith(expect.stringContaining('이미지'))
  })

  it('상한 이하면 그대로 읽는다 — 멀쩡한 파일을 막지 않는다', () => {
    const input = captureInput()
    pick(input, MAX_IMAGE_BYTES)
    expect(readersMade).toBe(1)
    expect(errorsOf(input)).not.toHaveBeenCalled()
  })

  it('파일을 안 고르면 아무 일도 없다', () => {
    const input = captureInput()
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    void input.onchange?.(new Event('change'))
    expect(readersMade).toBe(0)
    expect(errorsOf(input)).not.toHaveBeenCalled()
  })
})
