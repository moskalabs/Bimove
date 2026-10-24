// 도면 위 코멘트 핀과 글타래 창.
//
// 핀은 **page 좌표**에 꽂혀 있고 화면 좌표는 매 프레임 다시 잰다 (RoomOverlay
// 와 같은 방식). 그래서 확대·이동을 해도 도면의 그 자리에 붙어 있는다.
//
// ── 읽기 전용에서는 **보기만** 한다 ──
//
// 한동안 반대였다. "읽기 전용은 권한이 아니라 입력기 판정이고(readonlyMode.ts)
// 코멘트 다는 데는 정밀한 포인팅이 필요 없으니 폰에서도 쓰게 하자" 고 적어
// 뒀었다. 그 주장은 접는다.
//
// tldraw 를 걷어내면서 읽기 전용 경로는 엔진이 그리게 되는데, 거기서는
// **쓸 수가 없다.** 저장된 스냅샷을 고쳐 써야 하고 `bimoveDocStore` 는 읽기
// 전용으로 설계돼 있다 (그 파일 머리말). 쓰기 길을 따로 내는 건 저장 경로를
// 건드리는 일이라 "읽기 전용은 정말 읽기만" 으로 정했다.
//
// 그러면 **지금 이쪽도 같이 닫아야 한다.** 안 그러면 같은 폰에서 오늘은
// 코멘트가 달리고 엔진으로 바뀌는 날 조용히 안 달린다 — 쓰던 사람에게는
// 그게 기능이 사라진 것이다. 지금 맞춰 두면 바뀌는 날 달라지는 게 없다.
//
// EditLock 으로 묶지는 않는다. 그건 fieldset 으로 **안쪽 버튼을 전부** 막아서
// '닫기' 나 '해결된 것 보기' 같은 보기 쪽 버튼까지 죽는다. 쓰는 것만 고른다.

import { useState, useEffect, useCallback, useRef } from 'react'
// 아이콘은 이모지가 아니라 선 그림으로 — OS 폰트마다 모양이 제각각이라
// 🗑 하나만 톤이 튄다 (LayersPanel 의 `Svg` 주석과 같은 이유).
import { Check, Trash2, X } from 'lucide-react'
import { useEditor } from '../context/EditorContext'
import { useReadonly } from '../context/ReadonlyContext'
import { useAuth } from '../context/AuthContext'
import { commentPinState, cancelCommentPin, completeCommentPin } from '../lib/drawingState'
import {
  addThread, addReply, setResolved, deleteThread, moveThread,
  authorName, rememberAuthor, CommentLimitError, MAX_TEXT,
  initialOf, pinColor, formatWhen, RESOLVED_COLOR,
  type CommentThread,
} from '../lib/commentStore'
import { useCommentThreads } from './useCommentThreads'
import { placePopup, PIN } from '../lib/commentPopup'

/** 이만큼 못 움직였으면 끈 게 아니라 **누른** 것이다. */
const DRAG_SLOP = 4

/** 창 자리는 `placePopup` 이 잰다 (lib/commentPopup.ts) — 거기에 테스트가 있다. */
const popupStyle = (vx: number, vy: number, box: { w: number; h: number }): React.CSSProperties =>
  ({ ...placePopup(vx, vy, box), pointerEvents: 'auto' })

type Placed = CommentThread & { vx: number; vy: number }

export function CommentOverlay() {
  const editor = useEditor()
  const readonly = useReadonly()
  const { user } = useAuth()
  const me = authorName((user?.user_metadata?.display_name as string) ?? user?.email?.split('@')[0])

  // 지금 장의 글타래. 장이 바뀌면 훅이 알아서 다시 읽는다.
  const threads = useCommentThreads(editor)

  const [placing, setPlacing] = useState(false)
  const [placed, setPlaced] = useState<Placed[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  /** 핀을 찍자마자 뜨는 입력창 — 아직 글타래가 없는 상태다. */
  const [draftAt, setDraftAt] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState<string | null>(null)
  /** 창을 밀어 넣을 상자 — 창(window)이 아니라 **캔버스**다. */
  const [box, setBox] = useState({ w: 0, h: 0 })

  const threadsRef = useRef<CommentThread[]>([])
  /** 끌기 핸들러는 한 번 만들어 붙으므로 state 를 그대로 읽으면 옛값이 잡힌다. */
  const openIdRef = useRef<string | null>(null)
  const rafRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  /** 화면 좌표만 다시 잰다 — 카메라가 움직일 때마다 부르는 가벼운 쪽. */
  const reposition = useCallback(() => {
    if (!editor) return
    setPlaced(threadsRef.current.map(t => {
      const vp = editor.pageToViewport({ x: t.x, y: t.y })
      return { ...t, vx: vp.x, vy: vp.y }
    }))
  }, [editor])

  // 글타래가 바뀌면 자리를 다시 잰다.
  useEffect(() => {
    threadsRef.current = threads
    reposition()
  }, [threads, reposition])

  // 카메라가 움직이면 자리만 다시 잰다 — 거르지 않는다.
  useEffect(() => {
    if (!editor) return
    const unsub = editor.store.listen(() => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; reposition() })
    })
    return () => {
      unsub()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [editor, reposition])

  /**
   * 창을 밀어 넣을 상자를 잰다.
   *
   * 전엔 `window.innerWidth` 로 쟀다. 실제 부모는 좌우 패널을 뺀
   * `.canvas-area` 이고 overflow 가 hidden 이라, 오른쪽 끝 핀의 입력칸과
   * 버튼이 **잘려서 보이지 않았다.** 아래쪽은 아예 보지도 않았다.
   */
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /**
   * 글타래를 연다 — **쓰던 답글을 두고 가지 않는다.**
   *
   * 전엔 패널에서 다른 코멘트를 열 때 `draft` 를 안 비웠다. A 에 쓰다 만
   * 답글이 입력칸에 남은 채 B 가 열리고, 거기서 '답글' 을 누르면 A 에 하려던
   * 말이 B 에 달린다. 여는 길이 둘(패널·핀)이라 한쪽만 고치면 또 샌다.
   * 그래서 여닫는 길을 여기 하나로 모은다.
   */
  const openThread = useCallback((id: string | null) => {
    openIdRef.current = id
    setOpenId(id)
    setDraftAt(null)
    setDraft('')
    setErr(null)
  }, [])

  // 핀 찍기 모드 on/off
  useEffect(() => {
    const handler = (e: Event) => {
      const active = (e as CustomEvent).detail.active as boolean
      // 읽기 전용에서는 **켜지지 않는다.** 패널의 + 는 숨겨 두지만, 다른
      // 길(단축키·남아 있는 이벤트)로 켜져도 여기서 되돌린다.
      if (active && readonly) { cancelCommentPin(); return }
      setPlacing(active)
      if (active) openThread(null)
    }
    window.addEventListener('bimova:comment-pin', handler)
    return () => window.removeEventListener('bimova:comment-pin', handler)
  }, [openThread, readonly])

  // 목록(패널)에서 하나를 고르면 그리로 날아가 연다
  useEffect(() => {
    if (!editor) return
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail.threadId as string
      const t = threadsRef.current.find(x => x.id === id)
      if (!t) return
      editor.centerOnPoint({ x: t.x, y: t.y }, { animation: { duration: 220 } })
      openThread(id)
    }
    window.addEventListener('bimova:comment-open', handler)
    return () => window.removeEventListener('bimova:comment-open', handler)
  }, [editor, openThread])

  // Esc 로 빠져나온다 — 찍기 모드든 열린 창이든
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (commentPinState.active) cancelCommentPin()
      openThread(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openThread])

  useEffect(() => {
    if (draftAt || openId) setTimeout(() => inputRef.current?.focus(), 40)
  }, [draftAt, openId])

  // ── 핀 찍기 ──
  const placeAt = (e: React.MouseEvent) => {
    if (!editor) return
    const page = editor.screenToPage({ x: e.clientX, y: e.clientY })
    completeCommentPin(page)
    openThread(null)
    setDraftAt(page)
  }

  const submitNew = () => {
    if (!editor || !draftAt) return
    const text = draft.trim()
    if (!text) { setDraftAt(null); return }
    try {
      const t = addThread(editor, draftAt, me, text)
      rememberAuthor(me)
      openThread(t.id)
    } catch (ex) {
      setErr(ex instanceof CommentLimitError ? ex.message : '코멘트를 저장하지 못했습니다')
    }
  }

  const submitReply = (threadId: string) => {
    if (!editor) return
    const text = draft.trim()
    if (!text) return
    try {
      addReply(editor, threadId, me, text)
      rememberAuthor(me)
      setDraft('')
      setErr(null)
    } catch (ex) {
      setErr(ex instanceof CommentLimitError ? ex.message : '답글을 저장하지 못했습니다')
    }
  }

  // ── 핀 끌어 옮기기 ──
  //
  // 누른 것과 끈 것을 **움직인 거리로** 가른다. pointerdown 에서 바로 창을
  // 열면 조금만 끌려도 창이 열려 버리고, pointerup 에서만 열면 끌어 옮긴
  // 뒤에도 창이 열린다.
  const startDrag = (e: React.PointerEvent, t: Placed) => {
    if (!editor) return
    e.stopPropagation()
    // 읽기 전용에서는 못 옮긴다 — 누르면 열리기만 한다.
    if (readonly) { openThread(openIdRef.current === t.id ? null : t.id); return }
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const from = { x: e.clientX, y: e.clientY }
    let moved = false

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < DRAG_SLOP) return
      moved = true
      const page = editor.screenToPage({ x: ev.clientX, y: ev.clientY })
      const vp = editor.pageToViewport(page)
      // 끄는 동안은 화면만 따라오게 하고, 문서에는 **손을 뗄 때 한 번만** 쓴다.
      // 매 프레임 쓰면 저장 구독이 그만큼 울려 큰 도면에서 뻑뻑해진다.
      setPlaced(prev => prev.map(p => (p.id === t.id
        ? { ...p, x: page.x, y: page.y, vx: vp.x, vy: vp.y }
        : p)))
    }

    const onUp = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      if (!moved) {
        openThread(openIdRef.current === t.id ? null : t.id)
        return
      }
      moveThread(editor, t.id, editor.screenToPage({ x: ev.clientX, y: ev.clientY }))
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  if (!editor) return null

  const open = openId ? placed.find(t => t.id === openId) ?? null : null
  const draftVp = draftAt ? editor.pageToViewport(draftAt) : null

  return (
    <div ref={rootRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 60 }}>
      {/* 찍기 모드: 캔버스를 통째로 받아 한 번 찍는다 */}
      {placing && (
        <div
          className="comment-catcher"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', cursor: 'crosshair' }}
          onClick={placeAt}
        />
      )}

      {placed.map(t => {
        const first = t.messages[0]
        return (
          <button
            key={t.id}
            className={`comment-pin${t.resolved ? ' resolved' : ''}${openId === t.id ? ' open' : ''}`}
            style={{
              left: t.vx, top: t.vy,
              width: PIN, height: PIN,
              background: t.resolved ? RESOLVED_COLOR : pinColor(first.author),
              pointerEvents: placing ? 'none' : 'auto',
            }}
            title={`${first.author}: ${first.text.slice(0, 60)}`}
            onPointerDown={e => startDrag(e, t)}
          >
            {t.resolved ? '✓' : initialOf(first.author)}
            {t.messages.length > 1 && (
              <span className="comment-pin-count">{t.messages.length}</span>
            )}
          </button>
        )
      })}

      {/* 막 찍은 핀 — 아직 저장 전이다 */}
      {draftVp && (
        <>
          <div
            className="comment-pin pending"
            style={{ left: draftVp.x, top: draftVp.y, width: PIN, height: PIN, background: pinColor(me) }}
          >
            {initialOf(me)}
          </div>
          <div className="comment-popup" style={popupStyle(draftVp.x, draftVp.y, box)}>
            <div className="comment-popup-head">
              <span className="comment-author">{me}</span>
              <div style={{ flex: 1 }} />
              <button className="comment-icon-btn" title="취소" onClick={() => setDraftAt(null)}>
                <X size={14} strokeWidth={2.2} />
              </button>
            </div>
            <textarea
              ref={inputRef}
              className="comment-input"
              maxLength={MAX_TEXT}
              placeholder="코멘트를 남겨보세요"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNew() }
              }}
            />
            {err && <div className="comment-err">{err}</div>}
            <div className="comment-popup-foot">
              <button className="comment-btn ghost" onClick={() => setDraftAt(null)}>취소</button>
              <button className="comment-btn primary" onClick={submitNew} disabled={!draft.trim()}>남기기</button>
            </div>
          </div>
        </>
      )}

      {/* 열린 글타래 */}
      {open && (
        <div className="comment-popup" style={popupStyle(open.vx, open.vy, box)}>
          <div className="comment-popup-head">
            <span className="comment-author">{open.messages[0].author}</span>
            <div style={{ flex: 1 }} />
            {!readonly && (
              <>
                <button
                  className={`comment-icon-btn${open.resolved ? ' on' : ''}`}
                  title={open.resolved ? '다시 열기' : '해결'}
                  onClick={() => setResolved(editor, open.id, !open.resolved)}
                ><Check size={14} strokeWidth={2.2} /></button>
                <button
                  className="comment-icon-btn"
                  title="삭제"
                  onClick={() => { deleteThread(editor, open.id); openThread(null) }}
                ><Trash2 size={13} strokeWidth={2} /></button>
              </>
            )}
            <button className="comment-icon-btn" title="닫기" onClick={() => openThread(null)}>
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
          {readonly ? (
            // 엔진 화면(CadCommentPins)과 **같은 말**을 쓴다. 보는 사람에게는
            // 어느 쪽으로 그려졌는지가 보이지 않아야 한다.
            <div className="comment-readonly-note">보기 전용 — 답글은 편집 화면에서</div>
          ) : (
            <>
              <textarea
                ref={inputRef}
                className="comment-input"
                maxLength={MAX_TEXT}
                placeholder="답글"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitReply(open.id) }
                }}
              />
              {err && <div className="comment-err">{err}</div>}
              <div className="comment-popup-foot">
                <button className="comment-btn ghost" onClick={() => openThread(null)}>닫기</button>
                <button className="comment-btn primary" onClick={() => submitReply(open.id)} disabled={!draft.trim()}>답글</button>
              </div>
            </>
          )}
        </div>
      )}

      {placing && (
        <div className="comment-hint">클릭해서 코멘트를 남길 자리를 고르세요 · Esc 로 취소</div>
      )}
    </div>
  )
}
