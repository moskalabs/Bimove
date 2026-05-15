import { useEffect, useState } from 'react'
import { useEditor } from '../../context/EditorContext'

export function TracePanel() {
  const editor = useEditor()
  const [images, setImages] = useState<{ id: string; opacity: number }[]>([])

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const imgs = editor.getCurrentPageShapes()
        .filter(s => s.type === 'image')
        .map(s => ({ id: s.id, opacity: s.opacity ?? 1 }))
      setImages(imgs)
    }
    update()
    return editor.store.listen(update)
  }, [editor])

  const setOpacity = (id: string, v: number) => {
    editor?.updateShape({ id, opacity: v } as never)
  }

  const lockImage = (id: string, locked: boolean) => {
    editor?.updateShape({ id, isLocked: locked } as never)
  }

  const deleteImage = (id: string) => {
    editor?.deleteShape(id as never)
  }

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">트레이스</div>
      <div className="lbar-panel-body">
        <div style={{ fontSize: 11, color: '#888', marginBottom: 12, lineHeight: 1.6 }}>
          도면 이미지를 배경으로 깔고 그 위에 벽을 그릴 수 있어요.<br />
          불투명도를 낮추면 더 편하게 작업할 수 있어요.
        </div>

        {images.length === 0 ? (
          <div style={{ color: '#bbb', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
            캔버스에 이미지가 없어요
          </div>
        ) : (
          images.map((img, i) => (
            <div key={img.id} style={{ marginBottom: 12, background: '#f8f8f8', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 6 }}>
                이미지 {i + 1}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#888', width: 36 }}>
                  {Math.round(img.opacity * 100)}%
                </span>
                <input
                  type="range" min={5} max={100} value={Math.round(img.opacity * 100)}
                  onChange={e => setOpacity(img.id, Number(e.target.value) / 100)}
                  style={{ flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="export-btn" style={{ flex: 1, fontSize: 10 }}
                  onClick={() => lockImage(img.id, true)}>🔒 잠금</button>
                <button className="export-btn" style={{ flex: 1, fontSize: 10, color: '#ef4444', borderColor: '#fecaca' }}
                  onClick={() => deleteImage(img.id)}>삭제</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
