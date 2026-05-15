import { useEditor } from '../../context/EditorContext'
import { uploadImage } from '../../lib/project'
import { importDxf } from '../../lib/dxf'

export function ImportPanel() {
  const editor = useEditor()

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">가져오기</div>
      <div className="lbar-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* DXF */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>DXF 도면</div>
          <button
            className="export-btn"
            style={{ width: '100%', marginBottom: 8 }}
            onClick={() => editor && importDxf(editor)}
          >
            📐 DXF 불러오기
          </button>
          <div style={{ fontSize: 11, color: '#888', lineHeight: 1.7, background: '#f8f8f8', borderRadius: 6, padding: '8px 10px' }}>
            <strong style={{ color: '#555' }}>SketchUp 사용자:</strong><br />
            File → Export → 2D Graphic →<br />
            파일 형식을 <strong style={{ color: '#3b82f6' }}>AutoCAD DXF (.dxf)</strong> 로<br />
            저장 후 불러오세요.
          </div>
        </div>

        <div style={{ borderTop: '1px solid #eee' }} />

        {/* 이미지 */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>이미지 배경</div>
          <button
            className="export-btn"
            style={{ width: '100%', marginBottom: 8 }}
            onClick={() => editor && uploadImage(editor)}
          >
            🖼 이미지 업로드
          </button>
          <div style={{ fontSize: 11, color: '#888', lineHeight: 1.7, background: '#f8f8f8', borderRadius: 6, padding: '8px 10px' }}>
            PNG/JPG 도면 이미지를 배경으로 올린 뒤<br />
            위에 벽을 따라 그리세요.<br />
            <strong style={{ color: '#555' }}>AI 자동 인식</strong>은 이미지 선택 후<br />
            우측 패널 → ✦ 벽 자동 인식.
          </div>
        </div>

      </div>
    </div>
  )
}
