/**
 * Worker 가 실패했을 때 commitCadImportV2 가 **던지는지**, 그리고 "청크 로딩
 * 실패" 와 "워커 안의 런타임 에러" 를 제대로 가르는지.
 *
 * 판별은 워커가 보내는 boot ack 수신 여부로 한다. 예전엔 `!err.message` 였는데,
 * 메시지가 비는 에러는 로딩 실패만이 아니라서(cross-origin 으로 가려진 런타임
 * 에러 등) 멀쩡한 작업 중에 페이지가 새로고침될 수 있었다.
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

/** onerror 로 터지는 워커.
 *
 * `boot: false` = 모듈이 평가조차 안 됐다 → 청크 로딩 실패.
 * `boot: true`  = 모듈은 떴고 그 뒤에 터졌다 → message 가 비어도 런타임 에러. */
function makeFailingWorker(message: string | undefined, boot: boolean) {
  return class {
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: ((e: { message?: string }) => void) | null = null
    postMessage() {
      if (boot) this.onmessage?.({ data: { type: 'boot' } })
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
    vi.stubGlobal('Worker', makeFailingWorker('boom', true))
    const editor = createMockEditor()
    await expect(
      commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false),
    ).rejects.toThrow(/boom/)
    // 모듈이 떴으면 "청크가 사라졌다" 가 아니므로 리로드하지 않는다.
    expect(mockReload).not.toHaveBeenCalled()
  })

  it('모듈이 뜬 뒤 터진 에러는 message 가 비어도 리로드하지 않는다', async () => {
    // 여기가 `!err.message` 휴리스틱의 구멍이었다 — 작업 중에 페이지를
    // 새로고침해서 저장 안 된 편집을 날렸다.
    vi.stubGlobal('Worker', makeFailingWorker(undefined, true))
    const editor = createMockEditor()
    await expect(
      commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false),
    ).rejects.toThrow(/Worker/)
    expect(mockReload).not.toHaveBeenCalled()
  })

  it('워커를 만들다 바로 터져도 예외로 올라온다', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('ctor 실패') } })
    const editor = createMockEditor()
    await expect(
      commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false),
    ).rejects.toThrow(/ctor 실패/)
  })

  it('모듈 로딩 실패(boot ack 없음)면 리로드를 걸고 settle 하지 않는다', async () => {
    mockReload.mockReturnValue(true)
    vi.stubGlobal('Worker', makeFailingWorker(undefined, false))
    const editor = createMockEditor()

    // 리로드를 시작했으면 일부러 settle 하지 않는다 — 깨진 채로 진행하면
    // 빈 페이지가 만들어지기 때문이다.
    const settled = await Promise.race([
      commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false)
        .then(() => 'resolved' as const, () => 'rejected' as const),
      new Promise<'pending'>(r => setTimeout(() => r('pending'), 50)),
    ])

    expect(mockReload).toHaveBeenCalledTimes(1)
    // 말없이 새로고침하면 안 된다 — 확인창 문구를 넘겼는지 본다.
    expect(mockReload).toHaveBeenCalledWith({ confirm: expect.stringContaining('새로고침') })
    expect(settled).toBe('pending')
  })

  it('리로드가 쿨다운에 걸리거나 사용자가 거절하면(false) 예외를 올린다', async () => {
    mockReload.mockReturnValue(false)
    vi.stubGlobal('Worker', makeFailingWorker(undefined, false))
    const editor = createMockEditor()

    await expect(
      commitCadImportV2(editor as never, 'dummy', new Set(['0']), 'a.dxf', 100, false),
    ).rejects.toThrow(/Worker/)
    expect(mockReload).toHaveBeenCalledTimes(1)
  })
})
