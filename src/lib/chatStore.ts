// 현장 메모(채팅) 저장.
//
// **프로젝트별**로 따로 둔다. 전엔 글로벌 키 하나를 모두가 나눠 써서, 다른
// 프로젝트를 열어도 남의 현장 메모가 그대로 떠 있었다. 사용자 분리는
// scopedGet/Set 이 `u:<id>:` 를 붙여 처리한다 — 같은 PC 에서 계정을 바꿔도
// 섞이지 않는다.
//
// 화면(ChatPanel)이 아니라 여기 두는 이유는 **프로젝트를 지울 때도 치워야**
// 하기 때문이다. projectStore 가 컴포넌트를 import 하는 건 방향이 거꾸로다.

import { scopedGet, scopedSet, scopedRemove } from './scopedStorage'

export type ChatMessage = {
  id: string
  author: string
  text: string
  ts: number
}

const chatKey = (projectId: string) => `bimova_chat_v1_${projectId}`

/** 작성자 이름은 사람 단위라 프로젝트를 안 가린다 (사용자 스코프만). */
export const CHAT_AUTHOR_KEY = 'bimova_chat_author'

/** 최근 몇 개까지 남길지. 메모가 쌓여 localStorage 를 채우지 않게. */
const MAX_MESSAGES = 200

export function loadChatMessages(projectId: string): ChatMessage[] {
  try {
    return JSON.parse(scopedGet(chatKey(projectId)) ?? '[]') as ChatMessage[]
  } catch {
    return []
  }
}

export function saveChatMessages(projectId: string, msgs: ChatMessage[]): void {
  try {
    scopedSet(chatKey(projectId), JSON.stringify(msgs.slice(-MAX_MESSAGES)))
  } catch { /* storage full */ }
}

/** 이 프로젝트의 현장 메모를 이 기기에서 지운다 (프로젝트 삭제 때). */
export function deleteChatMessages(projectId: string): void {
  scopedRemove(chatKey(projectId))
}
