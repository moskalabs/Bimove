// 도면 위 코멘트 핀과 글타래 창.
//
// 핀은 **page 좌표**에 꽂혀 있고 화면 좌표는 매 프레임 다시 잰다 (RoomOverlay
// 와 같은 방식). 그래서 확대·이동을 해도 도면의 그 자리에 붙어 있는다.
//
// **읽기 전용에서도 쓸 수 있다.** Bimove 의 읽기 전용은 권한이 아니라 입력기
// 판정이다 (readonlyMode.ts) — 작은 화면·손가락이면 정밀한 포인팅이 안 되니
// 그리지 못하게 하는 것이다. 코멘트를 다는 데는 정밀한 포인팅이 필요 없고,
// 오히려 **현장에서 태블릿으로 보다가** 남기는 게 이 기능의 본래 쓰임이다.
// 그래서 EditLock 으로 묶지 않는다.

import { useState, useEffect, useCallback, useRef } from 'react'
// 아이콘은 이모지가 아니라 선 그림으로 — OS 폰트마다 모양이 제각각이라
// 🗑 하나만 톤이 튄다 (LayersPanel 의 `Svg` 주석과 같은 이유).
import { Check, Trash2, X } from 'lucide-react'
import { useEditor } from '../context/EditorContext'
import { useAuth } from '../context/AuthContext'
import { commentPinState, cancelCommentPin, completeCommentPin } from '../lib/drawingState'
import {
  getThreads, rawThreads, addThread, addReply, setResolved, deleteThread, moveThread,
  authorName, rememberAuthor, CommentLimitError, MAX_TEXT,
  initialOf, pinColor, formatWhen, RESOLVED_COLOR,
  type CommentThread,
} from '../lib/commentStore'

/** 핀 지름. 글타래 창을 핀 옆에 붙일 때도 쓴다. */
const PIN = 28

/** 이만큼 못 움직였으면 끈 게 아니라 **누른** 것이다. */
const DRAG_SLOP = 4

const POPUP_W = 260

type Placed = CommentThread & { vx: number; vy: number }

export function CommentOverlay() {
  const editor = useEditor()
  const { user } = useAuth()
  const me = authorName((user?.user_metadata?.display_name as string) ?? user?.email?.split('@')[0])

  const [placing, setPlacing] = useState(false)
  const [placed, setPlaced] = useState<Placed[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  /** 핀을 찍자마자 뜨는 입력창 — 아직 글타래가 없는 상태다. */
  const [draftAt, setDraftAt] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const threadsRef = useRef<CommentThread[]>([])
  const rawRef = useRef<unknown>(undefined)
  const rafRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  /** 화면 좌표만 다시 잰다 — 카메라가 움직일 때마다 부르는 가벼운 쪽. */
  const reposition = useCallback(() => {
    if (!editor) return
    setPlaced(threadsRef.current.map(t => {
      const vp = editor.pageToViewport({ x: t.x, y: t.y })
      return { ...t, vx: vp.x, vy: vp.y }
    }))
  }, [editor])

  /** 코멘트 자체가 바뀌었을 때만 다시 거른다 (commentStore.rawThreads 주석). */
  const resync = useCallback(() => {
    if (!editor) return
    threadsRef.current = getThreads(editor)
    reposition()
  }, [editor, reposition])

  useEffect(() => {
    if (!editor) return
    rawRef.current = rawThreads(editor)
    resync()

    const unsub = editor.store.listen(() => {
      const raw = rawThreads(editor)
      if (raw !== rawRef.current) {
        rawRef.current = raw
        resync()
        return
      }
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; reposition() })
      }
    })
    return () => {
      unsub()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [editor, resync, reposition])

  // 핀 찍기 모드 on/off
  useEffect(() => {
    const handler = (e: Event) => {
      const active = (e as CustomEvent).detail.active as boolean
      setPlacing(active)
      if (active) { setOpenId(null); setDraftAt(null); setErr(null) }
    }
    window.addEventListener('bimova:comment-pin', handler)
    return () => window.removeEventListener('bimova:comment-pin', handler)
  }, [])

  // 목록(패널)에서 하나를 고르면 그리로 날아가 연다
  useEffect(() => {
    if (!editor) return
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail.threadId as string
      const t = threadsRef.current.find(x => x.id === id)
      if (!t) return
      editor.centerOnPoint({ x: t.x, y: t.y }, { animation: { duration: 220 } })
      setDraftAt(null)
      setOpenId(id)
    }
    window.addEventListener('bimova:comment-open', handler)
    return () => window.removeEventListener('bimova:comment-open', handler)
  }, [editor])

  // Esc 로 빠져나온다 — 찍기 모드든 열린 창이든
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (commentPinState.active) cancelCommentPin()
      setDraftAt(null)
      setOpenId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (draftAt || openId) setTimeout(() => inputRef.current?.focus(), 40)
  }, [draftAt, openId])

  // ── 핀 찍기 ──
  const placeAt = (e: React.MouseEvent) => {
    if (!editor) return
    const page = editor.screenToPage({ x: e.clientX, y: e.clientY })
    completeCommentPin(page)
    setDraft('')
    setErr(null)
    setDraftAt(page)
  }

  const submitNew = () => {
    if (!editor || !draftAt) return
    const text = draft.trim()
    if (!text) { setDraftAt(null); return }
    try {
      const t = addThread(editor, draftAt, me, text)
      rememberAuthor(me)
      setDraftAt(null)
      setDraft('')
      setOpenId(t.id)
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
        setDraftAt(null)
        setDraft('')
        setErr(null)
        setOpenId(id => (id === t.id ? null : t.id))
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
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 60 }}>
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
        const color = pinColor(first.author)
        return (
          <button
            key={t.id}
            className={`comment-pin${t.resolved ? ' resolved' : ''}${openId === t.id ? ' open' : ''}`}
            style={{
              left: t.vx, top: t.vy,
              width: PIN, height: PIN,
              background: t.resolved ? RESOLVED_COLOR : color,
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
          <div className="comment-popup" style={popupStyle(draftVp.x, draftVp.y)}>
            <div className="comment-popup-head">
              <span className="comment-author">{me}</span>
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
        <div className="comment-popup" style={popupStyle(open.vx, open.vy)}>
          <div className="comment-popup-head">
            <span className="comment-author">{open.messages[0].author}</span>
            <div style={{ flex: 1 }} />
            <button
              className={`comment-icon-btn${open.resolved ? ' on' : ''}`}
              title={open.resolved ? '다시 열기' : '해결'}
              onClick={() => setResolved(editor, open.id, !open.resolved)}
            ><Check size={14} strokeWidth={2.2} /></button>
            <button
              className="comment-icon-btn"
              title="삭제"
              onClick={() => { deleteThread(editor, open.id); setOpenId(null) }}
            ><Trash2 size={13} strokeWidth={2} /></button>
            <button className="comment-icon-btn" title="닫기" onClick={() => setOpenId(null)}>
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
            <button className="comment-btn ghost" onClick={() => { setOpenId(null); setDraft('') }}>닫기</button>
            <button className="comment-btn primary" onClick={() => submitReply(open.id)} disabled={!draft.trim()}>답글</button>
          </div>
        </div>
      )}

      {placing && (
        <div className="comment-hint">클릭해서 코멘트를 남길 자리를 고르세요 · Esc 로 취소</div>
      )}
    </div>
  )
}

/**
 * 창을 핀 옆에 붙이되 **화면 밖으로 나가지 않게** 민다.
 *
 * 도면 오른쪽 끝에 달린 코멘트는 오른쪽으로 펴면 잘려서 입력칸이 안 보인다.
 */
function popupStyle(vx: number, vy: number): React.CSSProperties {
  const room = typeof window !== 'undefined' ? window.innerWidth : 1280
  const flip = vx + PIN + 12 + POPUP_W > room - 24
  return {
    left: flip ? vx - PIN / 2 - 12 - POPUP_W : vx + PIN / 2 + 12,
    top: Math.max(8, vy - PIN),
    width: POPUP_W,
    pointerEvents: 'auto',
  }
}
