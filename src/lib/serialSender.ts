// "보내는 중에는 하나만" 을 지키는 직렬 전송기.
//
// 발주서는 통째로 올리는 RPC 다 — 서버에서 전부 지우고 다시 넣는다. 두 요청이
// 겹치면 **늦게 끝난 옛 요청이 새 내용을 덮는다.** 플래그를 요청 전에 내리는
// 식(보내기 시작하면 '대기 없음')으로는 못 막는다. 보내는 동안 들어온 값을
// 들고 있다가, 끝난 뒤에 이어서 보내야 한다.
//
// 쌓지 않고 **마지막 값만** 보낸다. 중간 상태를 서버에 남길 이유가 없고,
// 빨리 타이핑할수록 요청이 줄어든다.

export type SerialSender<T> = {
  /** 보낼 값을 올린다. 보내는 중이면 끝난 뒤에 이어서 보낸다. */
  push(value: T): void
  /** 보내는 중이거나 대기 중인 값이 있는지 */
  isBusy(): boolean
  /** 지금 걸린 일이 모두 끝날 때까지 (테스트용) */
  idle(): Promise<void>
}

export function createSerialSender<T>(
  send: (value: T) => Promise<void>,
  onError?: (err: unknown) => void,
): SerialSender<T> {
  let running = false
  let pending: { value: T } | null = null
  /** 지금 돌고 있는 pump. idle() 이 기다릴 대상. */
  let loop: Promise<void> = Promise.resolve()

  const pump = async () => {
    if (running) return
    running = true
    try {
      while (pending) {
        const { value } = pending
        pending = null
        try {
          await send(value)
        } catch (err) {
          onError?.(err)
        }
      }
    } finally {
      running = false
    }
  }

  return {
    push(value: T) {
      pending = { value }
      if (!running) loop = pump()
    },
    isBusy: () => running || pending !== null,
    idle: () => loop,
  }
}
