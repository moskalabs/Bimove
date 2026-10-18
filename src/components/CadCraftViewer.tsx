// CADCraft 엔진으로 도면을 그려 보는 화면.
//
// **기존 에디터는 건드리지 않는다.** tldraw 를 걷어내는 건 저장된 도면이 전부
// tldraw 스냅샷이라 데이터 이전이 먼저다. 그동안 이 화면으로 나란히 두고
// "정말 같은 걸 더 잘 그리는가" 를 눈으로 확인한다.
//
// 주소에 `#cadcraft` 를 붙이면 열린다. 그 밖에는 아무 데서도 안 불린다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { openDxf, type CadDoc } from '../lib/cadcraft'
import { pickCadFile, dwgToDxfBytes } from '../lib/dxf'
import { checkCadSize } from '../lib/importLimits'

/** 캔버스 배경. 엔진이 이 색을 보고 묻히는 잉크를 끌어낸다. */
const BG = 0xFFFFFF

export function CadCraftViewer({ onClose }: { onClose: () => void }) {
  const cvRef = useRef<HTMLCanvasElement | null>(null)
  const docRef = useRef<CadDoc | null>(null)
  /** 화면 가운데 도면 좌표 + 도면 단위당 CSS 픽셀 */
  const camRef = useRef({ cx: 0, cy: 0, scale: 1 })
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  const [layouts, setLayouts] = useState<string[]>([])
  const [layout, setLayout] = useState('')
  const [status, setStatus] = useState('도면 파일을 열어주세요')
  const [busy, setBusy] = useState(false)

  /** 한 장 그린다. WASM 이 픽셀을 주고 우리는 붙이기만 한다. */
  const render = useCallback(() => {
    const cv = cvRef.current, doc = docRef.current
    if (!cv || !doc) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr)
    if (w === 0 || h === 0) return
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }

    const cam = camRef.current
    const t0 = performance.now()
    // scale 은 CSS 픽셀 기준이고 래스터는 장치 픽셀로 그려야 선명하다.
    const r = doc.renderPixels(layout, cam.cx, cam.cy, cam.scale * dpr, w, h, BG)
    if (!r) return
    const px = r.rgba()
    const ctx = cv.getContext('2d')
    // WASM 메모리를 그대로 들여다보는 뷰다 — 복사하지 않는다. r.free() 전에만
    // 유효하므로 여기서 바로 캔버스에 넘긴다.
    const clamped = new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length)
    ctx?.putImageData(new ImageData(clamped, r.width(), r.height()), 0, 0)
    r.free()
    setStatus(`${(performance.now() - t0).toFixed(0)}ms · 줌 ${cam.scale.toExponential(2)}`)
  }, [layout])

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
      docRef.current?.free()
      docRef.current = doc
      const names = doc.layoutNames()
      setLayouts(names)
      setLayout('')
      fit('')
      setStatus(`${file.name} · 탭 ${1 + names.length}개`)
    } catch (e) {
      setStatus(`실패: ${e instanceof Error ? e.message : String(e)}`)
      console.error('[cadcraft]', e)
    } finally {
      setBusy(false)
    }
  }, [fit])

  // 파일 선택 다이얼로그는 자동화할 수 없어서, 바이트를 직접 넣는 문을 둔다.
  // 손으로 확인할 때도 쓴다 — 콘솔에서 fetch 한 DXF 를 바로 띄울 수 있다.
  const loadBytes = useCallback(async (bytes: Uint8Array, label: string) => {
    setBusy(true)
    try {
      const doc = await openDxf(bytes)   // 성공한 뒤에 옛 것을 놓는다
      docRef.current?.free()
      docRef.current = doc
      const names = doc.layoutNames()
      setLayouts(names)
      setLayout('')
      fit('')
      setStatus(`${label} · 탭 ${1 + names.length}개`)
      return { layouts: names }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`실패: ${msg}`)
      throw e
    } finally {
      setBusy(false)
    }
  }, [fit])

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__cadcraftLoad = loadBytes
    return () => { delete (window as unknown as Record<string, unknown>).__cadcraftLoad }
  }, [loadBytes])

  useEffect(() => { render() }, [render, layout])
  useEffect(() => {
    const onResize = () => render()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [render])
  // 화면을 떠날 때 WASM 쪽 메모리를 놓는다. 안 놓으면 도면 하나가 통째로 남는다.
  useEffect(() => () => { docRef.current?.free(); docRef.current = null }, [])

  const onWheel = (e: React.WheelEvent) => {
    const cv = cvRef.current
    if (!cv || !docRef.current) return
    const r = cv.getBoundingClientRect()
    const cam = camRef.current
    // 커서 밑 도면 좌표가 제자리에 남아야 "그 점으로 들어간다" 는 느낌이 난다
    const dx = (e.clientX - r.left) - r.width / 2
    const dy = (e.clientY - r.top) - r.height / 2
    const wx = cam.cx + dx / cam.scale, wy = cam.cy - dy / cam.scale
    cam.scale *= Math.exp(-e.deltaY * 0.0015)
    cam.cx = wx - dx / cam.scale
    cam.cy = wy + dy / cam.scale
    render()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff', display: 'flex', flexDirection: 'column', zIndex: 20000 }}>
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid #ddd', display: 'flex',
        gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13,
      }}>
        <strong>CADCraft 엔진 (실험)</strong>
        <button onClick={openFile} disabled={busy}>도면 열기</button>
        {layouts.length > 0 && (
          <label>공간{' '}
            <select value={layout} onChange={e => { setLayout(e.target.value); fit(e.target.value) }}>
              <option value="">모형공간</option>
              {layouts.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <span style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, color: '#555' }}>{status}</span>
        <button onClick={onClose} style={{ marginLeft: 'auto' }}>닫기</button>
      </div>
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
          render()
        }}
        onPointerUp={e => { dragRef.current = null; e.currentTarget.releasePointerCapture(e.pointerId) }}
        style={{ flex: 1, display: 'block', cursor: 'grab', touchAction: 'none' }}
      />
    </div>
  )
}
