// 코멘트 목록. 핀을 찾으러 도면을 훑지 않아도 되게.
//
// 항목을 누르면 그 핀으로 카메라를 옮기고 글타래를 연다 — 창을 띄우는 일은
// 오버레이가 하므로 여기서는 **알리기만** 한다 (`bimova:comment-open`).
// 패널이 오버레이의 상태를 직접 쥐면 둘이 서로를 import 하게 된다.

import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, MessageSquarePlus } from 'lucide-react'
import { useEditor } from '../../context/EditorContext'
import { startCommentPin, cancelCommentPin, commentPinState } from '../../lib/drawingState'
import {
  getThreads, rawThreads, setResolved,
  initialOf, pinColor, formatWhen, RESOLVED_COLOR,
  type CommentThread,
} from '../../lib/commentStore'

export function CommentsPanel() {
  const editor = useEditor()
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [placing, setPlacing] = useState(commentPinState.active)
  const rawRef = useRef<unknown>(undefined)

  const resync = useCallback(() => {
    if (editor) setThreads(getThreads(editor))
  }, [editor])

  useEffect(() => {
    if (!editor) return
    rawRef.current = rawThreads(editor)
    // 초기값 — 아래 구독의 씨딩이다 (RBar 와 같다).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resync()
    // 코멘트 칸이 **바뀌었을 때만** 다시 읽는다. 카메라를 움직일 때마다
    // 목록을 새로 만들면 팬이 뻑뻑해진다.
    const unsub = editor.store.listen(() => {
      const raw = rawThreads(editor)
      if (raw === rawRef.current) return
      rawRef.current = raw
      resync()
    })
    return unsub
  }, [editor, resync])

  useEffect(() => {
    const handler = (e: Event) => setPlacing((e as CustomEvent).detail.active as boolean)
    window.addEventListener('bimova:comment-pin', handler)
    return () => window.removeEventListener('bimova:comment-pin', handler)
  }, [])

  // 패널을 닫으면 찍기 모드도 같이 끈다 — 패널이 없는데 십자 커서만 남아
  // 있으면 어떻게 빠져나오는지 알 수가 없다.
  useEffect(() => () => { if (commentPinState.active) cancelCommentPin() }, [])

  const shown = showResolved ? threads : threads.filter(t => !t.resolved)
  const resolvedCount = threads.length - threads.filter(t => !t.resolved).length

  return (
    <aside className="lbar-panel">
      <div className="lbar-panel-header comment-panel-header">
        <span>코멘트</span>
        <button
          className={`comment-add-btn${placing ? ' on' : ''}`}
          title={placing ? '찍기 취소' : '코멘트 남기기'}
          onClick={() => (placing ? cancelCommentPin() : startCommentPin())}
        >
          <MessageSquarePlus size={15} strokeWidth={1.9} />
        </button>
      </div>

      <div className="lbar-panel-body">
        {shown.length === 0 && (
          <div className="comment-empty">
            {threads.length === 0
              ? '아직 코멘트가 없습니다.\n위 + 를 누르고 도면을 클릭해 보세요.'
              : '열려 있는 코멘트가 없습니다.'}
          </div>
        )}

        {shown.map(t => {
          const first = t.messages[0]
          return (
            <div
              key={t.id}
              className={`comment-row${t.resolved ? ' resolved' : ''}`}
              onClick={() => window.dispatchEvent(
                new CustomEvent('bimova:comment-open', { detail: { threadId: t.id } }),
              )}
            >
              <span className="comment-avatar" style={{ background: t.resolved ? RESOLVED_COLOR : pinColor(first.author) }}>
                {t.resolved ? '✓' : initialOf(first.author)}
              </span>
              <div className="comment-row-body">
                <div className="comment-row-head">
                  <span className="comment-row-author">{first.author}</span>
                  <span className="comment-when">{formatWhen(first.ts)}</span>
                </div>
                <div className="comment-row-text">{first.text}</div>
                {t.messages.length > 1 && (
                  <div className="comment-row-more">답글 {t.messages.length - 1}</div>
                )}
              </div>
              <button
                className={`comment-icon-btn${t.resolved ? ' on' : ''}`}
                title={t.resolved ? '다시 열기' : '해결'}
                onClick={e => {
                  e.stopPropagation()
                  if (editor) setResolved(editor, t.id, !t.resolved)
                }}
              ><Check size={14} strokeWidth={2.2} /></button>
            </div>
          )
        })}

        {resolvedCount > 0 && (
          <button className="comment-toggle-resolved" onClick={() => setShowResolved(v => !v)}>
            {showResolved ? '해결된 것 숨기기' : `해결된 것 ${resolvedCount}개 보기`}
          </button>
        )}
      </div>
    </aside>
  )
}
