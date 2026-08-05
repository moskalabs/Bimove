// 캔버스 pick 모드 오버레이 - 벽/문/창문 클릭 선택
import { useState, useEffect, useRef } from 'react'
import { useEditor } from '../context/EditorContext'
import { drawingState, exitPickMode, type PickResult } from '../lib/drawingState'
import { getScaleConfig } from '../lib/scaleConfig'
import { getWallHeightMm } from '../lib/settings'

export function CanvasPickOverlay() {
  const editor = useEditor()
  const [active, setActive] = useState(false)
  const [target, setTarget] = useState<'wall' | 'door-window' | null>(null)
  const prevSelRef = useRef<string[]>([])

  // pick-mode 이벤트 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setActive(detail.active)
      setTarget(detail.active ? detail.target : null)
    }
    window.addEventListener('bimove:pick-mode', handler)
    return () => window.removeEventListener('bimove:pick-mode', handler)
  }, [])

  // 컴포넌트 언마운트 시 pick 모드 정리 (BUG 2)
  useEffect(() => {
    return () => { if (drawingState.pickTarget) exitPickMode() }
  }, [])

  // ESC로 취소
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        exitPickMode()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active])

  // selection 변화 감지 → pick 처리
  useEffect(() => {
    if (!active || !editor) return

    // select 도구로 전환, 기존 선택 해제
    editor.setCurrentTool('select')
    editor.selectNone()
    prevSelRef.current = []

    const unsub = editor.store.listen(() => {
      const selected = editor.getSelectedShapeIds()
      if (selected.length === 0) return

      // 새로 추가된 shape만 확인
      const prevSet = new Set(prevSelRef.current)
      const newIds = selected.filter(id => !prevSet.has(id))
      prevSelRef.current = [...selected]
      if (newIds.length === 0) return

      const shape = editor.getShape(newIds[0])
      if (!shape) return

      const scale = getScaleConfig(editor)
      const wallHeight = getWallHeightMm()
      // callback 캡처 후 exitPickMode (BUG 1 방어)
      const callback = drawingState.pickCallback

      if (target === 'wall' && shape.type === 'wall') {
        const p = shape.props as { x2: number; y2: number }
        const lengthMm = Math.hypot(p.x2, p.y2) / scale.pxPerMm
        const result: PickResult = {
          type: 'wall',
          shapeId: shape.id,
          label: '벽',
          lengthMm: Math.round(lengthMm),
        }
        exitPickMode()
        editor.selectNone() // 선택 해제 (BUG 14)
        callback?.(result)
      } else if (target === 'door-window' && (shape.type === 'door' || shape.type === 'window')) {
        const p = shape.props as { width: number }
        const wMm = Math.round(p.width / scale.pxPerMm)
        const result: PickResult = {
          type: shape.type as 'door' | 'window',
          shapeId: shape.id,
          label: shape.type === 'door' ? '문' : '창문',
          widthMm: wMm,
          heightMm: shape.type === 'door' ? wallHeight : 1200,
        }
        exitPickMode()
        editor.selectNone() // 선택 해제 (BUG 14)
        callback?.(result)
      }
    })

    return () => unsub()
  }, [active, editor, target])

  if (!active) return null

  const message = target === 'wall'
    ? '📌 도면에서 벽을 클릭하세요'
    : '📌 도면에서 문 또는 창문을 클릭하세요'

  return (
    <div className="canvas-pick-banner">
      <span className="canvas-pick-message">{message}</span>
      <span className="canvas-pick-hint">ESC로 취소</span>
      <button className="canvas-pick-cancel" onClick={() => exitPickMode()}>취소</button>
    </div>
  )
}
