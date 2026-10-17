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
  poGrandTotal, fmtKRW, uid, shouldTakeRemotePO, hasStoredPurchaseOrder,
} from '../../../lib/purchaseOrder'
import { fetchPurchaseOrder, syncPurchaseOrder } from '../../../lib/supabaseSync'
import { createSerialSender, type SerialSender } from '../../../lib/serialSender'
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
  /** 지금 화면의 발주서. 언마운트 flush 가 최신값을 봐야 해서 ref 로도 들고 있다. */
  const poRef = useRef(po)
  /** 디바운스 타이머가 아직 안 터졌는지 */
  const pendingSyncRef = useRef(false)
  /** 마운트 시점의 로컬 발주서. 불러오기 전에 사용자가 손댔는지 가리는 기준. */
  const localAtMountRef = useRef(po)
  /**
   * 이 기기에 저장된 발주서가 처음부터 있었는지.
   *
   * 없으면 **시각을 비교하지 않고 서버를 그대로 받는다.** 비교할 로컬이
   * 애초에 없는데 "빈 발주서 vs 서버" 를 재면, 새 기기에서 서버를 거부하고
   * 빈 내용을 올려 남의 발주서를 지운다.
   */
  const hadLocalRef = useRef(hasStoredPurchaseOrder(projectId ?? ''))

  useEffect(() => { poRef.current = po }, [po])

  // Supabase에서 발주서 로드 (1회)
  useEffect(() => {
    if (!projectId || loaded) return
    let cancelled = false
    ;(async () => {
      try {
        const remote = await fetchPurchaseOrder(projectId)
        // 불러오는 동안 사용자가 이미 고쳤으면 서버로 덮지 않는다. 그 수정은
        // 아직 updatedAt 에 반영되기 전이라 시각 비교로는 못 지킨다
        // (updatedAt 은 loaded 이후의 자동 저장에서만 올라간다).
        const editedWhileLoading = poRef.current !== localAtMountRef.current
        if (!cancelled && remote && !editedWhileLoading) {
          // 이 기기에 저장된 게 없으면 비교할 게 없다 — 서버를 그대로 받는다.
          const takeRemote = !hadLocalRef.current || shouldTakeRemotePO(remote, poRef.current)
          if (takeRemote) setPo(remote)
        }
      } catch {
        if (!cancelled) toast('서버에서 발주서를 불러오지 못했습니다. 로컬 데이터를 사용합니다.', 'error')
      }
      if (!cancelled) setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [projectId, loaded, toast])

  // 디바운스된 Supabase 동기화
  /**
   * 서버로 보내는 길. **한 번에 하나만** 나간다.
   *
   * 발주서 RPC 는 서버에서 전부 지우고 다시 넣는다. 두 요청이 겹치면 늦게
   * 끝난 옛 요청이 새 내용을 덮는다. 보내는 중에 들어온 값은 쌓지 않고
   * 마지막 것만 이어서 보낸다 (serialSender 주석 참고).
   */
  const senderRef = useRef<SerialSender<PurchaseOrder> | null>(null)

  // **렌더 중에 만들지 않는다.** 처음 보낼 때(타이머 콜백 안)에 만든다 —
  // 렌더 도중 ref 를 건드리면 React 가 경고하고, 실제로도 StrictMode 의
  // 두 번 렌더에서 큐가 두 개 생길 수 있다.
  const getSender = useCallback(() => {
    if (senderRef.current === null) {
      senderRef.current = createSerialSender<PurchaseOrder>(
        async (po) => {
          await syncPurchaseOrder(po)
          if (syncFailCount.current > 0) {
            toast('동기화가 복구되었습니다.', 'success')
            syncFailCount.current = 0
          }
        },
        (err) => {
          syncFailCount.current++
          console.warn('[po-sync] Supabase sync failed', err)
          // 첫 실패 시에만 토스트 (반복 방지)
          if (syncFailCount.current === 1) {
            toast('발주서 동기화에 실패했습니다. 로컬에 저장됩니다.', 'error')
          }
        },
      )
    }
    return senderRef.current
  }, [toast])

  // 언마운트 cleanup 은 deps [] 라 그때의 getSender 를 붙들 수 없다.
  // 최신 것을 ref 에 담아둔다 (렌더가 아니라 effect 에서 쓴다).
  const getSenderRef = useRef(getSender)
  useEffect(() => { getSenderRef.current = getSender }, [getSender])

  const syncToSupabase = useCallback((purchaseOrder: PurchaseOrder) => {
    clearTimeout(syncTimerRef.current)
    pendingSyncRef.current = true
    syncTimerRef.current = window.setTimeout(() => {
      pendingSyncRef.current = false
      getSender().push(purchaseOrder)
    }, 2000)
  }, [getSender])

  // 자동 저장 (localStorage 즉시 + Supabase 디바운스)
  useEffect(() => {
    if (projectId && loaded) {
      // 저장본을 받아 그대로 서버로 보낸다. savePurchaseOrder 는 넘긴 객체를
      // 고치지 않으므로(React state 다), 새 updatedAt 은 돌려받아야 한다.
      syncToSupabase(savePurchaseOrder(po))
    }
  }, [po, projectId, loaded, syncToSupabase])

  // cleanup — **대기 중인 저장을 흘려보낸다.**
  //
  // 전엔 타이머만 지웠다. 고치고 2초 안에 패널을 닫으면 서버에 안 올라가고,
  // 로컬에만 남는다. 이 기기에서는 멀쩡해 보이지만 다른 기기에서는 수정이
  // 통째로 사라진 것처럼 보인다.
  //
  // cleanup 에서는 기다릴 수 없으니 던져만 둔다. 실패해도 로컬에는 남아 있고,
  // 다음에 열 때 시각 비교에서 로컬이 이겨 다시 올라간다.
  useEffect(() => {
    return () => {
      clearTimeout(syncTimerRef.current)
      if (!pendingSyncRef.current) return
      pendingSyncRef.current = false
      // 큐에 올린다 — 진행 중인 요청이 있으면 그 뒤에 붙는다. 바로 fetch 를
      // 띄우면 그 요청과 겹쳐서, 늦게 끝난 쪽이 새 내용을 덮을 수 있다.
      getSenderRef.current().push(poRef.current)
    }
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
