// CADCraft 엔진으로 도면을 그려 보는 화면.
//
// **기존 에디터는 건드리지 않는다.** tldraw 를 걷어내는 건 저장된 도면이 전부
// tldraw 스냅샷이라 데이터 이전이 먼저다. 그동안 이 화면으로 나란히 두고
// "정말 같은 걸 더 잘 그리는가" 를 눈으로 확인한다.
//
// 주소에 `#cadcraft` 를 붙이면 열린다. 그 밖에는 아무 데서도 안 불린다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { openDxf, openBimoveDoc, type CadDoc } from '../lib/cadcraft'
import { pickCadFile, dwgToDxfBytes } from '../lib/dxf'
import { checkCadSize } from '../lib/importLimits'
import { getProjects } from '../lib/projectStore'
import { loadDocument } from '../lib/bimoveDocStore'
import { docMetaOf } from '../lib/bimoveDoc'
import { threadsOnPageOf, type CommentThread } from '../lib/commentStore'
import { CadCommentPins } from './CadCommentPins'
import { zoomAt } from '../lib/cadCamera'

/** 캔버스 배경. 엔진이 이 색을 보고 묻히는 잉크를 끌어낸다. */
const BG = 0xFFFFFF

/**
 * 상태줄에 띄울 개수.
 *
 * 해치 수를 **일부러 늘 띄운다.** 0 이면 "해치가 없는 도면" 이라는 뜻인데,
 * 안 띄우면 "해치를 못 그린 것" 과 구분이 안 된다.
 *
 * 벽체는 **도형 수와 MLINE 수를 같이** 띄운다. 이어진 벽을 한 MLINE 으로
 * 묶어야 코너가 맞물리는데, 묶였는지는 두 숫자를 견줘야만 보인다 —
 * `벽 42→7` 이면 듣는 것이고 `벽 42→42` 면 하나도 못 묶었다는 뜻이다.
 */
const counts = (doc: CadDoc) =>
  `선 ${doc.lineCount().toLocaleString()}개 / 글자 ${doc.textCount().toLocaleString()}개` +
  ` / 해치 ${doc.hatchCount().toLocaleString()}개` +
  ` / 벽 ${doc.wallCount().toLocaleString()}→${doc.wallMlineCount().toLocaleString()}` +
  ` / 문창 ${doc.openingCount().toLocaleString()}개` +
  ` / 치수 ${doc.dimCount().toLocaleString()}개` +
  ` / 공간 ${doc.zoneCount().toLocaleString()}개` +
  ` / 물량표 ${doc.boqCount().toLocaleString()}개`

export function CadCraftViewer({ onClose }: { onClose: () => void }) {
  const cvRef = useRef<HTMLCanvasElement | null>(null)
  const docRef = useRef<CadDoc | null>(null)
  /** 화면 가운데 도면 좌표 + 도면 단위당 CSS 픽셀 */
  const camRef = useRef({ cx: 0, cy: 0, scale: 1 })
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  const [layouts, setLayouts] = useState<string[]>([])
  const [layout, setLayout] = useState('')
  const [status, setStatus] = useState('도면 파일을 열거나, 저장된 프로젝트를 골라주세요')
  /**
   * 프레임 시간/줌. **status 와 따로 둔다** — 한 칸에 같이 쓰면 팬 한 번에
   * "선 12만개 / 글자 3천개" 가 지워져서, 정작 보려던 숫자가 안 보인다.
   */
  const [perf, setPerf] = useState('')
  const [busy, setBusy] = useState(false)
  /**
   * 엔진이 **안 그린 것**. 반드시 눈에 보이게 둔다 — 안 띄우면 "해치가 없는
   * 도면" 과 "해치를 못 그린 도면" 이 구분되지 않는다.
   */
  const [notes, setNotes] = useState<string[]>([])
  /**
   * 이 기기에 저장된 프로젝트 목록 (저장본을 엔진으로 열어보는 용도).
   *
   * **로그인이 끝난 뒤에 다시 읽는다.** 이 화면은 `#cadcraft` 로 바로 들어오면
   * 인증 로딩보다 먼저 그려진다. 그때는 사용자 스코프가 아직 null 이라
   * `getProjects()` 가 **로그인 전 칸**을 보고 빈 목록을 준다. 한 번만 읽으면
   * 로그인이 끝나도 영영 비어 있다.
   */
  const { user } = useAuth()
  const [projects, setProjects] = useState<ReturnType<typeof getProjects>>([])
  useEffect(() => {
    try { setProjects(getProjects()) } catch { setProjects([]) }
  }, [user?.id])
  /** 저장본으로 열었을 때의 페이지들. DXF 로 열면 빈 배열이라 선택기가 안 뜬다. */
  const [pages, setPages] = useState<Array<{ id: string; name: string }>>([])
  const [pageId, setPageId] = useState('')
  /** 지금 보고 있는 저장본. 페이지를 갈아탈 때 다시 읽어야 해서 들고 있는다. */
  const [opened, setOpened] = useState<{ id: string; name: string } | null>(null)
  /**
   * 이 장에 달린 코멘트. 저장본에서 바로 읽는다 — **에디터가 없다.**
   * (commentStore 의 `threadsOnPageOf` 가 그래서 meta 를 받는다.)
   */
  const [threads, setThreads] = useState<CommentThread[]>([])
  /** 캔버스 크기 — 핀을 얹으려면 알아야 한다. */
  const [box, setBox] = useState({ w: 0, h: 0 })
  /**
   * 그려진 **그 순간의** 카메라.
   *
   * 조작 중에는 `camRef` 를 고쳐 쓴다 (팬 한 번에 state 를 수십 번 바꾸면
   * 느리다). 그런데 핀은 React 가 그리므로 값을 봐야 한다. 그래서 한 장
   * 그릴 때마다 **그때 쓴 값을 베껴** 둔다 — 핀은 늘 그림과 같은 카메라를
   * 본다. 렌더 중에 ref 를 들여다보면 안 되는 이유이기도 하다.
   */
  const [camView, setCamView] = useState({ cx: 0, cy: 0, scale: 1 })

  /**
   * 손을 뗀 뒤 **제대로** 한 번 더 그릴 타이머.
   *
   * 휠·드래그 중에는 draft 로 그린다 (그릴 거리를 다시 안 만든다). 그 상태로
   * 두면 글자 외곽선이 거칠 수 있으니, 멈추면 정식으로 한 장 더 찍는다.
   */
  const settleRef = useRef(0)

  /** 한 장 그린다. WASM 이 픽셀을 주고 우리는 붙이기만 한다. */
  const render = useCallback((draft = false) => {
    const cv = cvRef.current, doc = docRef.current
    if (!cv || !doc) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr)
    if (w === 0 || h === 0) return
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }

    const cam = camRef.current
    const t0 = performance.now()
    // scale 은 CSS 픽셀 기준이고 래스터는 장치 픽셀로 그려야 선명하다.
    const r = doc.renderPixels(layout, cam.cx, cam.cy, cam.scale * dpr, w, h, BG, draft)
    if (!r) {
      // 못 그렸으면 **직전 그림이 그대로 남는다.** 그게 "잔상" 으로 보이므로
      // 조용히 넘기지 않는다.
      console.warn('[cadcraft] 한 장을 못 그렸다 — 직전 그림이 남아 있다')
      setPerf('그리기 실패')
      return
    }
    const px = r.rgba()
    const ctx = cv.getContext('2d')
    // WASM 메모리를 그대로 들여다보는 뷰다 — 복사하지 않는다. r.free() 전에만
    // 유효하므로 여기서 바로 캔버스에 넘긴다.
    const clamped = new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length)
    ctx?.putImageData(new ImageData(clamped, r.width(), r.height()), 0, 0)
    r.free()
    setPerf(`${(performance.now() - t0).toFixed(0)}ms${draft ? ' (draft)' : ''} · 줌 ${cam.scale.toExponential(2)}`)
    // 핀이 따라오게 — 그린 뒤에 알린다. 크기도 여기서 같이 잰다 (리사이즈가
    // 따로 render 를 부르므로 한 자리에서 챙겨진다).
    setBox(b => (b.w === cv.clientWidth && b.h === cv.clientHeight
      ? b
      : { w: cv.clientWidth, h: cv.clientHeight }))
    setCamView(v => (v.cx === cam.cx && v.cy === cam.cy && v.scale === cam.scale
      ? v
      : { cx: cam.cx, cy: cam.cy, scale: cam.scale }))
  }, [layout])

  /**
   * 조작 중 한 장 — 빠른 쪽으로 그리고, 멈추면 정식으로 한 번 더.
   *
   * 큰 도면은 그릴 거리를 다시 만드는 데만 프레임당 100ms 가 넘는다. 그동안
   * JS 가 막혀 있어서 브라우저는 직전 그림을 계속 보여준다 — 한이 본
   * "줌할 때 텍스트 잔상" 이 그거다.
   */
  const renderLive = useCallback(() => {
    render(true)
    clearTimeout(settleRef.current)
    settleRef.current = window.setTimeout(() => render(false), 160)
  }, [render])

  useEffect(() => () => clearTimeout(settleRef.current), [])

  /** 도면 전체가 보이게 맞춘다. */
  const fit = useCallback((which: string) => {
    const cv = cvRef.current, doc = docRef.current
    if (!cv || !doc) return
    // 범위는 그릴 거리에서 얻는다. 거친 tolerance 로 한 번만 만들고 버린다 —
    // bbox 만 필요하지 곡선을 곱게 쪼갤 이유가 없다.
    const f = doc.buildFrame(which, 1)
    const [minX, minY, maxX, maxY] = Array.from(f.bounds())
    f.free()

    const w = cv.clientWidth, h = cv.clientHeight
    const bw = Math.max(maxX - minX, 1e-9), bh = Math.max(maxY - minY, 1e-9)
    const pad = 24
    const cam = camRef.current
    cam.scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)
    cam.cx = (minX + maxX) / 2
    cam.cy = (minY + maxY) / 2
    render()
  }, [render])

  /**
   * 새로 연 문서를 받아 화면에 앉힌다.
   *
   * **새 문서를 연 뒤에** 옛 것을 놓는다. 먼저 놓으면 여는 데 실패했을 때
   * docRef 에 이미 해제된 WASM 객체가 남고, 그 다음 휠·리사이즈가 그걸
   * 불러서 터진다.
   */
  const adopt = useCallback((doc: CadDoc): string[] => {
    docRef.current?.free()
    docRef.current = doc
    const names = doc.layoutNames()
    setLayouts(names)
    setLayout('')
    setNotes(doc.notes())
    const ids = doc.pageIds(), pnames = doc.pageNames()
    setPages(ids.map((id, i) => ({ id, name: pnames[i] ?? '' })))
    setPageId(doc.pageId())
    fit('')
    return names
  }, [fit])

  /**
   * 저장된 프로젝트를 엔진으로 연다.
   *
   * tldraw 를 걷어내는 길에서 "같은 도면을 더 잘 그리는가" 를 눈으로 보는
   * 자리다. 기존 에디터는 그대로 두고 여기서 나란히 비교한다.
   */
  const openProject = useCallback(async (projectId: string, name: string) => {
    setBusy(true)
    setStatus(`${name} 읽는 중…`)
    try {
      const r = await loadDocument(projectId)
      if (r.kind === 'fail') { setStatus(`못 읽었다: ${r.reason}`); return }
      const doc = await openBimoveDoc(r.doc)
      adopt(doc)
      // 첫 장을 연다 — 장이 안 적힌 옛 글타래가 가는 자리와 같아야 한다.
      const first = r.doc.pages[0]?.id ?? ''
      setThreads(threadsOnPageOf(docMetaOf(r.doc), first, first))
      setOpened({ id: projectId, name })
      setStatus(`${name} · ${counts(doc)} · 페이지 ${doc.pageIds().length}개`)
    } catch (e) {
      setStatus(`실패: ${e instanceof Error ? e.message : String(e)}`)
      console.error('[cadcraft]', e)
    } finally {
      setBusy(false)
    }
  }, [adopt])

  /** 같은 문서의 다른 페이지로 넘어간다 (모형/배치1/…). */
  const switchPage = useCallback(async (projectId: string, name: string, pageId: string) => {
    setBusy(true)
    try {
      const r = await loadDocument(projectId)
      if (r.kind === 'fail') { setStatus(`못 읽었다: ${r.reason}`); return }
      const doc = await openBimoveDoc(r.doc, pageId)
      adopt(doc)
      setThreads(threadsOnPageOf(docMetaOf(r.doc), pageId, r.doc.pages[0]?.id ?? ''))
      setStatus(`${name} · ${counts(doc)}`)
    } catch (e) {
      // 여기가 비어 있으면 실패가 **unhandled rejection** 으로만 남는다 —
      // 화면은 옛 페이지를 그대로 보여주고 아무 말도 안 한다.
      setStatus(`실패: ${e instanceof Error ? e.message : String(e)}`)
      console.error('[cadcraft]', e)
    } finally {
      setBusy(false)
    }
  }, [adopt])

  const openFile = useCallback(async () => {
    const file = await pickCadFile()
    if (!file) return
    const size = checkCadSize(file.name, file.size)
    if (size.kind === 'block') { setStatus(size.message); return }
    if (size.kind === 'confirm' && !confirm(size.message)) return

    setBusy(true)
    setStatus(`${file.name} 여는 중…`)
    try {
      const buf = await file.arrayBuffer()
      const bytes = file.name.toLowerCase().endsWith('.dwg')
        ? await dwgToDxfBytes(buf)
        : new Uint8Array(buf)
      // **새 문서를 연 뒤에** 옛 것을 놓는다. 먼저 놓으면 여는 데 실패했을 때
      // docRef 에 **이미 해제된** WASM 객체가 남고, 그 다음 휠·리사이즈가
      // 그걸 불러서 터진다.
      const doc = await openDxf(bytes)
      const names = adopt(doc)
      setOpened(null)
      // DXF 에는 코멘트가 없다. 안 비우면 **앞서 열었던 프로젝트의 핀**이
      // 생판 다른 도면 위에 그대로 꽂혀 있는다.
      setThreads([])
      setStatus(`${file.name} · 탭 ${1 + names.length}개`)
    } catch (e) {
      setStatus(`실패: ${e instanceof Error ? e.message : String(e)}`)
      console.error('[cadcraft]', e)
    } finally {
      setBusy(false)
    }
  }, [adopt])

  // 파일 선택 다이얼로그는 자동화할 수 없어서, 바이트를 직접 넣는 문을 둔다.
  // 손으로 확인할 때도 쓴다 — 콘솔에서 fetch 한 DXF 를 바로 띄울 수 있다.
  const loadBytes = useCallback(async (bytes: Uint8Array, label: string) => {
    setBusy(true)
    try {
      const doc = await openDxf(bytes)   // 성공한 뒤에 옛 것을 놓는다
      const names = adopt(doc)
      setStatus(`${label} · 탭 ${1 + names.length}개`)
      return { layouts: names }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`실패: ${msg}`)
      throw e
    } finally {
      setBusy(false)
    }
  }, [adopt])

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__cadcraftLoad = loadBytes
    return () => { delete (window as unknown as Record<string, unknown>).__cadcraftLoad }
  }, [loadBytes])

  useEffect(() => { render(false) }, [render, layout])
  useEffect(() => {
    const onResize = () => render(false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [render])
  // 화면을 떠날 때 WASM 쪽 메모리를 놓는다. 안 놓으면 도면 하나가 통째로 남는다.
  useEffect(() => () => { docRef.current?.free(); docRef.current = null }, [])

  const onWheel = (e: React.WheelEvent) => {
    const cv = cvRef.current
    if (!cv || !docRef.current) return
    const r = cv.getBoundingClientRect()
    // 커서 밑 도면 좌표가 제자리에 남아야 "그 점으로 들어간다" 는 느낌이 난다.
    // 식은 lib/cadCamera 로 옮겼다 — 핀도 같은 변환을 써야 해서, 두 군데에
    // 같은 계산이 있으면 확대할수록 벌어진다.
    zoomAt(
      camRef.current,
      { x: e.clientX - r.left, y: e.clientY - r.top },
      { w: r.width, h: r.height },
      Math.exp(-e.deltaY * 0.0015),
    )
    renderLive()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff', display: 'flex', flexDirection: 'column', zIndex: 20000 }}>
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid #ddd', display: 'flex',
        gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13,
      }}>
        <strong>CADCraft 엔진 (실험)</strong>
        <button onClick={openFile} disabled={busy}>도면 열기</button>
        {projects.length > 0 && (
          <label>저장된 도면{' '}
            <select
              defaultValue=""
              disabled={busy}
              onChange={e => {
                const p = projects.find(x => x.id === e.target.value)
                if (p) void openProject(p.id, p.name)
              }}
            >
              <option value="">— 고르기 —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {pages.length > 0 && (
          <label>페이지{' '}
            <select
              value={pageId}
              disabled={busy}
              onChange={e => { if (opened) void switchPage(opened.id, opened.name, e.target.value) }}
            >
              {pages.map((p, i) => <option key={p.id} value={p.id}>{p.name || `페이지 ${i + 1}`}</option>)}
            </select>
          </label>
        )}
        {layouts.length > 0 && (
          <label>공간{' '}
            <select value={layout} onChange={e => { setLayout(e.target.value); fit(e.target.value) }}>
              <option value="">모형공간</option>
              {layouts.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <span style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, color: '#555' }}>{status}</span>
        <span style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, color: '#999' }}>{perf}</span>
        <button onClick={onClose} style={{ marginLeft: 'auto' }}>닫기</button>
      </div>
      {/* 안 그린 것. **숨기지 않는다** — 안 띄우면 "해치가 없는 도면" 과
          "해치를 못 그린 도면" 이 구분되지 않는다. */}
      {notes.length > 0 && (
        <div style={{
          padding: '6px 12px', borderBottom: '1px solid #f0d8a0', background: '#fffbe9',
          fontSize: 12, color: '#7a5c00', display: 'flex', gap: 10, flexWrap: 'wrap',
        }}>
          <strong>아직 안 그리는 것:</strong>
          {notes.map((n, i) => <span key={i}>{n}</span>)}
        </div>
      )}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
      <canvas
        ref={cvRef}
        onWheel={onWheel}
        onPointerDown={e => {
          dragRef.current = { x: e.clientX, y: e.clientY, cx: camRef.current.cx, cy: camRef.current.cy }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={e => {
          const d = dragRef.current
          if (!d) return
          const cam = camRef.current
          cam.cx = d.cx - (e.clientX - d.x) / cam.scale
          cam.cy = d.cy + (e.clientY - d.y) / cam.scale
          renderLive()
        }}
        onPointerUp={e => { dragRef.current = null; e.currentTarget.releasePointerCapture(e.pointerId) }}
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'none' }}
      />
      {threads.length > 0 && box.w > 0 && (
        <CadCommentPins threads={threads} cam={camView} box={box} />
      )}
      </div>
    </div>
  )
}
