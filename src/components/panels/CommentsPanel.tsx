import { useEffect, useState } from 'react'
import type { TLShape } from 'tldraw'
import { useEditor } from '../../context/EditorContext'

type Reply = { author: string; text: string; createdAt: number }
type CommentMeta = { createdAt?: number; replies?: Reply[] }

function getCommentMeta(s: TLShape): CommentMeta {
  return (s.meta ?? {}) as CommentMeta
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const AUTHOR_KEY = 'bimove_comment_author_v1'

export function CommentsPanel() {
  const editor = useEditor()
  const [comments, setComments] = useState<TLShape[]>([])
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all')
  const [author, setAuthor] = useState<string>(() => localStorage.getItem(AUTHOR_KEY) ?? '')

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const list = editor.getCurrentPageShapes().filter(s => s.type === 'comment')
      // 최신순
      list.sort((a, b) => (getCommentMeta(b).createdAt ?? 0) - (getCommentMeta(a).createdAt ?? 0))
      setComments(list)
    }
    update()
    const unsub = editor.store.listen(update)
    return unsub
  }, [editor])

  const visible = comments.filter(c => {
    if (filter === 'all') return true
    const resolved = (c.props as { resolved?: boolean }).resolved
    return filter === 'resolved' ? resolved : !resolved
  })

  const focusComment = (c: TLShape) => {
    if (!editor) return
    editor.zoomToBounds(editor.getShapePageBounds(c.id)!, { animation: { duration: 250 }, targetZoom: 1.5 })
    editor.select(c.id)
  }

  const toggleResolved = (c: TLShape) => {
    if (!editor) return
    const cur = (c.props as { resolved: boolean }).resolved
    editor.updateShape({ id: c.id, type: 'comment', props: { ...c.props, resolved: !cur } } as never)
  }

  const addReply = (c: TLShape) => {
    if (!editor) return
    const text = (replyDrafts[c.id] ?? '').trim()
    if (!text) return
    if (!author) { alert('먼저 작성자 이름을 입력해주세요.'); return }
    const meta = getCommentMeta(c)
    const replies = [...(meta.replies ?? []), { author, text, createdAt: Date.now() }]
    editor.updateShape({ id: c.id, type: 'comment', meta: { ...c.meta, replies, createdAt: meta.createdAt ?? Date.now() } } as never)
    setReplyDrafts(d => ({ ...d, [c.id]: '' }))
  }

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">코멘트</div>
      <div className="lbar-panel-body" style={{ fontSize: 12 }}>
        {/* 작성자 */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>내 이름 (답글용)</div>
          <input
            type="text"
            value={author}
            placeholder="이름 입력"
            onChange={e => { setAuthor(e.target.value); localStorage.setItem(AUTHOR_KEY, e.target.value) }}
            style={{ width: '100%', padding: 6, fontSize: 12, border: '1px solid #ddd', borderRadius: 6 }}
          />
        </div>

        {/* 필터 */}
        <div style={{ display: 'flex', borderBottom: '1px solid #eee', marginBottom: 8 }}>
          {(['all', 'open', 'resolved'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              flex: 1, padding: 6, fontSize: 11, border: 'none', cursor: 'pointer',
              background: filter === f ? '#f0f4ff' : 'transparent',
              color: filter === f ? '#1a73e8' : '#666',
              borderBottom: filter === f ? '2px solid #1a73e8' : '2px solid transparent',
            }}>
              {f === 'all' ? '전체' : f === 'open' ? '미해결' : '해결됨'}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div style={{ color: '#bbb', textAlign: 'center', padding: 24 }}>
            {comments.length === 0 ? '아직 코멘트가 없습니다.' : '필터에 맞는 코멘트 없음'}
          </div>
        ) : (
          visible.map(c => {
            const props = c.props as { text: string; author: string; resolved: boolean }
            const meta = getCommentMeta(c)
            const replies = meta.replies ?? []
            return (
              <div key={c.id} style={{
                marginBottom: 12, padding: 10, borderRadius: 8,
                background: props.resolved ? '#f5f5f5' : '#fffbef',
                border: '1px solid ' + (props.resolved ? '#ddd' : '#fbbf24'),
                opacity: props.resolved ? 0.6 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <strong style={{ flex: 1, fontSize: 12 }}>{props.author || '익명'}</strong>
                  <span style={{ fontSize: 10, color: '#888' }}>{meta.createdAt ? fmtTime(meta.createdAt) : ''}</span>
                  <button onClick={() => focusComment(c)} title="위치로 이동"
                    style={{ ...iconBtn }}>🎯</button>
                  <button onClick={() => toggleResolved(c)} title={props.resolved ? '재오픈' : '해결'}
                    style={{ ...iconBtn, color: props.resolved ? '#1a73e8' : '#2d8a2d' }}>
                    {props.resolved ? '↺' : '✓'}
                  </button>
                </div>
                <div style={{ fontSize: 13, color: '#333', whiteSpace: 'pre-wrap' }}>{props.text}</div>

                {replies.length > 0 && (
                  <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: '2px solid #ddd' }}>
                    {replies.map((r, i) => (
                      <div key={i} style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                          <strong style={{ fontSize: 11 }}>{r.author}</strong>
                          <span style={{ fontSize: 10, color: '#888' }}>{fmtTime(r.createdAt)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#444' }}>{r.text}</div>
                      </div>
                    ))}
                  </div>
                )}

                {!props.resolved && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    <input
                      value={replyDrafts[c.id] ?? ''}
                      onChange={e => setReplyDrafts(d => ({ ...d, [c.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') addReply(c) }}
                      placeholder="답글 작성…"
                      style={{ flex: 1, fontSize: 11, padding: 4, border: '1px solid #ddd', borderRadius: 4 }}
                    />
                    <button onClick={() => addReply(c)} style={{
                      padding: '4px 8px', fontSize: 11, border: 'none', borderRadius: 4,
                      background: '#1a73e8', color: '#fff', cursor: 'pointer',
                    }}>↩</button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, padding: '2px 4px',
}
