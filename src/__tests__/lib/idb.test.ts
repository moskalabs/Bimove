/**
 * IndexedDB 래퍼.
 *
 * fake-indexeddb 로 진짜 IDB 구현을 돌린다 — 트랜잭션/커밋 타이밍까지 같이
 * 검증하기 위해서다. 메모리 가짜로 대체하면 정작 틀리기 쉬운 부분
 * (oncomplete 를 안 기다려서 커밋 전에 "저장됐다"고 보고하는 것) 을 못 잡는다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { idbGet, idbSet, idbDelete, idbKeys, idbAvailable } from '../../lib/idb'
import { setCurrentUserId } from '../../lib/scopedStorage'

// DB 비우기는 전역 setup.ts 가 한다 (매 테스트마다 deleteDatabase).
beforeEach(() => {
  setCurrentUserId(null)
})

describe('idbAvailable', () => {
  it('IndexedDB 가 있으면 true', () => {
    expect(idbAvailable()).toBe(true)
  })
})

describe('idbGet / idbSet', () => {
  it('넣은 값을 그대로 돌려준다', async () => {
    expect(await idbSet('versions', 'k1', { a: 1 })).toBe(true)
    expect(await idbGet('versions', 'k1')).toEqual({ a: 1 })
  })

  it('없는 키는 undefined', async () => {
    expect(await idbGet('versions', 'nope')).toBeUndefined()
  })

  // localStorage 와 달리 직렬화를 안 거친다. 이게 IDB 로 가는 이유 중 하나라
  // 중첩 객체/배열/Date 가 모양 그대로 돌아오는지 못 박아둔다.
  it('JSON 왕복 없이 중첩 구조를 보존한다', async () => {
    const value = {
      list: [1, 2, { deep: true }],
      when: new Date(1700000000000),
      nested: { map: { x: [null, 0, ''] } },
    }
    await idbSet('versions', 'k2', value)
    const got = await idbGet<typeof value>('versions', 'k2')
    expect(got).toEqual(value)
    expect(got?.when).toBeInstanceOf(Date)
  })

  it('같은 키에 다시 쓰면 덮어쓴다', async () => {
    await idbSet('versions', 'k3', 'first')
    await idbSet('versions', 'k3', 'second')
    expect(await idbGet('versions', 'k3')).toBe('second')
  })

  // structured clone 은 함수를 못 넘긴다 → DataCloneError.
  // 던지는 게 아니라 false 를 돌려줘야 호출부가 폴백할 수 있다.
  it('복제할 수 없는 값은 던지지 않고 false', async () => {
    expect(await idbSet('versions', 'k4', { fn: () => 1 })).toBe(false)
    expect(await idbGet('versions', 'k4')).toBeUndefined()
  })
})

describe('idbDelete', () => {
  it('지운 키는 더 이상 읽히지 않는다', async () => {
    await idbSet('versions', 'k5', 'x')
    expect(await idbDelete('versions', 'k5')).toBe(true)
    expect(await idbGet('versions', 'k5')).toBeUndefined()
  })

  it('없는 키를 지워도 성공으로 친다', async () => {
    expect(await idbDelete('versions', 'ghost')).toBe(true)
  })
})

describe('유저 스코프', () => {
  // localStorage 와 같은 규칙(scopedKey)을 쓴다. 다른 유저로 로그인하면
  // 앞사람 데이터가 보이면 안 된다.
  it('유저가 다르면 같은 키라도 서로 안 보인다', async () => {
    setCurrentUserId('userA')
    await idbSet('versions', 'shared', 'A의 것')

    setCurrentUserId('userB')
    expect(await idbGet('versions', 'shared')).toBeUndefined()
    await idbSet('versions', 'shared', 'B의 것')

    setCurrentUserId('userA')
    expect(await idbGet('versions', 'shared')).toBe('A의 것')
  })

  it('키 목록에 스코프 접두사가 붙는다', async () => {
    setCurrentUserId('userC')
    await idbSet('versions', 'scoped', 1)
    expect(await idbKeys('versions')).toContain('u:userC:scoped')
  })
})

describe('idbKeys', () => {
  it('넣은 키를 전부 돌려준다', async () => {
    await idbSet('versions', 'a', 1)
    await idbSet('versions', 'b', 2)
    const keys = await idbKeys('versions')
    expect(keys).toEqual(expect.arrayContaining(['a', 'b']))
  })

  it('비어 있으면 빈 배열', async () => {
    expect(await idbKeys('versions')).toEqual([])
  })
})
