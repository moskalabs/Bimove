/**
 * 서버 동기화가 겹치지 않는지 보는 회귀 테스트.
 *
 * setInterval 은 콜백이 async 여도 기다려주지 않는다. 큰 도면은 압축 + 업로드에
 * 주기(30초)를 넘길 수 있고, 그 사이에 편집이 있으면 다음 틱이 **같은
 * lastServerUpdatedAt 으로** 또 출발한다. 두 요청이 서로를 충돌로 보고 쓸데없는
 * 백업을 뜨거나, 늦게 끝난 쪽이 먼저 끝난 쪽을 덮는다.
 *
 * App.tsx 의 타이머 본문을 그대로 테스트할 수는 없으니, **같은 모양의 루프**를
 * 여기서 돌려 가드가 있는 경우와 없는 경우를 가른다. 가드를 빼면 깨진다.
 */
import { describe, it, expect } from 'vitest'

/** App.tsx 타이머가 하는 일을 줄인 것 */
function makeLoop(opts: { guard: boolean }) {
  let dirty = false
  let inFlight = false
  let concurrent = 0
  let maxConcurrent = 0
  const starts: number[] = []

  const markDirty = () => { dirty = true }

  const tick = async (save: () => Promise<void>) => {
    if (opts.guard && inFlight) return
    if (!dirty) return
    dirty = false
    inFlight = true
    concurrent++
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    starts.push(starts.length)
    try {
      await save()
    } finally {
      concurrent--
      inFlight = false
    }
  }

  return { markDirty, tick, get maxConcurrent() { return maxConcurrent }, get runs() { return starts.length } }
}

/** 수동으로 끝낼 수 있는 저장 */
function pendingSave() {
  let done!: () => void
  const promise = new Promise<void>(res => { done = res })
  return { run: () => promise, finish: () => done() }
}

describe('동기화 루프의 겹침 방지', () => {
  it('가드가 있으면 진행 중에 들어온 틱을 건너뛴다', async () => {
    const loop = makeLoop({ guard: true })
    const save = pendingSave()

    loop.markDirty()
    const first = loop.tick(save.run)          // 1회차 시작 — 아직 안 끝남
    loop.markDirty()                           // 그 사이에 편집
    await loop.tick(save.run)                  // 2회차 — 건너뛰어야 한다

    expect(loop.maxConcurrent).toBe(1)
    expect(loop.runs).toBe(1)

    save.finish()
    await first
  })

  it('건너뛴 변경은 다음 회차에서 처리된다', async () => {
    // 건너뛰기만 하고 영영 안 올라가면 그게 더 나쁘다.
    const loop = makeLoop({ guard: true })
    const a = pendingSave()

    loop.markDirty()
    const first = loop.tick(a.run)
    loop.markDirty()                           // 진행 중 편집 → dirty 재설정
    await loop.tick(a.run)                     // 건너뜀
    a.finish()
    await first

    const b = pendingSave()
    const second = loop.tick(b.run)            // 다음 회차는 돈다
    b.finish()
    await second
    expect(loop.runs).toBe(2)
  })

  it('가드가 없으면 두 요청이 겹친다 (고치기 전 모습)', async () => {
    const loop = makeLoop({ guard: false })
    const save = pendingSave()

    loop.markDirty()
    const first = loop.tick(save.run)
    loop.markDirty()
    const second = loop.tick(save.run)

    expect(loop.maxConcurrent).toBe(2)         // ← 이게 문제였다

    save.finish()
    await Promise.all([first, second])
  })
})
