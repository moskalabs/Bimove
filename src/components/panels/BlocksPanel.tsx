const BLOCK_CATEGORIES = ['벽체', '문', '창문', '계단', '기둥']

export function BlocksPanel() {
  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">블록 라이브러리</div>
      <div className="lbar-panel-body">
        <input className="panel-search" placeholder="검색 (Ctrl+F)" />
        {BLOCK_CATEGORIES.map(cat => (
          <div key={cat} className="block-category">
            <div className="block-category-title">▸ {cat}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
