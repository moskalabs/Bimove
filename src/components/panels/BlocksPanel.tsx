import { useMemo, useState } from 'react'
import { useEditor } from '../../context/EditorContext'
import { BLOCKS, BLOCK_CATEGORIES, type BlockDef } from '../../lib/blockLibrary'

export function BlocksPanel() {
  const editor = useEditor()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const q = query.trim().toLowerCase()
  const byCategory = useMemo(() => {
    const map: Record<string, BlockDef[]> = {}
    for (const cat of BLOCK_CATEGORIES) {
      const items = BLOCKS.filter(
        (b) => b.category === cat && (!q || b.name.toLowerCase().includes(q) || b.id.includes(q)),
      )
      if (items.length) map[cat] = items
    }
    return map
  }, [q])

  const pick = (b: BlockDef) => editor?.setCurrentTool('block', { blockId: b.id })

  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">블록 라이브러리</div>
      <div className="lbar-panel-body">
        <input
          className="panel-search"
          placeholder="검색…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {BLOCK_CATEGORIES.map((cat) => {
          const items = byCategory[cat]
          if (!items) return null
          const isOpen = !collapsed[cat]
          return (
            <div key={cat} className="block-category">
              <div
                className="block-category-title"
                onClick={() => setCollapsed((c) => ({ ...c, [cat]: isOpen }))}
              >
                {isOpen ? '▾' : '▸'} {cat}
              </div>
              {isOpen && (
                <div className="block-grid">
                  {items.map((b) => (
                    <button key={b.id} className="block-item" title={b.name} onClick={() => pick(b)}>
                      <BlockThumb block={b} />
                      <span className="block-item-name">{b.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {Object.keys(byCategory).length === 0 && (
          <div style={{ color: '#999', fontSize: 13, padding: 16 }}>검색 결과 없음</div>
        )}
      </div>
    </div>
  )
}

function BlockThumb({ block }: { block: BlockDef }) {
  // Pad the viewBox so symbols whose decoration extends past their footprint
  // (chairs, door swings, …) still fit inside the thumbnail.
  const pad = Math.max(block.wmm, block.hmm) * 0.3
  const vb = `${-pad} ${-pad} ${block.wmm + pad * 2} ${block.hmm + pad * 2}`
  return (
    <svg className="block-thumb" viewBox={vb} preserveAspectRatio="xMidYMid meet">
      {block.draw()}
    </svg>
  )
}
