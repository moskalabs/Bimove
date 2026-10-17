/**
 * 직렬 전송기 테스트.
 *
 * 발주서는 통째로 올리는 RPC 다 — 서버에서 전부 지우고 다시 넣는다. 두 요청이
 * 겹치면 **늦게 끝난 옛 요청이 새 내용을 덮는다.** 예전 코드는 디바운스
 * 타이머가 터질 때 '대기 없음' 으로 바꾸고 나서 await 했기 때문에, 느린 요청
 * 중에 들어온 수정이 두 번째 요청을 동시에 띄웠다.
 */
import { describe, it, expect, vi } from 'vitest'
import { createSerialSender } from '../../lib/serialSender'

/** 수동으로 끝낼 수 있는 전송 */
function controllable() {
  const calls: unknown[] = []
  const finishers: Array<() => void> = []
  let live = 0
  let maxLive = 0
  const send = (v: unknown) => {
    calls.push(v)
    live++
    maxLive = Math.max(maxLive, live)
    return new Promise<void>(res => {
      finishers.push(() => { live--; res() })
    })
  }
  return {
    send, calls,
    finishNext: () => finishers.shift()?.(),
    finishAll: () => { while (finishers.length) finishers.shift()!() },
    get maxLive() { return maxLive },
  }
}

describe('createSerialSender', () => {
  it('보내는 중에는 두 번째를 띄우지 않는다', async () => {
    const c = controllable()
    const s = createSerialSender(c.send)

    s.push('A')
    s.push('B')
    s.push('C')

    expect(c.maxLive).toBe(1)        // ← 겹치면 안 된다
    expect(c.calls).toEqual(['A'])   // B·C 는 아직 안 나갔다

    c.finishNext()
    await Promise.resolve(); await Promise.resolve()
    c.finishAll()
    await s.idle()
    expect(c.maxLive).toBe(1)
  })

  it('보내는 동안 쌓인 건 마지막 값만 보낸다', async () => {
    // 중간 상태를 서버에 남길 이유가 없고, 빨리 칠수록 요청이 줄어든다.
    const c = controllable()
    const s = createSerialSender(c.send)

    s.push('A')          // 바로 나간다
    s.push('B')          // 대기 (곧 C 로 덮인다)
    s.push('C')

    c.finishNext()                 // A 끝 → 루프가 C 를 보낸다
    await vi.waitFor(() => expect(c.calls).toEqual(['A', 'C']))
    c.finishAll()                  // C 끝
    await s.idle()

    expect(c.calls).toEqual(['A', 'C'])   // B 는 건너뛴다
  })

  it('실패해도 멈추지 않고 다음 값을 보낸다', async () => {
    const seen: string[] = []
    const onError = vi.fn()
    const s = createSerialSender<string>(async v => {
      seen.push(v)
      if (v === 'A') throw new Error('network')
    }, onError)

    s.push('A')
    await s.idle()
    s.push('B')
    await s.idle()

    expect(seen).toEqual(['A', 'B'])
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('보낼 게 남았는지 알려준다 (닫을 때 흘려보낼지 판단용)', async () => {
    const c = controllable()
    const s = createSerialSender(c.send)
    expect(s.isBusy()).toBe(false)
    s.push('A')
    expect(s.isBusy()).toBe(true)
    c.finishAll()
    await s.idle()
    expect(s.isBusy()).toBe(false)
  })
})
