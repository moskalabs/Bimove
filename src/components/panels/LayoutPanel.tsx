import { useEffect, useState, useRef, useCallback } from 'react'
import { PageRecordType } from 'tldraw'
import { Plus } from 'lucide-react'
import { useEditor } from '../../context/EditorContext'

type PageThumb = {
  id: string
  name: string
  index: number
  svgHtml: string | null
}

/** SVG를 썸네일용으로 축소: width/height → 100%, viewBox 보장, foreignObject 제거 */
export function prepareSvgForThumb(svgStr: string): string {
  let svg = svgStr

  // width/height 추출
  const wM = svg.match(/width="([^"]+)"/)
  const hM = svg.match(/height="([^"]+)"/)
  const origW = wM ? parseFloat(wM[1]) : 0
  const origH = hM ? parseFloat(hM[1]) : 0
  if (!origW || !origH) return svg

  // viewBox 보장
  if (!svg.includes('viewBox')) {
    svg = svg.replace('<svg ', `<svg viewBox="0 0 ${origW} ${origH}" `)
  }

  // width/height를 100%로 변경 (컨테이너에 맞추기)
  svg = svg.replace(/width="[^"]*"/, 'width="100%"')
  svg = svg.replace(/height="[^"]*"/, 'height="100%"')

  // preserveAspectRatio 추가
  if (!svg.includes('preserveAspectRatio')) {
    svg = svg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ')
  }

  // foreignObject 제거 (렌더링 차단 원인)
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '')

  // 외부 리소스만 제거 (CSS 클래스는 유지해야 셰이프가 보임)
  svg = svg.replace(/@font-face\s*\{[^}]*\}/g, '')
  svg = svg.replace(/@import[^;]*;/g, '')

  return svg
}

async function generateThumb(editor: ReturnType<typeof useEditor>): Promise<string | null> {
  if (!editor) return null
  const shapes = editor.getCurrentPageShapes()
  if (shapes.length === 0 || shapes.length > 2000) return null
  try {
    const result = await editor.getSvgString(shapes, {
      padding: 16,
      background: true,
    })
    if (result?.svg) {
      return prepareSvgForThumb(result.svg)
    }
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
    const svgHtml = await generateThumb(editor)
    thumbCache.current.set(pageId, svgHtml)

    const allPages = editor.getPages()
    setPages(allPages.map((p, i) => ({
      id: p.id,
      name: p.name,
      index: i + 1,
      svgHtml: thumbCache.current.get(p.id) ?? null,
    })))
    setCurrentPageId(pageId)

    // 썸네일 생성 실패 시 재시도
    if (!svgHtml && editor.getCurrentPageShapes().length > 0) {
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
      svgHtml: thumbCache.current.get(p.id) ?? null,
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
    generateThumb(editor).then(svg => {
      thumbCache.current.set(currentPageId, svg)
      editor.setCurrentPage(pageId as never)
    })
  }

  const addPage = () => {
    if (!editor) return
    const num = editor.getPages().length + 1
    const newPageId = PageRecordType.createId()
    generateThumb(editor).then(svg => {
      thumbCache.current.set(editor.getCurrentPageId(), svg)
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
              {p.svgHtml ? (
                <div
                  dangerouslySetInnerHTML={{ __html: p.svgHtml }}
                  style={{
                    width: '100%',
                    height: '100%',
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                />
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
