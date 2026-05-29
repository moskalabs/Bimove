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
  const [snapAngle, setSnapAngle] = useState(5)
  const [minLineLen, setMinLineLen] = useState(40)
  const [showAdvanced, setShowAdvanced] = useState(false)

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
      const { lines, width, height } = await detectWalls(src, {
        snapAngleDeg: snapAngle,
        minLineLenPx: minLineLen,
      })
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

        {/* 고급 옵션 */}
        <div style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 10 }}>
          <button
            onClick={() => setShowAdvanced(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#666', padding: 0 }}
          >{showAdvanced ? '▼' : '▶'} 인식 옵션</button>
          {showAdvanced && (
            <div style={{ marginTop: 8, fontSize: 11 }}>
              <div style={{ marginBottom: 8 }}>
                <label style={{ display: 'block', color: '#666', marginBottom: 2 }}>
                  직각 정렬 (±°): <strong>{snapAngle}°</strong>
                </label>
                <input
                  type="range" min={0} max={15} value={snapAngle}
                  onChange={e => setSnapAngle(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: 10, color: '#aaa' }}>0=비활성, 1~15=수평/수직 보정 강도</div>
              </div>
              <div>
                <label style={{ display: 'block', color: '#666', marginBottom: 2 }}>
                  최소 선 길이: <strong>{minLineLen}px</strong>
                </label>
                <input
                  type="range" min={0} max={200} step={10} value={minLineLen}
                  onChange={e => setMinLineLen(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ fontSize: 10, color: '#aaa' }}>짧은 노이즈 선 제거</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
