/**
 * Worker 가 실패했을 때 commitCadImportV2 가 **던지는지**.
 *
 * 여기서 잡으려는 버그: 워커 청크가 404(배포 교체) 라서 로딩에 실패했는데
 * `return 0` 으로 조용히 넘어갔다. 호출자는 실패와 "선택한 레이어에 도형이
 * 없음"(둘 다 0)을 구분할 수 없어, 빈 페이지를 만들고 성공 토스트까지 띄웠다.
 *
 * 실제 로그:
 *   Failed to load module script: ... non-JavaScript MIME type of "text/html"
 *   [CAD V2] Worker 실패: Error: Worker 에러: undefined
 *   [Import] Layout "Model": 0개 요소        ← 여기가 문제
 *
 * 리로드 자체는 모듈 경계에서 가로챈다 — jsdom 의 location.reload 는
 * 재정의가 안 되고(비설정 프로퍼티), 여기서 확인하려는 건 dxf.ts 가
 * reloadForStaleChunk 의 반환값에 맞게 행동하는지다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commitCadImportV2 } from '../../lib/dxf'
import { reloadForStaleChunk } from '../../lib/lazyWithReload'
import { createMockEditor } from '../helpers/mockEditor'

vi.mock('../../lib/lazyWithReload', () => ({
  reloadForStaleChunk: vi.fn(() => false),
}))

const mockReload = vi.mocked(reloadForStaleChunk)

/** onerror 로 터지는 워커. message 를 비우면 "모듈 로딩 실패" 를 흉내낸다. */
function makeFailingWorker(message: string | undefined) {
  return class {
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: ((e: { message?: string }) => void) | null = null
    postMessage() {
      setTimeout(() => this.onerror?.({ message }), 0)
    }
    terminate() { /* noop */ }
  }
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockReload.mockReset()
  mockReload.mockReturnValue(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('commitCadImportV2 — Worker 실패', () => {
  it('워커 런타임 에러는 0 이 아니라 예외로 올라온다', async () => {
    vi.stubGlobal('Worker', makeFailingWorker('boom'))
    const editor = createMockEditor()
    await expect(
      commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false),
    ).rejects.toThrow(/boom/)
    // message 가 있으면 "청크가 사라졌다" 가 아니므로 리로드하지 않는다.
    expect(mockReload).not.toHaveBeenCalled()
  })

  it('워커를 만들다 바로 터져도 예외로 올라온다', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('ctor 실패') } })
    const editor = createMockEditor()
    await expect(
      commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false),
    ).rejects.toThrow(/ctor 실패/)
  })

  it('모듈 로딩 실패(message 없음)면 리로드를 걸고 settle 하지 않는다', async () => {
    mockReload.mockReturnValue(true)
    vi.stubGlobal('Worker', makeFailingWorker(undefined))
    const editor = createMockEditor()

    // 리로드를 시작했으면 일부러 settle 하지 않는다 — 깨진 채로 진행하면
    // 빈 페이지가 만들어지기 때문이다.
    const settled = await Promise.race([
      commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false)
        .then(() => 'resolved' as const, () => 'rejected' as const),
      new Promise<'pending'>(r => setTimeout(() => r('pending'), 50)),
    ])

    expect(mockReload).toHaveBeenCalledTimes(1)
    expect(settled).toBe('pending')
  })

  it('리로드가 쿨다운에 걸리면(false) 예외를 올린다', async () => {
    mockReload.mockReturnValue(false)
    vi.stubGlobal('Worker', makeFailingWorker(undefined))
    const editor = createMockEditor()

    await expect(
      commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false),
    ).rejects.toThrow(/Worker/)
    expect(mockReload).toHaveBeenCalledTimes(1)
  })
})
