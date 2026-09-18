// 공간지정 후 이름/층고 입력 팝업
import { useState, useEffect, useRef } from 'react'
import { type TLShapeId } from 'tldraw'
import { useEditor } from '../context/EditorContext'

export function ZoneNamePopup() {
  const editor = useEditor()
  const [shapeId, setShapeId] = useState<TLShapeId | null>(null)
  const [label, setLabel] = useState('')
  const [heightM, setHeightM] = useState('2.4')
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const id = detail.shapeId as TLShapeId
      setShapeId(id)
      setLabel('')
      setHeightM('2.4')

      // 위치: shape centroid → viewport 좌표
      if (editor) {
        const shape = editor.getShape(id)
        if (shape) {
          const props = shape.props as { points: { x: number; y: number }[] }
          const pts = props.points || []
          if (pts.length > 0) {
            const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length + shape.x
            const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length + shape.y
            const vp = editor.pageToViewport({ x: cx, y: cy })
            setPos({ x: vp.x, y: vp.y })
          }
        }
      }

      setTimeout(() => inputRef.current?.focus(), 50)
    }
    window.addEventListener('bimova:zone-name', handler)
    return () => window.removeEventListener('bimova:zone-name', handler)
  }, [editor])

  const submit = () => {
    if (!editor || !shapeId) return
    editor.updateShape({
      id: shapeId,
      type: 'zone',
      props: {
        label: label.trim() || '미지정',
        wallHeightMm: Math.round((parseFloat(heightM) || 2.4) * 1000),
      },
    })
    setShapeId(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      submit() // 기본값으로 저장
    }
  }

  if (!shapeId) return null

  return (
    <div
      className="zone-name-popup"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={handleKeyDown}
    >
      <div className="zone-name-title">공간 정보</div>
      <label className="zone-name-field">
        <span>이름</span>
        <input
          ref={inputRef}
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="거실, 안방, 주방..."
        />
      </label>
      <label className="zone-name-field">
        <span>층고 (m)</span>
        <input
          type="number"
          step="0.1"
          value={heightM}
          onChange={e => setHeightM(e.target.value)}
        />
      </label>
      <button className="zone-name-submit" onClick={submit}>확인</button>
    </div>
  )
}
