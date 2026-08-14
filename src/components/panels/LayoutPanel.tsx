import { useEffect, useState, useRef, useCallback } from 'react'
import { PageRecordType } from 'tldraw'
import { Plus } from 'lucide-react'
import { useEditor } from '../../context/EditorContext'

type PageThumb = {
  id: string
  name: string
  index: number
  dataUrl: string | null
}

/** 현재 페이지의 SVG 썸네일을 생성 (페이지 전환 없이) */
async function generateThumb(editor: ReturnType<typeof useEditor>): Promise<string | null> {
  if (!editor) return null
  const shapes = editor.getCurrentPageShapes()
  if (shapes.length === 0 || shapes.length > 300) return null
  try {
    const result = await (editor as unknown as {
      getSvgString: (s: unknown[], o: unknown) => Promise<{ svg: string; width: number; height: number } | undefined>
    }).getSvgString(shapes, { padding: 16, background: true })
    if (result?.svg) {
      return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(result.svg)))
    }
  } catch { /* ignore */ }
  return null
}

export function LayoutPanel() {
  const editor = useEditor()
  const [pages, setPages] = useState<PageThumb[]>([])
  const [currentPageId, setCurrentPageId] = useState('')
  // 썸네일 캐시: pageId → dataUrl (페이지 전환 없이 캐시 유지)
  const thumbCache = useRef<Map<string, string | null>>(new Map())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ── 현재 페이지 썸네일만 갱신 (페이지 전환 X) ── */
  const refreshCurrentThumb = useCallback(async () => {
    if (!editor) return
    const pageId = editor.getCurrentPageId()
    const dataUrl = await generateThumb(editor)
    thumbCache.current.set(pageId, dataUrl)

    // state 갱신
    const allPages = editor.getPages()
    setPages(allPages.map((p, i) => ({
      id: p.id,
      name: p.name,
      index: i + 1,
      dataUrl: thumbCache.current.get(p.id) ?? null,
    })))
    setCurrentPageId(pageId)
  }, [editor])

  /* ── 전체 페이지 목록 동기화 (캐시 기반, 페이지 전환 X) ── */
  const syncPageList = useCallback(() => {
    if (!editor) return
    const allPages = editor.getPages()
    const pageId = editor.getCurrentPageId()
    setCurrentPageId(pageId)
    setPages(allPages.map((p, i) => ({
      id: p.id,
      name: p.name,
      index: i + 1,
      dataUrl: thumbCache.current.get(p.id) ?? null,
    })))
  }, [editor])

  useEffect(() => {
    if (!editor) return

    // 초기: 현재 페이지 썸네일 생성
    refreshCurrentThumb()

    let prevPageId = editor.getCurrentPageId()
    let prevPageCount = editor.getPages().length
    let prevShapeCount = editor.getCurrentPageShapes().length

    const unsub = editor.store.listen(() => {
      const curPageId = editor.getCurrentPageId()
      const curPageCount = editor.getPages().length
      const curShapeCount = editor.getCurrentPageShapes().length

      // 페이지 전환 시: 이전 페이지 캐시 유지, 새 페이지 썸네일 생성
      if (curPageId !== prevPageId) {
        prevPageId = curPageId
        prevShapeCount = curShapeCount
        setCurrentPageId(curPageId)
        // 새 페이지 썸네일이 캐시에 없으면 생성
        if (!thumbCache.current.has(curPageId)) {
          refreshCurrentThumb()
        } else {
          syncPageList()
        }
        return
      }

      // 페이지 수 변경 (추가/삭제)
      if (curPageCount !== prevPageCount) {
        prevPageCount = curPageCount
        syncPageList()
        return
      }

      // shape 수 변경 (DXF import, 그리기 등) → debounce로 썸네일 갱신
      if (curShapeCount !== prevShapeCount) {
        prevShapeCount = curShapeCount
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          refreshCurrentThumb()
        }, 500)
      }
    })

    return () => {
      unsub()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [editor, refreshCurrentThumb, syncPageList])

  const switchPage = (pageId: string) => {
    if (!editor || pageId === currentPageId) return
    // 현재 페이지 썸네일 캐시 저장 후 전환
    generateThumb(editor).then(url => {
      thumbCache.current.set(currentPageId, url)
      editor.setCurrentPage(pageId as never)
    })
  }

  const addPage = () => {
    if (!editor) return
    const num = editor.getPages().length + 1
    const newPageId = PageRecordType.createId()
    // 현재 페이지 썸네일 먼저 캐시
    generateThumb(editor).then(url => {
      thumbCache.current.set(editor.getCurrentPageId(), url)
      editor.createPage({ name: `Drawing ${num}`, id: newPageId })
      editor.setCurrentPage(newPageId)
    })
  }

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>배치</span>
        <button
          className="ft-measure-btn"
          title="새 페이지"
          onClick={addPage}
          style={{ marginRight: 0 }}
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="lbar-panel-body layout-page-list">
        {pages.map(p => (
          <div
            key={p.id}
            className={`layout-page-card${p.id === currentPageId ? ' active' : ''}`}
            onClick={() => switchPage(p.id)}
          >
            <div className="layout-page-thumb">
              {p.dataUrl ? (
                <img src={p.dataUrl} alt={p.name} draggable={false} />
              ) : (
                <div className="layout-page-empty">빈 페이지</div>
              )}
            </div>
            <div className="layout-page-label">{p.index} - Page</div>
          </div>
        ))}
      </div>
    </div>
  )
}
