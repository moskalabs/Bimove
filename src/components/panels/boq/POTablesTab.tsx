// 발주서 메인 탭 - 물량표 목록 + [+] 추가 + 내보내기
import { useEffect, useState, useRef, useCallback } from 'react'
import { Plus, Download } from 'lucide-react'
import { useEditor } from '../../../context/EditorContext'
import { useProjectId } from '../../../context/ProjectContext'
import { useToast } from '../../../context/ToastContext'
import { getScaleConfig } from '../../../lib/scaleConfig'
import { getWallHeightMm } from '../../../lib/settings'
import { detectRooms } from '../../../lib/roomDetection'
import type { BOQTable, PurchaseOrder } from '../../../lib/purchaseOrder'
import {
  loadPurchaseOrder, savePurchaseOrder,
  addTable, removeTable, updateTableItems,
  poGrandTotal, fmtKRW, uid,
} from '../../../lib/purchaseOrder'
import { fetchPurchaseOrder, syncPurchaseOrder } from '../../../lib/supabaseSync'
import type { BOQTemplate } from '../../../lib/boqTemplates'
import { createItemFromTemplate } from '../../../lib/boqTemplates'
import { getFinishingAreaForPO } from '../../../lib/finishingData'
import { POTemplateSelector } from './POTemplateSelector'
import { POTableCard } from './POTableCard'

export function POTablesTab() {
  const editor = useEditor()
  const projectId = useProjectId()
  const { toast } = useToast()
  const [po, setPo] = useState<PurchaseOrder>(() =>
    loadPurchaseOrder(projectId ?? ''),
  )
  const [showSelector, setShowSelector] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const syncTimerRef = useRef<number>(0)
  const syncFailCount = useRef(0)

  // Supabase에서 발주서 로드 (1회)
  useEffect(() => {
    if (!projectId || loaded) return
    let cancelled = false
    ;(async () => {
      try {
        const remote = await fetchPurchaseOrder(projectId)
        if (!cancelled && remote && remote.tables.length > 0) {
          setPo(remote)
        }
      } catch {
        if (!cancelled) toast('서버에서 발주서를 불러오지 못했습니다. 로컬 데이터를 사용합니다.', 'error')
      }
      if (!cancelled) setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [projectId, loaded])

  // 디바운스된 Supabase 동기화
  const syncToSupabase = useCallback((purchaseOrder: PurchaseOrder) => {
    clearTimeout(syncTimerRef.current)
    syncTimerRef.current = window.setTimeout(async () => {
      try {
        await syncPurchaseOrder(purchaseOrder)
        if (syncFailCount.current > 0) {
          toast('동기화가 복구되었습니다.', 'success')
          syncFailCount.current = 0
        }
      } catch (err) {
        syncFailCount.current++
        console.warn('[po-sync] Supabase sync failed', err)
        // 첫 실패 시에만 토스트 (반복 방지)
        if (syncFailCount.current === 1) {
          toast('발주서 동기화에 실패했습니다. 로컬에 저장됩니다.', 'error')
        }
      }
    }, 2000)
  }, [toast])

  // 자동 저장 (localStorage 즉시 + Supabase 디바운스)
  useEffect(() => {
    if (projectId && loaded) {
      savePurchaseOrder(po)
      syncToSupabase(po)
    }
  }, [po, projectId, loaded, syncToSupabase])

  // cleanup
  useEffect(() => {
    return () => clearTimeout(syncTimerRef.current)
  }, [])

  // 도면에서 벽/방/문/창문 데이터 추출 (shape 변경 시 자동 갱신)
  const [drawingData, setDrawingData] = useState<{
    wallLengths: { label: string; mm: number }[]
    roomPerimeters: { label: string; mm: number }[]
    doors: { id: string; label: string; widthMm: number; heightMm: number }[]
    windows: { id: string; label: string; widthMm: number; heightMm: number }[]
  }>({ wallLengths: [], roomPerimeters: [], doors: [], windows: [] })

  useEffect(() => {
    if (!editor) return

    const compute = () => {
      const shapes = editor.getCurrentPageShapes()
      const scale = getScaleConfig(editor)
      const wallHeight = getWallHeightMm()

      const walls = shapes.filter(s => s.type === 'wall')
      const wallLengths = walls.map((w, i) => {
        const p = w.props as { x2: number; y2: number }
        const lenMm = Math.hypot(p.x2, p.y2) / scale.pxPerMm
        return { label: `벽 ${i + 1}`, mm: lenMm }
      })

      const wallData = walls.map(w => {
        const p = w.props as { x2: number; y2: number }
        return { x1: w.x, y1: w.y, x2: w.x + p.x2, y2: w.y + p.y2 }
      })
      const rooms = detectRooms(wallData)
      const roomPerimeters = rooms.map((r, i) => {
        let perimeter = 0
        for (let j = 0; j < r.vertices.length; j++) {
          const a = r.vertices[j]
          const b = r.vertices[(j + 1) % r.vertices.length]
          perimeter += Math.hypot(b.x - a.x, b.y - a.y)
        }
        return { label: `공간 ${i + 1}`, mm: perimeter / scale.pxPerMm }
      })

      const doorShapes = shapes.filter(s => s.type === 'door')
      const doors = doorShapes.map((d, i) => {
        const p = d.props as { width: number }
        const wMm = p.width / scale.pxPerMm
        return { id: d.id, label: `문 ${i + 1}`, widthMm: Math.round(wMm), heightMm: wallHeight }
      })

      const windowShapes = shapes.filter(s => s.type === 'window')
      const windows = windowShapes.map((w, i) => {
        const p = w.props as { width: number }
        const wMm = p.width / scale.pxPerMm
        return { id: w.id, label: `창문 ${i + 1}`, widthMm: Math.round(wMm), heightMm: 1200 }
      })

      setDrawingData({ wallLengths, roomPerimeters, doors, windows })
    }

    compute()
    let timer = 0
    const unsub = editor.store.listen(() => {
      clearTimeout(timer)
      timer = window.setTimeout(compute, 200)
    })
    return () => { unsub(); clearTimeout(timer) }
  }, [editor])

  /** 도면 데이터로 아이템 자동 채우기 (마감재 Tables 데이터 우선) */
  const autoFillItem = (
    item: import('../../../lib/purchaseOrder').BOQItem,
    roomIdx = 0,
    templateId?: string,
  ) => {
    const method = item.calcMethod ?? 'area'
    if (method !== 'area') return item

    const filled = { ...item }

    // 1) 마감재 Tables 데이터가 있으면 우선 사용
    if (templateId && projectId) {
      const fd = getFinishingAreaForPO(projectId, templateId)
      if (fd && fd.totalAreaM2 > 0) {
        // totalAreaM2를 widthMm × heightMm로 변환 (heightMm=1000 기준)
        filled.widthMm = Math.round(fd.totalAreaM2 * 1000)
        filled.heightMm = 1000
        // 마감재 규격 동기화
        if (fd.itemWidthMm) filled.itemWidthMm = fd.itemWidthMm
        if (fd.itemLengthMm) filled.itemLengthMm = fd.itemLengthMm
        filled.lossRate = fd.lossRate
        filled.unit = fd.unit
        if (!filled.name.includes('(')) filled.name = `${filled.name} (마감재 연동)`
        return filled
      }
    }

    // 2) 도면 데이터 폴백
    const wallHeight = getWallHeightMm()

    if (drawingData.roomPerimeters.length > 0) {
      const room = drawingData.roomPerimeters[roomIdx % drawingData.roomPerimeters.length]
      filled.widthMm = Math.round(room.mm)
      if (!filled.name.includes('(')) filled.name = `${filled.name} (${room.label})`
    } else if (drawingData.wallLengths.length > 0) {
      const total = drawingData.wallLengths.reduce((s, w) => s + w.mm, 0)
      filled.widthMm = Math.round(total)
    }

    // 높이 미설정이면 벽 높이 사용
    if (!filled.heightMm) filled.heightMm = wallHeight

    return filled
  }

  const handleAddTable = (template: BOQTemplate) => {
    const rooms = drawingData.roomPerimeters

    // 마감재 Tables에 데이터가 있으면 단일 아이템 (이미 합산됨)
    let items: import('../../../lib/purchaseOrder').BOQItem[]
    const fd = projectId ? getFinishingAreaForPO(projectId, template.id) : null
    if (fd && fd.totalAreaM2 > 0) {
      items = [autoFillItem(createItemFromTemplate(template), 0, template.id)]
    } else if (rooms.length > 1) {
      // 마감재 없으면 방 개수만큼 아이템 자동 생성
      items = rooms.map((_, i) => autoFillItem(createItemFromTemplate(template), i, template.id))
    } else {
      items = [autoFillItem(createItemFromTemplate(template), 0, template.id)]
    }

    const newTable: BOQTable = {
      id: uid(),
      templateId: template.id,
      label: template.label,
      items,
      createdAt: Date.now(),
    }
    setPo(prev => addTable(prev, newTable))
  }

  const handleDeleteTable = (tableId: string) => {
    setPo(prev => removeTable(prev, tableId))
  }

  const handleUpdateItems = (tableId: string, items: import('../../../lib/purchaseOrder').BOQItem[]) => {
    setPo(prev => updateTableItems(prev, tableId, items))
  }

  const handleExport = async (format: 'xlsx' | 'pdf' | 'jpg') => {
    setShowExport(false)
    const { exportPOXlsx, printPOPdf, exportPOJpg } = await import('../../../lib/poExport')
    if (format === 'xlsx') exportPOXlsx(po)
    else if (format === 'pdf') printPOPdf(po)
    else if (format === 'jpg') exportPOJpg(po)
  }

  const grandTotal = poGrandTotal(po)

  return (
    <div className="po-tables-tab">
      {/* 상단 액션바 */}
      <div className="po-tab-header">
        <span className="po-tab-title">발주서</span>
        <div className="po-tab-actions">
          <button className="po-add-btn" onClick={() => setShowSelector(true)} title="물량표 추가">
            <Plus size={14} strokeWidth={2} /> 추가
          </button>
          {po.tables.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button className="po-export-btn" onClick={() => setShowExport(!showExport)}>
                <Download size={14} strokeWidth={2} /> 내보내기
              </button>
              {showExport && (
                <div className="po-export-menu">
                  <button onClick={() => handleExport('xlsx')}>📊 XLSX (엑셀)</button>
                  <button onClick={() => handleExport('pdf')}>📄 PDF</button>
                  <button onClick={() => handleExport('jpg')}>🖼️ JPG</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 물량표 목록 */}
      {po.tables.length === 0 ? (
        <div className="po-empty-state">
          <div className="po-empty-icon">📋</div>
          <div className="po-empty-text">아직 물량표가 없어요</div>
          <button className="po-empty-add-btn" onClick={() => setShowSelector(true)}>
            + 물량표 추가
          </button>
        </div>
      ) : (
        <>
          {po.tables.map(table => (
            <POTableCard
              key={table.id}
              table={table}
              onUpdate={items => handleUpdateItems(table.id, items)}
              onDelete={() => handleDeleteTable(table.id)}
              onAutoFill={(item, roomIdx) => autoFillItem(item, roomIdx, table.templateId)}
              wallLengths={drawingData.wallLengths}
              roomPerimeters={drawingData.roomPerimeters}
              doors={drawingData.doors}
              windows={drawingData.windows}
            />
          ))}

          {/* 총 합계 */}
          <div className="po-grand-total">
            <span>총 합계</span>
            <span className="po-grand-total-amount">{fmtKRW(grandTotal)}</span>
          </div>
        </>
      )}

      {/* 템플릿 선택 팝업 */}
      {showSelector && (
        <POTemplateSelector
          onSelect={handleAddTable}
          onClose={() => setShowSelector(false)}
        />
      )}
    </div>
  )
}
