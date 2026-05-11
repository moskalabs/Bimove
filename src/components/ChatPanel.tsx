import { useState, useEffect, useRef } from 'react'

type Message = {
  id: string
  author: string
  text: string
  ts: number
}

const STORAGE_KEY = 'bimove_chat_v1'
const AUTHOR_KEY = 'bimove_chat_author'

function loadMessages(): Message[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}

function saveMessages(msgs: Message[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-200))) } catch { /**/ }
}

function fmt(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export function ChatPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>(loadMessages)
  const [author, setAuthor] = useState(() => localStorage.getItem(AUTHOR_KEY) ?? '')
  const [draft, setDraft] = useState('')
  const [unread, setUnread] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setUnread(0)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open, messages.length])

  useEffect(() => {
    if (!open && messages.length > 0) setUnread(u => u + 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    const name = author.trim() || '익명'
    if (author !== name) {
      setAuthor(name)
      localStorage.setItem(AUTHOR_KEY, name)
    }
    const msg: Message = { id: crypto.randomUUID(), author: name, text, ts: Date.now() }
    const next = [...messages, msg]
    setMessages(next)
    saveMessages(next)
    setDraft('')
  }

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => { setOpen(v => !v); setUnread(0) }}
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 500,
          width: 46, height: 46, borderRadius: '50%',
          background: open ? '#1a73e8' : '#fff',
          border: '1.5px solid #e0e0e0',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          cursor: 'pointer', fontSize: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: open ? '#fff' : '#444',
          transition: 'all 0.15s',
        }}
        title="채팅"
      >
        {open ? '✕' : '💬'}
        {!open && unread > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: '#e53935', color: '#fff',
            borderRadius: '50%', width: 17, height: 17,
            fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 76, right: 20, zIndex: 499,
          width: 300, height: 420, display: 'flex', flexDirection: 'column',
          background: '#fff', border: '1px solid #e0e0e0',
          borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid #f0f0f0',
            fontWeight: 600, fontSize: 13, color: '#333',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>💬</span>
            <span>채팅</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#999', fontWeight: 400 }}>
              {messages.length}개 메시지
            </span>
          </div>

          {/* Author name */}
          <div style={{ padding: '6px 10px', borderBottom: '1px solid #f5f5f5', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#999', flexShrink: 0 }}>내 이름</span>
            <input
              style={{ flex: 1, fontSize: 12, border: '1px solid #e8e8e8', borderRadius: 4, padding: '3px 7px', outline: 'none' }}
              value={author}
              placeholder="이름 입력"
              onChange={e => { setAuthor(e.target.value); localStorage.setItem(AUTHOR_KEY, e.target.value) }}
            />
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 ? (
              <div style={{ color: '#bbb', fontSize: 12, textAlign: 'center', marginTop: 20 }}>
                첫 메시지를 보내보세요 👋
              </div>
            ) : messages.map(m => (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>{m.author}</span>
                  <span style={{ fontSize: 10, color: '#bbb' }}>{fmt(m.ts)}</span>
                </div>
                <div style={{
                  fontSize: 12, color: '#444', background: '#f8f8f8',
                  borderRadius: 8, padding: '6px 10px', maxWidth: '100%',
                  wordBreak: 'break-word', lineHeight: 1.5,
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '8px 10px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 6 }}>
            <input
              ref={inputRef}
              style={{
                flex: 1, fontSize: 13, border: '1px solid #e0e0e0',
                borderRadius: 8, padding: '7px 10px', outline: 'none',
              }}
              value={draft}
              placeholder="메시지 입력..."
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            />
            <button
              onClick={send}
              disabled={!draft.trim()}
              style={{
                background: draft.trim() ? '#1a73e8' : '#e0e0e0',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '0 12px', cursor: draft.trim() ? 'pointer' : 'default',
                fontSize: 16, transition: 'background 0.15s',
              }}
            >↑</button>
          </div>
        </div>
      )}
    </>
  )
}
