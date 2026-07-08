// 하나의 물량표 카테고리 카드
import { useState } from 'react'
import { Plus, Trash2, MoreVertical } from 'lucide-react'
import type { BOQItem, BOQTable } from '../../../lib/purchaseOrder'
import { tableTotal, fmtKRW, duplicateItem, uid } from '../../../lib/purchaseOrder'
import { getTemplate, createItemFromTemplate } from '../../../lib/boqTemplates'
import { POItemRow } from './POItemRow'

type Props = {
  table: BOQTable
  onUpdate: (items: BOQItem[]) => void
  onDelete: () => void
  wallLengths: { label: string; mm: number }[]
  roomPerimeters: { label: string; mm: number }[]
  doors: { id: string; label: string; widthMm: number; heightMm: number }[]
  windows: { id: string; label: string; widthMm: number; heightMm: number }[]
}

export function POTableCard({
  table, onUpdate, onDelete,
  wallLengths, roomPerimeters, doors, windows,
}: Props) {
  const [showMenu, setShowMenu] = useState(false)
  const template = getTemplate(table.templateId)
  const total = tableTotal(table)

  const addItem = () => {
    if (!template) return
    const item = createItemFromTemplate(template)
    onUpdate([...table.items, item])
  }

  const updateItem = (idx: number, updated: BOQItem) => {
    const items = [...table.items]
    items[idx] = updated
    onUpdate(items)
  }

  const dupItem = (idx: number) => {
    const items = [...table.items]
    items.splice(idx + 1, 0, duplicateItem(items[idx]))
    onUpdate(items)
  }

  const delItem = (idx: number) => {
    onUpdate(table.items.filter((_, i) => i !== idx))
  }

  return (
    <div className="po-table-card">
      {/* 헤더 */}
      <div className="po-table-header">
        <span className="po-table-icon">{template?.icon ?? '📋'}</span>
        <span className="po-table-label">{table.label}</span>
        <span className="po-table-count">{table.items.length}개</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button className="po-icon-btn" onClick={addItem} title="품목 추가">
            <Plus size={14} strokeWidth={2} />
          </button>
          <div style={{ position: 'relative' }}>
            <button
              className="po-icon-btn"
              onClick={() => setShowMenu(!showMenu)}
              title="메뉴"
            >
              <MoreVertical size={14} strokeWidth={2} />
            </button>
            {showMenu && (
              <div className="po-table-menu" onMouseLeave={() => setShowMenu(false)}>
                <button onClick={() => { onDelete(); setShowMenu(false) }}>
                  <Trash2 size={12} /> 물량표 삭제
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 컬럼 헤더 */}
      {table.items.length > 0 && (
        <div className="po-item-col-header">
          <span>품목</span>
          <span>순면적</span>
          <span>수량</span>
          <span>금액</span>
          <span></span>
        </div>
      )}

      {/* 품목 리스트 */}
      {table.items.length === 0 ? (
        <div className="po-empty">
          <button className="po-add-first-btn" onClick={addItem}>
            + 품목 추가
          </button>
        </div>
      ) : (
        table.items.map((item, idx) => (
          <POItemRow
            key={item.id}
            item={item}
            onChange={updated => updateItem(idx, updated)}
            onDuplicate={() => dupItem(idx)}
            onDelete={() => delItem(idx)}
            wallLengths={wallLengths}
            roomPerimeters={roomPerimeters}
            doors={doors}
            windows={windows}
          />
        ))
      )}

      {/* 합계 */}
      {table.items.length > 0 && (
        <div className="po-table-total">
          <span>합계</span>
          <span className="po-total-amount">{fmtKRW(total)}</span>
        </div>
      )}
    </div>
  )
}
