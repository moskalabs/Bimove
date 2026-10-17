/**
 * DWG 변환 워커의 생명주기.
 *
 * 이 작업의 목적이 **메모리 회수**다. 변환기가 잡는 wasm 메모리(DWG 1MB 당
 * 25.8MB)는 줄어들지 않고 래퍼가 인스턴스를 영구 캐시해서, 워커를 죽이는 것만이
 * 돌려받는 길이다. 그러니 "terminate 가 모든 경로에서 정확히 한 번 불린다" 가
 * 기능 그 자체다 — 결과만 맞고 워커가 남으면 고친 게 하나도 없다.
 *
 * transfer 도 같이 본다. 사본으로 넘기면 수백 MB 를 한 벌 더 쓴다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { dwgToDxfBytes } from '../../lib/dxf'

type Posted = { data: unknown; opts?: { transfer?: unknown[] } }

/** 메시지를 자동으로 돌려주지 않는 가짜 워커 — 테스트가 직접 흘린다. */
class FakeWorker {
  static live: FakeWorker[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  posted: Posted[] = []
  terminated = 0

  url: URL
  opts?: unknown

  constructor(url: URL, opts?: unknown) {
    this.url = url
    this.opts = opts
    FakeWorker.live.push(this)
  }
  postMessage(data: unknown, opts?: { transfer?: unknown[] }) {
    this.posted.push({ data, opts })
  }
  terminate() { this.terminated++ }

  /** 워커 모듈이 평가됐다는 신호 */
  boot() { this.onmessage?.(new MessageEvent('message', { data: { type: 'boot' } })) }
  result(bytes: Uint8Array) {
    this.onmessage?.(new MessageEvent('message', { data: { type: 'result', bytes } }))
  }
  fail(message: string) {
    this.onmessage?.(new MessageEvent('message', { data: { type: 'error', message } }))
  }
  crash(message = 'boom') {
    this.onerror?.(new ErrorEvent('error', { message }))
  }
}

const only = () => {
  expect(FakeWorker.live).toHaveLength(1)
  return FakeWorker.live[0]
}

beforeEach(() => {
  FakeWorker.live = []
  ;(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker
})

afterEach(() => { vi.restoreAllMocks() })

describe('dwgToDxfBytes: 보내는 쪽', () => {
  it('DWG 버퍼를 transfer 로 넘긴다 (사본을 만들지 않는다)', () => {
    const buffer = new ArrayBuffer(1024)
    void dwgToDxfBytes(buffer)
    const { data, opts } = only().posted[0]
    expect(opts?.transfer).toEqual([buffer])
    expect((data as { type: string }).type).toBe('convert')
  })

  it('wasmBase 를 같이 넘긴다 — 워커에는 document 가 없다', () => {
    // 워커 안에서 new URL('dwgdxf', document.baseURI) 를 할 수 없다.
    // 이걸 안 넘기면 CDN 폴백으로 빠져서 OLE 패치가 안 된 wasm 을 쓴다.
    void dwgToDxfBytes(new ArrayBuffer(8))
    const data = only().posted[0].data as { wasmBase?: string }
    expect(data.wasmBase).toBeTruthy()
    expect(data.wasmBase).toContain('dwgdxf')
  })

  it('module 타입 워커로 띄운다', () => {
    void dwgToDxfBytes(new ArrayBuffer(8))
    expect((only().opts as { type?: string })?.type).toBe('module')
  })
})

describe('dwgToDxfBytes: terminate', () => {
  it('성공하면 결과를 주고 워커를 죽인다', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const p = dwgToDxfBytes(new ArrayBuffer(8))
    const w = only()
    w.boot()
    w.result(bytes)
    await expect(p).resolves.toBe(bytes)
    expect(w.terminated).toBe(1)
  })

  it('워커가 에러를 보고해도 죽인다', async () => {
    const p = dwgToDxfBytes(new ArrayBuffer(8))
    const w = only()
    w.boot()
    w.fail('잘못된 DWG')
    await expect(p).rejects.toThrow('잘못된 DWG')
    expect(w.terminated).toBe(1)
  })

  it('워커가 터져도 죽인다', async () => {
    const p = dwgToDxfBytes(new ArrayBuffer(8))
    const w = only()
    w.boot()
    w.crash('out of memory')
    await expect(p).rejects.toThrow(/out of memory/)
    expect(w.terminated).toBe(1)
  })

  it('타임아웃에도 죽인다 — 안 그러면 회수가 목적인데 영원히 남는다', async () => {
    vi.useFakeTimers()
    try {
      const p = dwgToDxfBytes(new ArrayBuffer(8))
      const w = only()
      w.boot()
      const assertion = expect(p).rejects.toThrow(/타임아웃/)
      await vi.advanceTimersByTimeAsync(600_001)
      await assertion
      expect(w.terminated).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('결과가 두 번 와도 한 번만 죽이고 한 번만 settle 한다', async () => {
    const p = dwgToDxfBytes(new ArrayBuffer(8))
    const w = only()
    w.boot()
    w.result(new Uint8Array([7]))
    w.result(new Uint8Array([9]))
    w.fail('늦은 에러')
    await expect(p).resolves.toEqual(new Uint8Array([7]))
    expect(w.terminated).toBe(1)
  })

  it('타임아웃 타이머를 치운다 — 끝난 뒤에 거부가 날아오지 않는다', async () => {
    vi.useFakeTimers()
    try {
      const p = dwgToDxfBytes(new ArrayBuffer(8))
      const w = only()
      w.boot()
      w.result(new Uint8Array([1]))
      await expect(p).resolves.toEqual(new Uint8Array([1]))
      // 타이머가 살아 있으면 여기서 처리되지 않은 거부가 생긴다
      await vi.advanceTimersByTimeAsync(700_000)
      expect(w.terminated).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('dwgToDxfBytes: 배포가 갈린 탭', () => {
  it('boot 전에 터지면 청크 로딩 실패로 보고 새로고침을 묻는다', async () => {
    // 배포가 갱신되면 예전 탭이 사라진 워커 청크를 요청한다. Vercel 이 없는
    // 경로에 index.html 을 주므로 브라우저가 MIME 로 거부한다.
    // 판별은 err.message 가 아니라 **boot ack 수신 여부**다 — 메시지가 비는
    // 에러는 로딩 실패만이 아니고, 그걸 오인해 말없이 새로고침하면 임포트
    // 도중에 저장 안 된 편집이 날아간다.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const p = dwgToDxfBytes(new ArrayBuffer(8))
    const w = only()
    w.crash('')                       // boot 없이 바로
    await expect(p).rejects.toThrow(/불러오지 못했습니다/)
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('새로고침'))
    expect(w.terminated).toBeGreaterThanOrEqual(1)
  })

  it('boot 후에 터지면 새로고침을 묻지 않는다 — 그냥 런타임 에러다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const p = dwgToDxfBytes(new ArrayBuffer(8))
    const w = only()
    w.boot()
    w.crash('변환 중 폭발')
    await expect(p).rejects.toThrow(/변환 중 폭발/)
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
