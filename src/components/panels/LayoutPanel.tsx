import { useEffect, useState, useCallback } from 'react'
import { PageRecordType } from 'tldraw'
import { Plus } from 'lucide-react'
import { useEditor } from '../../context/EditorContext'

type PageThumb = {
  id: string
  name: string
  index: number
  dataUrl: string | null
}

export function LayoutPanel() {
  const editor = useEditor()
  const [pages, setPages] = useState<PageThumb[]>([])
  const [currentPageId, setCurrentPageId] = useState('')

  /* ── 페이지 목록 + 썸네일 생성 ── */
  const syncPages = useCallback(async () => {
    if (!editor) return
    const allPages = editor.getPages()
    setCurrentPageId(editor.getCurrentPageId())

    const thumbs: PageThumb[] = []
    const savedPageId = editor.getCurrentPageId()

    for (let i = 0; i < allPages.length; i++) {
      const p = allPages[i]
      let dataUrl: string | null = null

      try {
        // 해당 페이지로 잠시 전환해서 shapes 가져오기
        editor.setCurrentPage(p.id)
        const shapes = editor.getCurrentPageShapes()

        if (shapes.length > 0 && shapes.length <= 300) {
          const result = await (editor as unknown as {
            getSvgString: (shapes: unknown[], opts: unknown) => Promise<{ svg: string; width: number; height: number } | undefined>
          }).getSvgString(shapes, { padding: 16, background: true })

          if (result?.svg) {
            dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(result.svg)))
          }
        }
      } catch {
        // 썸네일 생성 실패 시 무시
      }

      thumbs.push({ id: p.id, name: p.name, index: i + 1, dataUrl })
    }

    // 원래 페이지로 복귀
    editor.setCurrentPage(savedPageId as never)
    setPages(thumbs)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    syncPages()

    let prevPageId = editor.getCurrentPageId()
    let prevPageCount = editor.getPages().length
    const unsub = editor.store.listen(() => {
      const curId = editor.getCurrentPageId()
      const curCount = editor.getPages().length
      if (curId !== prevPageId || curCount !== prevPageCount) {
        prevPageId = curId
        prevPageCount = curCount
        setCurrentPageId(curId)
        // 페이지 수 변경 시 썸네일 재생성
        if (curCount !== pages.length) {
          syncPages()
        }
      }
    })
    return unsub
  }, [editor, syncPages, pages.length])

  const switchPage = (pageId: string) => {
    if (!editor) return
    editor.setCurrentPage(pageId as never)
    setCurrentPageId(pageId)
  }

  const addPage = () => {
    if (!editor) return
    const num = editor.getPages().length + 1
    const newPageId = PageRecordType.createId()
    editor.createPage({ name: `Drawing ${num}`, id: newPageId })
    editor.setCurrentPage(newPageId)
    syncPages()
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
