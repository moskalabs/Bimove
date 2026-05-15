import { useState } from 'react'
import { useEditor } from '../../context/EditorContext'
import { detectWalls } from '../../lib/detectWalls'
import { getDefaultWallThicknessMm } from '../../lib/settings'
import { getScaleConfig } from '../../lib/scaleConfig'
import { createShapeId, type TLShapeId } from 'tldraw'

export function AIPanel() {
  const editor = useEditor()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const imageShapes = editor?.getCurrentPageShapes().filter(s => s.type === 'image') ?? []

  const runDetect = async (shapeId: TLShapeId) => {
    if (!editor || busy) return
    const shape = editor.getShape(shapeId)
    if (!shape) return
    const assetId = (shape.props as { assetId?: string }).assetId
    const asset = editor.getAsset(assetId as never) as { props?: { src?: string } } | undefined
    const src = asset?.props?.src
    if (!src) { setMsg('이미지 소스를 읽을 수 없습니다.'); return }

    const { x: ox, y: oy } = shape
    const { w: sw, h: sh } = shape.props as { w: number; h: number }

    setBusy(true)
    setMsg('OpenCV 분석 중… (처음엔 다소 걸려요)')
    try {
      const { lines, width, height } = await detectWalls(src)
      if (lines.length === 0) { setMsg('선분을 찾지 못했습니다. 더 선명한 도면을 써보세요.'); return }
      const kx = sw / width, ky = sh / height
      const thickness = getDefaultWallThicknessMm() * getScaleConfig(editor).pxPerMm
      const shapes = lines.map(ln => ({
        id: createShapeId(), type: 'wall' as const,
        x: ox + ln.x1 * kx, y: oy + ln.y1 * ky,
        props: { x2: (ln.x2 - ln.x1) * kx, y2: (ln.y2 - ln.y1) * ky, thickness },
      }))
      editor.createShapes(shapes as never)
      editor.setSelectedShapes(shapes.map(s => s.id))
      setMsg(`✅ ${shapes.length}개의 벽을 생성했습니다.`)
    } catch (e) {
      setMsg('오류: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">AI 벽 인식</div>
      <div className="lbar-panel-body">
        <div style={{ fontSize: 11, color: '#888', marginBottom: 12, lineHeight: 1.6 }}>
          도면 이미지에서 벽 선을 자동으로 추출합니다.<br />
          이미지를 먼저 캔버스에 업로드하세요.
        </div>

        {imageShapes.length === 0 ? (
          <div style={{ color: '#bbb', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
            캔버스에 이미지가 없어요<br />
            <span style={{ fontSize: 11 }}>왼쪽 📎 버튼으로 이미지 추가</span>
          </div>
        ) : (
          imageShapes.map((s, i) => (
            <button
              key={s.id}
              className="export-btn"
              disabled={busy}
              style={{ width: '100%', marginBottom: 6 }}
              onClick={() => runDetect(s.id as TLShapeId)}
            >
              {busy ? '분석 중…' : `✦ 이미지 ${i + 1} 벽 인식`}
            </button>
          ))
        )}

        {msg && (
          <div style={{ fontSize: 11, color: busy ? '#1a73e8' : '#555', marginTop: 8, lineHeight: 1.5 }}>
            {msg}
          </div>
        )}
      </div>
    </div>
  )
}
