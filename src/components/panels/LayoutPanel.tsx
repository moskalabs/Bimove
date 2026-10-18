import { useEffect, useState, useRef, useCallback } from 'react'
import { PageRecordType } from 'tldraw'
import type { TLPageId } from 'tldraw'
import { Plus } from 'lucide-react'
import { useEditor } from '../../context/EditorContext'

type PageThumb = {
  id: string
  name: string
  index: number
  svgHtml: string | null
  /**
   * 그림이 없을 때 **왜 없는지.**
   *
   * 전엔 무조건 "빈 페이지" 라고 썼다. 그런데 못 만든 이유가 넷이다 —
   * 정말 비었거나, 도형이 한도를 넘었거나, SVG 가 너무 커서 버렸거나,
   * 그리다 터졌거나. 넷을 같은 말로 덮으면 **내용이 있는 페이지가 빈 것처럼
   * 보인다** (한이 "배치 2번 그림 안 나옴" 으로 집어낸 게 이거다).
   */
  why: string | null
}

/** 썸네일 하나를 만든 결과. 실패해도 **이유를 들고 온다.** */
export type ThumbResult = { svg: string | null; why: string | null }

/**
 * 썸네일을 만들어 볼 도형 수 한도.
 *
 * 2000 이었다. 왜 2000 인지는 아무도 모르고, 넘으면 조용히 "빈 페이지" 가
 * 됐다. 진짜 비용은 **개수가 아니라 만들어진 SVG 의 크기**다 — dxfgroup 은
 * 하나가 수십 KB 짜리 path 를 들고 있고, 그게 그대로 DOM 에 들어간다.
 * 그래서 개수는 넉넉히 두고 **바이트로 막는다.**
 */
const THUMB_MAX_SHAPES = 20000

/** 만들어진 SVG 가 이보다 크면 버린다. DOM 에 넣으면 패널이 죽는다. */
const THUMB_MAX_BYTES = 2_000_000

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

/**
 * 지정한 페이지의 썸네일을 뽑는다.
 *
 * tldraw 는 shape id 만 있으면 현재 페이지가 아니어도 SVG 를 그려준다
 * (getSvgJsx 는 current page 를 보지 않는다). 예전엔 getCurrentPageShapes() 로
 * 현재 페이지만 그려서, 임포트가 만든 레이아웃이 한 번 열어보기 전까지
 * 배치 패널에 "빈 페이지" 로 남아 있었다.
 */
export async function generateThumbForPage(
  editor: ReturnType<typeof useEditor>,
  pageId: TLPageId,
): Promise<ThumbResult> {
  if (!editor) return { svg: null, why: null }
  const ids = [...editor.getPageShapeIds(pageId)]
  if (ids.length === 0) return { svg: null, why: null }   // 진짜 빈 페이지
  if (ids.length > THUMB_MAX_SHAPES) {
    return { svg: null, why: `도형 ${ids.length.toLocaleString()}개 · 미리보기 생략` }
  }
  try {
    const result = await editor.getSvgString(ids, {
      padding: 16,
      background: true,
    })
    if (!result?.svg) {
      return { svg: null, why: `미리보기 실패 · 도형 ${ids.length.toLocaleString()}개` }
    }
    if (result.svg.length > THUMB_MAX_BYTES) {
      // 만들긴 했는데 DOM 에 넣을 수가 없다. 넣으면 패널이 멈춘다.
      return {
        svg: null,
        why: `미리보기가 ${Math.round(result.svg.length / 1048576)}MB · 생략`,
      }
    }
    return { svg: prepareSvgForThumb(result.svg), why: null }
  } catch (e) {
    console.warn('[thumb] fail:', e)
    return {
      svg: null,
      why: `미리보기 실패 · ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

async function generateThumb(editor: ReturnType<typeof useEditor>): Promise<ThumbResult> {
  if (!editor) return { svg: null, why: null }
  return generateThumbForPage(editor, editor.getCurrentPageId())
}

export function LayoutPanel() {
  const editor = useEditor()
  const [pages, setPages] = useState<PageThumb[]>([])
  const [currentPageId, setCurrentPageId] = useState('')
  /** 페이지별 썸네일. 못 만들었으면 **이유**가 같이 들어 있다. */
  const thumbCache = useRef<Map<string, ThumbResult>>(new Map())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 재시도는 자기 자신을 다시 부른다. useCallback 안에서 refreshCurrentThumb 를
  // 직접 참조하면 선언되기 전의 바인딩을 읽는 셈이라, ref 를 한 번 거친다.
  const refreshRef = useRef<() => void>(() => {})

  // 이미 카메라를 맞춰본 페이지. 두 번째부터는 한이 보던 위치를 그대로 둔다.
  const focusedPages = useRef<Set<string>>(new Set())

  /** 페이지 내용에 카메라를 맞춘다 (그 페이지를 처음 열 때만).
   *
   *  임포트는 페이지마다 zoomToFit 을 setTimeout(300ms) 으로 걸어두는데,
   *  멀티 레이아웃이면 그 사이에 다음 페이지로 넘어가 버려서 "현재 페이지가
   *  그대로인가" 검사에 걸려 건너뛴다. 결국 마지막 페이지만 맞춰지고 나머지는
   *  기본 카메라(원점) 에 남아, 열면 빈 화면처럼 보인다. */
  const focusPage = useCallback((pageId: string) => {
    if (!editor || focusedPages.current.has(pageId)) return
    focusedPages.current.add(pageId)
    requestAnimationFrame(() => {
      try { editor.zoomToFit({ animation: { duration: 0 } }) }
      catch { /* 뷰포트가 아직 없으면 그냥 넘어간다 */ }
    })
  }, [editor])

  /* ── 아직 썸네일이 없는 페이지들을 채운다 ── */
  const fillMissingThumbs = useCallback(async () => {
    if (!editor) return
    let changed = false
    for (const page of editor.getPages()) {
      // 그림이 있으면 넘어간다. **이유만 있는 것도 넘어간다** — 못 만드는
      // 이유(도형 수·크기)는 다음에 불러도 그대로라, 다시 시도해봐야 같은
      // 비용만 또 든다.
      const had = thumbCache.current.get(page.id)
      if (had?.svg || had?.why) continue
      const r = await generateThumbForPage(editor, page.id)
      if (!r.svg && !r.why) continue
      thumbCache.current.set(page.id, r)
      changed = true
    }
    if (!changed) return
    setPages(editor.getPages().map((p, i) => ({
      id: p.id,
      name: p.name,
      index: i + 1,
      svgHtml: thumbCache.current.get(p.id)?.svg ?? null,
      why: thumbCache.current.get(p.id)?.why ?? null,
    })))
  }, [editor])

  /* ── 현재 페이지 썸네일만 갱신 ── */
  const refreshCurrentThumb = useCallback(async () => {
    if (!editor) return
    const pageId = editor.getCurrentPageId()
    const result = await generateThumb(editor)

    // generateThumb 는 await 를 탄다. 그 사이에 현재 페이지가 바뀌었으면 지금
    // 만든 그림은 pageId 의 것이 아니다 — 남의 그림을 그 페이지 칸에 넣는 꼴이다.
    // 멀티 레이아웃 임포트가 페이지를 연달아 만들 때 실제로 어긋나서, 배치
    // 썸네일이 엉뚱하거나 거의 빈 그림으로 남았다.
    if (editor.getCurrentPageId() !== pageId) return

    thumbCache.current.set(pageId, result)

    const allPages = editor.getPages()
    setPages(allPages.map((p, i) => ({
      id: p.id,
      name: p.name,
      index: i + 1,
      svgHtml: thumbCache.current.get(p.id)?.svg ?? null,
      why: thumbCache.current.get(p.id)?.why ?? null,
    })))
    setCurrentPageId(pageId)

    // 썸네일 생성 실패 시 재시도.
    //
    // **이유가 붙은 실패는 다시 안 한다.** 도형이 한도를 넘었거나 SVG 가 너무
    // 큰 건 2초 뒤에도 그대로다 — 2초마다 수 MB 를 만들었다 버리게 된다.
    if (!result.svg && !result.why && editor.getCurrentPageShapes().length > 0) {
      if (retryRef.current) clearTimeout(retryRef.current)
      retryRef.current = setTimeout(() => refreshRef.current(), 2000)
    }

    void fillMissingThumbs()
  }, [editor, fillMissingThumbs])

  useEffect(() => { refreshRef.current = refreshCurrentThumb }, [refreshCurrentThumb])

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
      svgHtml: thumbCache.current.get(p.id)?.svg ?? null,
      why: thumbCache.current.get(p.id)?.why ?? null,
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
        focusPage(curPageId)
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
        void fillMissingThumbs()
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
  }, [editor, refreshCurrentThumb, syncPageList, focusPage, fillMissingThumbs])

  const switchPage = (pageId: string) => {
    if (!editor || pageId === currentPageId) return
    generateThumb(editor).then(r => {
      thumbCache.current.set(currentPageId, r)
      editor.setCurrentPage(pageId as never)
      focusPage(pageId)
    })
  }

  const addPage = () => {
    if (!editor) return
    const num = editor.getPages().length + 1
    const newPageId = PageRecordType.createId()
    generateThumb(editor).then(r => {
      thumbCache.current.set(editor.getCurrentPageId(), r)
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
                // **"빈 페이지" 는 정말 빈 페이지일 때만.** 못 만든 거면
                // 그렇다고 쓴다 — 안 그러면 내용이 있는 페이지가 빈 것처럼
                // 보이고, 쓰는 사람은 도면이 날아간 줄 안다.
                <div className="layout-page-empty">{p.why ?? '빈 페이지'}</div>
              )}
            </div>
            <div className="layout-page-label">{p.index} - {p.name}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
