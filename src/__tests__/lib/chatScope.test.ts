/**
 * 현장 메모(채팅)가 사용자·프로젝트별로 갈라지는지.
 *
 * 전엔 글로벌 키 하나(`bimova_chat_v1`)를 모두가 나눠 썼다. 같은 PC 에서 계정을
 * 바꾸거나 다른 프로젝트를 열어도 남의 메모가 그대로 떠 있었다. 현장 메모에는
 * 주소·연락처·단가 같은 게 섞이므로 가벼운 문제가 아니다.
 *
 * ChatPanel 은 DOM 컴포넌트라 여기서는 **키 설계**만 본다 — scopedGet/Set 이
 * 사용자를, 키의 projectId 가 프로젝트를 가른다.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { scopedGet, scopedSet, setCurrentUserId } from '../../lib/scopedStorage'

const chatKey = (projectId: string) => `bimova_chat_v1_${projectId}`

beforeEach(() => {
  localStorage.clear()
  setCurrentUserId(null)
})

describe('현장 메모 저장 범위', () => {
  it('프로젝트가 다르면 섞이지 않는다', () => {
    setCurrentUserId('u1')
    scopedSet(chatKey('projA'), JSON.stringify([{ text: 'A현장 303호 누수' }]))
    expect(scopedGet(chatKey('projB'))).toBeNull()
  })

  it('사용자가 다르면 섞이지 않는다', () => {
    setCurrentUserId('u1')
    scopedSet(chatKey('projA'), JSON.stringify([{ text: '사장님 연락처 010-…' }]))
    setCurrentUserId('u2')
    expect(scopedGet(chatKey('projA'))).toBeNull()
  })

  it('같은 사용자·같은 프로젝트면 그대로 읽힌다', () => {
    setCurrentUserId('u1')
    scopedSet(chatKey('projA'), JSON.stringify([{ text: '단열재 추가' }]))
    setCurrentUserId('u2')
    setCurrentUserId('u1')
    expect(scopedGet(chatKey('projA'))).toContain('단열재 추가')
  })

  it('옛 글로벌 키와 겹치지 않는다', () => {
    // 예전 데이터가 남아 있어도 새 키로는 안 읽힌다 — 섞이지 않는 게 중요하다.
    localStorage.setItem('bimova_chat_v1', JSON.stringify([{ text: '옛 메모' }]))
    setCurrentUserId('u1')
    expect(scopedGet(chatKey('projA'))).toBeNull()
  })
})
