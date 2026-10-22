// 지금 장에 달린 코멘트를 읽어 온다. 핀·목록·배지가 같이 쓴다.
//
// 셋이 똑같은 구독을 따로 적고 있었다. 그러면 조건이 하나 늘 때마다 세 군데를
// 고쳐야 하고, **실제로 한 군데가 빠졌다** — 장을 넘겼을 때 다시 읽는 조건이
// 그렇다.
//
// ── 무엇이 바뀌면 다시 읽나 ──
//
// store 는 **카메라만 움직여도** 울린다. 그때마다 500 개를 거르면 팬이
// 뻑뻑해지므로, 다음 둘 중 하나가 바뀔 때만 다시 읽는다.
//
//  - 문서 meta 의 코멘트 칸 (`rawThreads` 의 **참조**가 바뀌었나)
//  - 지금 보고 있는 **장**
//
// 장을 빠뜨리면 1장에서 2장으로 넘어가도 1장의 핀이 그대로 떠 있는다 — 칸은
// 안 바뀌었으니 참조 비교로는 잡히지 않는다.

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Editor } from 'tldraw'
import { threadsOnPage, rawThreads, type CommentThread } from '../lib/commentStore'

function pageOf(editor: Editor): string {
  try {
    return editor.getCurrentPageId?.() ?? ''
  } catch {
    return ''
  }
}

export function useCommentThreads(editor: Editor | null): CommentThread[] {
  const [threads, setThreads] = useState<CommentThread[]>([])
  const rawRef = useRef<unknown>(undefined)
  const pageRef = useRef('')

  const resync = useCallback(() => {
    if (editor) setThreads(threadsOnPage(editor))
  }, [editor])

  useEffect(() => {
    if (!editor) return
    rawRef.current = rawThreads(editor)
    pageRef.current = pageOf(editor)
    // 초기값 — 아래 구독의 씨딩이다. 에디터에서 **한 번 읽어오는** 것이지
    // 파생 상태를 다시 계산하는 게 아니라 캐스케이드가 나지 않는다
    // (RBar 의 같은 자리 주석 참고).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resync()

    return editor.store.listen(() => {
      const raw = rawThreads(editor)
      const page = pageOf(editor)
      if (raw === rawRef.current && page === pageRef.current) return
      rawRef.current = raw
      pageRef.current = page
      resync()
    })
  }, [editor, resync])

  // 에디터가 아직(또는 더 이상) 없으면 **빈 목록**이다. state 를 지우는 게
  // 아니라 여기서 걸러 낸다 — 프로젝트를 갈아 끼우는 찰나에 옛 프로젝트의
  // 개수가 배지에 남아 있으면 안 된다.
  return editor ? threads : EMPTY
}

/** 매번 새 배열을 만들면 쓰는 쪽의 effect 가 헛돈다. */
const EMPTY: CommentThread[] = []
