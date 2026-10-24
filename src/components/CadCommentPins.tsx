// 엔진 캔버스 **위에** 얹는 코멘트 핀.
//
// tldraw 쪽 `CommentOverlay` 와 **같은 값을 같은 모양으로** 그린다 —
// `pinColor` · `initialOf` · `RESOLVED_COLOR` · `formatWhen` · `placePopup`
// 을 전부 같이 쓴다. 둘이 달라 보이면 "엔진에서는 코멘트가 다르게 나온다"
// 로 읽히는데, 다른 건 그리는 사람이지 그려지는 값이 아니다.
//
// ── 지금은 **보기만** 한다 ──
//
// 달고 고치는 건 아직이다. 쓰려면 저장된 tldraw 스냅샷의
// `document:document` 를 고쳐 써야 하는데, `bimoveDocStore` 는 **읽기
// 전용으로 설계돼 있다** (그 파일 머리말 — 원본이 곧 진실이고 사본을 두지
// 않는다). 저장 경로는 덮어쓰기 사고가 가장 많이 난 자리라 눈 감고
// 건드리지 않는다. 읽는 쪽이 맞는 걸 먼저 보고, 쓰기는 따로 간다.
//
// 그래서 이 화면의 핀은 **끌 수도 지울 수도 없다.** 눌러서 읽기만 한다.

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  initialOf, pinColor, formatWhen, RESOLVED_COLOR,
  type CommentThread,
} from '../lib/commentStore'
import { placePopup, PIN } from '../lib/commentPopup'
import { pageToScreen, onScreen, type CadCam, type CanvasBox } from '../lib/cadCamera'

export function CadCommentPins({ threads, cam, box }: {
  threads: CommentThread[]
  /** **그려진 그 순간의** 카메라 (CadCraftViewer 의 `camView`). */
  cam: CadCam
  box: CanvasBox
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const openIdRef = useRef<string | null>(null)

  // 글타래가 통째로 바뀌면(페이지를 넘기거나 다른 도면을 열면) 열린 창을
  // 닫는다. 안 닫으면 없는 글타래를 가리킨 채 빈 창이 떠 있는다.
  useEffect(() => {
    if (openIdRef.current && !threads.some(t => t.id === openIdRef.current)) {
      openIdRef.current = null
      setOpenId(null)
    }
  }, [threads])

  const open = openId ? threads.find(t => t.id === openId) ?? null : null
  const openAt = open ? pageToScreen(cam, open, box) : null

  const pick = (id: string) => {
    const next = openIdRef.current === id ? null : id
    openIdRef.current = next
    setOpenId(next)
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {threads.map(t => {
        const s = pageToScreen(cam, t, box)
        // 화면 밖 핀은 **만들지 않는다.** 큰 도면에서 500개를 전부 DOM 에
        // 두면 팬이 뻑뻑해진다. 여백을 줘서 가장자리에서 깜빡이지 않게 한다.
        if (!onScreen(s, box, PIN)) return null
        const first = t.messages[0]
        return (
          <button
            key={t.id}
            className={`comment-pin${t.resolved ? ' resolved' : ''}${openId === t.id ? ' open' : ''}`}
            style={{
              left: s.x, top: s.y, width: PIN, height: PIN,
              background: t.resolved ? RESOLVED_COLOR : pinColor(first.author),
              pointerEvents: 'auto',
              cursor: 'pointer',
            }}
            title={`${first.author}: ${first.text.slice(0, 60)}`}
            onClick={() => pick(t.id)}
          >
            {t.resolved ? '✓' : initialOf(first.author)}
            {t.messages.length > 1 && (
              <span className="comment-pin-count">{t.messages.length}</span>
            )}
          </button>
        )
      })}

      {open && openAt && (
        <div className="comment-popup" style={{ ...placePopup(openAt.x, openAt.y, box), pointerEvents: 'auto' }}>
          <div className="comment-popup-head">
            <span className="comment-author">{open.messages[0].author}</span>
            <div style={{ flex: 1 }} />
            <button className="comment-icon-btn" title="닫기" onClick={() => pick(open.id)}>
              <X size={14} strokeWidth={2.2} />
            </button>
          </div>
          <div className="comment-thread">
            {open.messages.map(m => (
              <div key={m.id} className="comment-msg">
                <div className="comment-msg-head">
                  <span className="comment-dot" style={{ background: pinColor(m.author) }} />
                  <span className="comment-msg-author">{m.author}</span>
                  <span className="comment-when">{formatWhen(m.ts)}</span>
                </div>
                <div className="comment-text">{m.text}</div>
              </div>
            ))}
          </div>
          {/* 보기 전용이라는 걸 **말해 둔다.** 입력칸이 없는 걸 고장으로
              읽지 않도록. */}
          <div className="comment-readonly-note">보기 전용 — 답글은 편집 화면에서</div>
        </div>
      )}
    </div>
  )
}
