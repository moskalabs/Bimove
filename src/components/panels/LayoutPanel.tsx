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

/** SVG dimensions를 축소해서 브라우저가 렌더 가능한 data URL 반환 */
function shrinkSvg(svgStr: string, maxW = 400): string {
  let svg = svgStr
  const wM = svg.match(/width="([^"]+)"/)
  const hM = svg.match(/height="([^"]+)"/)
  const origW = wM ? parseFloat(wM[1]) : 0
  const origH = hM ? parseFloat(hM[1]) : 0
  if (!origW || !origH) return svg

  // viewBox 보장
  if (!svg.includes('viewBox')) {
    svg = svg.replace('<svg ', `<svg viewBox="0 0 ${origW} ${origH}" `)
  }
  // 작은 dimensions으로 교체
  const aspect = origH / origW
  svg = svg.replace(/width="[^"]*"/, `width="${maxW}"`)
  svg = svg.replace(/height="[^"]*"/, `height="${Math.round(maxW * aspect)}"`)
  // foreignObject 제거 (img 태그 렌더링 차단 원인)
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '')
  return svg
}

async function generateThumb(editor: ReturnType<typeof useEditor>): Promise<string | null> {
  if (!editor) return null
  const shapes = editor.getCurrentPageShapes()
  console.log('[thumb] shapes:', shapes.length)
  if (shapes.length === 0 || shapes.length > 2000) return null
  try {
    const result = await editor.getSvgString(shapes, {
      padding: 16,
      background: true,
    })
    if (result?.svg) {
      console.log('[thumb] svg ok:', result.width.toFixed(0), 'x', result.height.toFixed(0))
      const svg = shrinkSvg(result.svg)
      return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
    }
    console.log('[thumb] svg null')
  } catch (e) {
    console.warn('[thumb] fail:', e)
  }
  return null
}

export function LayoutPanel() {
  const editor = useEditor()
  const [pages, setPages] = useState<PageThumb[]>([])
  const [currentPageId, setCurrentPageId] = useState('')
  const thumbCache = useRef<Map<string, string | null>>(new Map())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ── 현재 페이지 썸네일만 갱신 ── */
  const refreshCurrentThumb = useCallback(async () => {
    if (!editor) return
    const pageId = editor.getCurrentPageId()
    const dataUrl = await generateThumb(editor)
    thumbCache.current.set(pageId, dataUrl)

    const allPages = editor.getPages()
    setPages(allPages.map((p, i) => ({
      id: p.id,
      name: p.name,
      index: i + 1,
      dataUrl: thumbCache.current.get(p.id) ?? null,
    })))
    setCurrentPageId(pageId)

    // 썸네일 생성 실패 시 재시도 (shapes가 아직 렌더링 안 됐을 수 있음)
    if (!dataUrl && editor.getCurrentPageShapes().length > 0) {
      if (retryRef.current) clearTimeout(retryRef.current)
      retryRef.current = setTimeout(() => refreshCurrentThumb(), 2000)
    }
  }, [editor])

  /* ── 전체 페이지 목록 동기화 ── */
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

    // 초기 로드: shapes가 렌더링될 시간을 주고 시작
    const initTimer = setTimeout(() => refreshCurrentThumb(), 500)

    let prevPageId = editor.getCurrentPageId()
    let prevPageCount = editor.getPages().length
    let prevShapeCount = editor.getCurrentPageShapes().length

    const unsub = editor.store.listen(() => {
      const curPageId = editor.getCurrentPageId()
      const curPageCount = editor.getPages().length
      const curShapeCount = editor.getCurrentPageShapes().length

      if (curPageId !== prevPageId) {
        prevPageId = curPageId
        prevShapeCount = curShapeCount
        setCurrentPageId(curPageId)
        if (!thumbCache.current.has(curPageId)) {
          refreshCurrentThumb()
        } else {
          syncPageList()
        }
        return
      }

      if (curPageCount !== prevPageCount) {
        prevPageCount = curPageCount
        syncPageList()
        return
      }

      if (curShapeCount !== prevShapeCount) {
        prevShapeCount = curShapeCount
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => refreshCurrentThumb(), 800)
      }
    })

    return () => {
      unsub()
      clearTimeout(initTimer)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (retryRef.current) clearTimeout(retryRef.current)
    }
  }, [editor, refreshCurrentThumb, syncPageList])

  const switchPage = (pageId: string) => {
    if (!editor || pageId === currentPageId) return
    generateThumb(editor).then(url => {
      thumbCache.current.set(currentPageId, url)
      editor.setCurrentPage(pageId as never)
    })
  }

  const addPage = () => {
    if (!editor) return
    const num = editor.getPages().length + 1
    const newPageId = PageRecordType.createId()
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
