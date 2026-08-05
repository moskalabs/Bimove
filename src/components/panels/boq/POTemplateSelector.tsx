// 물량표 템플릿 선택 팝업 (카테고리별 그룹)
import { useState } from 'react'
import { BOQ_CATEGORIES, type BOQTemplate } from '../../../lib/boqTemplates'

type Props = {
  onSelect: (template: BOQTemplate) => void
  onClose: () => void
}

export function POTemplateSelector({ onSelect, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState(BOQ_CATEGORIES[0].key)
  const category = BOQ_CATEGORIES.find(c => c.key === activeCategory) ?? BOQ_CATEGORIES[0]

  return (
    <div className="po-template-overlay" onClick={onClose}>
      <div className="po-template-modal po-template-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="po-template-header">
          <span style={{ fontWeight: 600, fontSize: 14 }}>물량표 추가</span>
          <button className="po-close-btn" onClick={onClose}>×</button>
        </div>

        {/* 카테고리 탭 */}
        <div className="po-category-tabs">
          {BOQ_CATEGORIES.map(c => (
            <button
              key={c.key}
              className={`po-category-tab ${activeCategory === c.key ? 'active' : ''}`}
              onClick={() => setActiveCategory(c.key)}
            >
              <span className="po-category-icon">{c.icon}</span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        {/* 자재 그리드 */}
        <div className="po-template-grid">
          {category.templates.map(t => (
            <button
              key={t.id}
              className="po-template-card"
              onClick={() => { onSelect(t); onClose() }}
            >
              <span className="po-template-icon">{t.icon}</span>
              <span className="po-template-label">{t.label}</span>
              <span className="po-template-desc">{t.description}</span>
              <span className="po-template-method">
                {t.defaultCalcMethod === 'area' ? '면적' : t.defaultCalcMethod === 'length' ? '길이' : '수량'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
