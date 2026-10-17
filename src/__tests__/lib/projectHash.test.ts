/**
 * `#project=<id>` 읽기/쓰기.
 *
 * 전엔 쓰기만 있고 읽는 데가 없어서 새로고침하면 대시보드로 떨어졌다. 그래서
 * 여기서 보는 건 "쓴 걸 되읽을 수 있나" 와 "쓰레기를 걸러내나" 두 가지다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readProjectHash, pushProjectHash, replaceProjectHash, clearProjectHash,
} from '../../lib/projectHash'

const ID = '0191f0c2-6a5e-7b3d-8f41-9c2d5e6a7b80'

beforeEach(() => {
  history.replaceState(null, '', window.location.pathname)
})

describe('readProjectHash', () => {
  it('쓴 id 를 그대로 되읽는다', () => {
    pushProjectHash(ID)
    expect(readProjectHash()).toBe(ID)
  })

  it('hash 가 없으면 null', () => {
    expect(readProjectHash()).toBeNull()
  })

  it('공유 링크 hash 는 프로젝트가 아니다', () => {
    // 한 자리를 나눠 쓰므로 접두사를 엄격하게 봐야 한다. 여기서 뭔가
    // 돌려주면 공유 링크 처리가 가로채인다.
    window.location.hash = '#share=H4sIAAAA'
    expect(readProjectHash()).toBeNull()
  })

  it('UUID 가 아니면 null — 쿼리와 저장 키로 그대로 들어가는 값이다', () => {
    for (const junk of ['', 'abc', '../../etc/passwd', "1' OR '1'='1", ID + 'x', ID.slice(0, -1)]) {
      window.location.hash = `#project=${junk}`
      expect(readProjectHash(), `#project=${junk}`).toBeNull()
    }
  })

  it('대문자 UUID 도 받는다', () => {
    window.location.hash = `#project=${ID.toUpperCase()}`
    expect(readProjectHash()).toBe(ID.toUpperCase())
  })
})

describe('history 상태', () => {
  it('push 는 뒤로가기로 목록에 돌아올 수 있게 쌓는다', () => {
    const before = history.length
    pushProjectHash(ID)
    expect(history.length).toBe(before + 1)
    expect(history.state).toEqual({ view: 'editor', id: ID })
  })

  it('replace 는 쌓지 않는다 — 이미 그 주소에 서 있으니까', () => {
    const before = history.length
    replaceProjectHash(ID)
    expect(history.length).toBe(before)
    expect(readProjectHash()).toBe(ID)
  })

  it('replace 도 editor 상태를 남긴다 (닫기·뒤로가기가 이걸 본다)', () => {
    // App 의 closeProject / popstate 핸들러가 state.view 로 판단한다.
    // 여기가 비면 새로고침 뒤에 뒤로가기가 목록 대신 사이트를 나간다.
    replaceProjectHash(ID)
    expect(history.state).toEqual({ view: 'editor', id: ID })
  })
})

describe('clearProjectHash', () => {
  it('프로젝트 hash 를 치운다', () => {
    pushProjectHash(ID)
    clearProjectHash()
    expect(window.location.hash).toBe('')
    expect(readProjectHash()).toBeNull()
  })

  it('남의 hash 는 건드리지 않는다', () => {
    window.location.hash = '#share=abc'
    clearProjectHash()
    expect(window.location.hash).toBe('#share=abc')
  })
})
