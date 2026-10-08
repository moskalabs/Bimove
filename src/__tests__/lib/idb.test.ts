/**
 * IndexedDB 래퍼.
 *
 * fake-indexeddb 로 진짜 IDB 구현을 돌린다 — 트랜잭션/커밋 타이밍까지 같이
 * 검증하기 위해서다. 메모리 가짜로 대체하면 정작 틀리기 쉬운 부분
 * (oncomplete 를 안 기다려서 커밋 전에 "저장됐다"고 보고하는 것) 을 못 잡는다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { idbGet, idbSet, idbDelete, idbKeys, idbAvailable, idbBatch, idbGetRange, idbDeleteRange } from '../../lib/idb'
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

describe('idbBatch', () => {
  it('여러 put/delete 를 한 번에 반영한다', async () => {
    await idbSet('docrecords', 'a', 1)
    expect(await idbBatch('docrecords', [
      { type: 'put', key: 'b', value: 2 },
      { type: 'put', key: 'c', value: 3 },
      { type: 'delete', key: 'a' },
    ])).toBe(true)
    expect(await idbGet('docrecords', 'a')).toBeUndefined()
    expect(await idbGet('docrecords', 'b')).toBe(2)
    expect(await idbGet('docrecords', 'c')).toBe(3)
  })

  it('빈 배열은 아무것도 안 하고 성공', async () => {
    expect(await idbBatch('docrecords', [])).toBe(true)
  })

  it('deleteRange 는 접두사가 맞는 키만 지운다', async () => {
    await idbBatch('docrecords', [
      { type: 'put', key: 'p1/r/x', value: 1 },
      { type: 'put', key: 'p1/r/y', value: 2 },
      { type: 'put', key: 'p10/r/z', value: 3 },
      { type: 'put', key: 'p2/r/w', value: 4 },
    ])
    expect(await idbBatch('docrecords', [{ type: 'deleteRange', prefix: 'p1/' }])).toBe(true)
    expect(await idbGet('docrecords', 'p1/r/x')).toBeUndefined()
    expect(await idbGet('docrecords', 'p1/r/y')).toBeUndefined()
    // 'p10/' 은 'p1/' 로 시작하지 않는다 — 접두사 경계를 넘지 말아야 한다
    expect(await idbGet('docrecords', 'p10/r/z')).toBe(3)
    expect(await idbGet('docrecords', 'p2/r/w')).toBe(4)
  })

  // 이게 idbBatch 가 존재하는 이유다. 한 건이 터졌을 때 앞의 put 이 살아남으면
  // 디스크에 옛 레코드와 새 레코드가 섞인 도면이 남는다.
  it('한 건이라도 실패하면 같은 배치의 앞 쓰기도 남지 않는다', async () => {
    await idbSet('docrecords', 'keep', 'old')
    const ok = await idbBatch('docrecords', [
      { type: 'put', key: 'keep', value: 'new' },
      { type: 'put', key: 'bad', value: () => {} },   // 복제 불가
      { type: 'put', key: 'after', value: 'new' },
    ])
    expect(ok).toBe(false)
    expect(await idbGet('docrecords', 'keep')).toBe('old')
    expect(await idbGet('docrecords', 'after')).toBeUndefined()
  })
})

describe('idbGetRange', () => {
  it('접두사를 떼고 돌려준다', async () => {
    await idbBatch('docrecords', [
      { type: 'put', key: 'p1/meta', value: { s: 1 } },
      { type: 'put', key: 'p1/r/shape:a', value: { x: 1 } },
      { type: 'put', key: 'p2/r/shape:b', value: { x: 2 } },
    ])
    const rows = await idbGetRange<unknown>('docrecords', 'p1/')
    expect(rows).not.toBeNull()
    expect([...rows!.keys()].sort()).toEqual(['meta', 'r/shape:a'])
    expect(rows!.get('r/shape:a')).toEqual({ x: 1 })
  })

  // 빈 Map 과 null 은 다른 뜻이다 — 빈 Map 은 "없다", null 은 "못 읽었다".
  it('맞는 키가 없으면 빈 Map (null 아님)', async () => {
    const rows = await idbGetRange('docrecords', 'nope/')
    expect(rows).toEqual(new Map())
  })

  it('유저가 다르면 서로 안 보인다', async () => {
    setCurrentUserId('u1')
    await idbBatch('docrecords', [{ type: 'put', key: 'p1/r/a', value: 1 }])
    setCurrentUserId('u2')
    expect(await idbGetRange('docrecords', 'p1/')).toEqual(new Map())
    setCurrentUserId('u1')
    expect(await idbGetRange('docrecords', 'p1/')).toEqual(new Map([['r/a', 1]]))
  })
})

describe('idbDeleteRange', () => {
  it('접두사로 시작하는 키 전부를 지운다', async () => {
    await idbBatch('docrecords', [
      { type: 'put', key: 'p1/meta', value: 1 },
      { type: 'put', key: 'p1/r/a', value: 2 },
      { type: 'put', key: 'p2/meta', value: 3 },
    ])
    expect(await idbDeleteRange('docrecords', 'p1/')).toBe(true)
    expect(await idbGetRange('docrecords', 'p1/')).toEqual(new Map())
    expect(await idbGet('docrecords', 'p2/meta')).toBe(3)
  })
})
