// 물량표 템플릿 선택 팝업
import { BOQ_TEMPLATES, type BOQTemplate } from '../../../lib/boqTemplates'

type Props = {
  onSelect: (template: BOQTemplate) => void
  onClose: () => void
}

export function POTemplateSelector({ onSelect, onClose }: Props) {
  return (
    <div className="po-template-overlay" onClick={onClose}>
      <div className="po-template-modal" onClick={e => e.stopPropagation()}>
        <div className="po-template-header">
          <span style={{ fontWeight: 600, fontSize: 14 }}>물량표 추가</span>
          <button className="po-close-btn" onClick={onClose}>×</button>
        </div>
        <div className="po-template-grid">
          {BOQ_TEMPLATES.map(t => (
            <button
              key={t.id}
              className="po-template-card"
              onClick={() => { onSelect(t); onClose() }}
            >
              <span className="po-template-icon">{t.icon}</span>
              <span className="po-template-label">{t.label}</span>
              <span className="po-template-desc">{t.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
