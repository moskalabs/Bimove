import React, { useState, useEffect } from 'react'
import {
  MousePointer2, Undo2, Redo2, ChevronDown,
  Square, Circle,
  Copy, Move, RotateCw,
} from 'lucide-react'
import { PageRecordType, createShapeId, GeoShapeGeoStyle } from 'tldraw'
import { useEditor } from '../context/EditorContext'
import { startZoneDraw } from '../lib/drawingState'
import { nextZoneColor } from '../shapes/ZoneShape'

/* ── 커스텀 SVG 아이콘 (건축 특화, 모노톤) ──
 *
 * 시안(2026-10-15)에 맞춰 다시 그렸다. 모두 24 격자, stroke 1.75, 선 끝은
 * 둥글게 — lucide 와 섞여 있어도 굵기와 끝모양이 어긋나지 않게 맞춘 값이다.
 */

/**
 * 벽체: 두께와 높이가 있는 벽 한 토막을 비스듬히 본 직육면체.
 *
 * 전엔 높이가 거의 없는 납작한 판이었다. 시안은 **두툼한 덩어리** 쪽이다 —
 * 벽은 세워 쓰는 물건이라 그게 맞다.
 *
 * 시안을 픽셀로 재서 비례를 맞췄다 — 길이:높이 = 14:9, 뒤로 밀어내는 양은
 * (+3.8, -3). 처음엔 13:10 으로 그렸는데 그러면 덩어리가 정육면체에 가까워
 * "벽 한 토막" 보다 "상자" 로 읽힌다.
 */
function WallIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5.5 6.8 2.5 20.8 8.5 17 11.5z" />
      <path d="M3 5.5v9l14 6v-9" />
      <path d="M20.8 8.5v9l-3.8 3" />
    </svg>
  )
}

/**
 * 개구부: 벽에 난 문틀과 그 경첩에 매달려 열린 문짝.
 *
 * 전엔 평면도의 문 심볼(사분원 궤적)이었다. 시안은 **서서 본 모습**이다 —
 * 벽체 아이콘과 같은 눈높이라야 둘이 한 묶음으로 읽힌다.
 *
 *   양 옆 토막 : 문틀이 뚫린 벽
 *   ㄷ 자      : 문틀
 *   평행사변형 : 앞으로 열린 문짝 (경첩은 왼쪽 틀)
 *
 * 문짝이 앞으로 나온 양은 (+4.7, +2.7). 더 가파르게 눕히면 문짝이 바닥에
 * 누운 것처럼 보여 벽체의 눈높이와 어긋난다.
 */
function OpeningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 18.5h3" />
      <path d="M17 18.5h3" />
      <path d="M7 18.5V2h10v16.5" />
      <path d="M7 2l4.7 2.7v16.5l-4.7-2.7" />
    </svg>
  )
}

/** 공간지정: 마름모 안의 마름모 — 영역을 집어낸다는 뜻. */
function ZoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12z" />
      <path d="M12 8.5 15.5 12 12 15.5 8.5 12z" />
    </svg>
  )
}

/**
 * 공간나누기: 가로 점선을 양쪽 화살표가 벌린다.
 *
 * 치수 아이콘과 비슷해 보이지만 저쪽은 실선 + 보조선이고 이쪽은 점선이다 —
 * "여기를 가른다" 와 "여기를 잰다" 의 차이.
 */
function SpaceDivideIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h18" strokeDasharray="3 2.5" strokeLinecap="butt" />
      <path d="M7 8 3 12l4 4" />
      <path d="M17 8l4 4-4 4" />
    </svg>
  )
}

/** 선: 끝점이 보이는 한 토막. */
function LineIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 18.5 18.5 5.5" />
      <circle cx="5.5" cy="18.5" r="2.4" fill="currentColor" stroke="#fff" strokeWidth="1.2" />
      <circle cx="18.5" cy="5.5" r="2.4" fill="currentColor" stroke="#fff" strokeWidth="1.2" />
    </svg>
  )
}

/** 폴리라인: 꺾이며 이어지는 선과 그 꼭짓점. */
function PolylineIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17.5 9.5 11 14.5 14 20 6.5" />
      <circle cx="4" cy="17.5" r="2.4" fill="currentColor" stroke="#fff" strokeWidth="1.2" />
      <circle cx="14.5" cy="14" r="2.4" fill="currentColor" stroke="#fff" strokeWidth="1.2" />
      <circle cx="20" cy="6.5" r="2.4" fill="currentColor" stroke="#fff" strokeWidth="1.2" />
    </svg>
  )
}

/**
 * 치수: 보조선 두 개와 그 사이를 잇는 **점선** 치수선.
 *
 * 화살촉은 없다. 공간나누기도 점선이지만 그쪽은 양끝이 화살표라 갈라진다.
 * 시안을 재니 대시 4 / 간격 3 이었다 (24 격자로 2.5 / 1.9).
 *
 * 점선만 선끝을 butt 로 둔다. 둥근 끝은 대시를 양쪽으로 굵기의 절반씩
 * 늘려서, 1.9 간격이 거의 다 메워져 **실선처럼 보인다.**
 */
function DimensionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 7.5v9" />
      <path d="M20.5 7.5v9" />
      <path d="M3.5 12h17" strokeDasharray="2.5 1.9" strokeLinecap="butt" />
    </svg>
  )
}

/**
 * 문자: 민자 T.
 *
 * lucide 의 Type 을 쓰고 있었는데 그건 가로획 양 끝에 세리프가, 세로획 밑에
 * 발받침이 붙는다. 시안은 획 두 개뿐이다.
 */
function TextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4.5h16" />
      <path d="M12 4.5v15" />
    </svg>
  )
}

/**
 * 지시선: 가리키는 화살표 → 비스듬한 선 → 가로 꼬리 → 글자.
 *
 * 꼬리가 있어야 "여기를 가리켜 이름을 붙인다" 가 된다. 꼬리 없이 글자만
 * 띄우면 지시선이 아니라 그냥 사선이다.
 *
 * 화살촉은 ㄱ 자 모서리가 아니라 **V 자 미늘**이다 — 진행 방향에서 ±25°,
 * 길이 4.3.
 */
function LeaderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.2 19.3 10.5 12.6h4.8" />
      <path d="M7.3 18 3.2 19.3 4.8 15.3" />
      <text x="18.2" y="12" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none" fontWeight="600">A</text>
    </svg>
  )
}

/* ── 도구 그룹 정의 ── */
type ToolDef = {
  id: string
  label: string
  render: () => React.JSX.Element
}

function lucideBtn(Icon: typeof MousePointer2) {
  return () => <Icon size={18} strokeWidth={1.75} />
}

const GROUP_BASIC: ToolDef[] = [
  { id: 'select', label: '선택', render: lucideBtn(MousePointer2) },
]

// 시안 순서: 벽체 → 개구부 → 공간지정 → 공간나누기.
// 벽을 세우고, 문을 내고, 영역을 잡고, 나누는 작업 순서 그대로다.
const GROUP_SPACE: ToolDef[] = [
  { id: 'wall', label: '벽체', render: WallIcon },
  { id: 'opening', label: '개구부', render: OpeningIcon },
  { id: 'zone', label: '공간지정', render: ZoneIcon },
  { id: 'space-divide', label: '공간나누기', render: SpaceDivideIcon },
]

const GROUP_DRAW: ToolDef[] = [
  { id: 'line', label: '선', render: LineIcon },
  { id: 'polyline', label: '폴리라인', render: PolylineIcon },
  { id: 'rect', label: '사각형', render: lucideBtn(Square) },
  { id: 'circle', label: '원형', render: lucideBtn(Circle) },
]

const GROUP_EDIT: ToolDef[] = [
  { id: 'copy-tool', label: '복사', render: lucideBtn(Copy) },
  { id: 'move-tool', label: '이동', render: lucideBtn(Move) },
  { id: 'rotate-tool', label: '회전', render: lucideBtn(RotateCw) },
]

const GROUP_ANNOTATE: ToolDef[] = [
  { id: 'dimension', label: '치수', render: DimensionIcon },
  { id: 'text', label: '문자', render: TextIcon },
  { id: 'leader', label: '지시선', render: LeaderIcon },
]

/* tldraw 도구 ID 매핑 (커스텀 도구 + tldraw 기본 도구) */
const TOOL_MAP: Record<string, string> = {
  'select': 'select',
  'wall': 'wall',
  'opening': 'door',
  'window': 'window',
  'block': 'block',
  'comment': 'comment',
  'text': 'text',
  'dimension': 'dimension',
  // 여기부터는 tldraw 기본 도구. 전엔 매핑이 없어서 **버튼을 눌러도 파란
  // 활성 표시만 되고 아무 일도 안 했다.**
  'line': 'line',
  'leader': 'arrow',
}

function ToolButton({ tool, active, onClick }: { tool: ToolDef; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`topbar-btn${active ? ' active' : ''}`}
      title={tool.label}
      data-tool={tool.id}
      onClick={onClick}
    >
      {tool.render()}
    </button>
  )
}

function ToolGroup({ tools, activeTool, onSelect }: { tools: ToolDef[]; activeTool: string; onSelect: (id: string) => void }) {
  return (
    <>
      {tools.map(t => (
        <ToolButton key={t.id} tool={t} active={activeTool === t.id} onClick={() => onSelect(t.id)} />
      ))}
    </>
  )
}

export function TopBar() {
  const editor = useEditor()
  const [activeTool, setActiveTool] = useState('select')
  const [showDropdown, setShowDropdown] = useState(false)

  // ── 페이지(Drawing) 목록 + 현재 페이지 추적 ──
  const [pages, setPages] = useState<Array<{ id: string; name: string }>>([])
  const [currentPageId, setCurrentPageId] = useState<string>('')

  useEffect(() => {
    if (!editor) return
    // 초기값
    const syncPages = () => {
      const ps = editor.getPages().map(p => ({ id: p.id, name: p.name }))
      setPages(ps)
      setCurrentPageId(editor.getCurrentPageId())
    }
    syncPages()

    let prevTool = ''
    let prevPageId = editor.getCurrentPageId()
    let prevPageCount = editor.getPages().length
    const unsub = editor.store.listen(() => {
      // 도구 변경 추적
      const current = editor.getCurrentToolId()
      if (current !== prevTool) {
        prevTool = current
        const reverseMap = Object.entries(TOOL_MAP).find(([, v]) => v === current)
        if (reverseMap) setActiveTool(reverseMap[0])
      }
      // 페이지 변경만 추적 (매번 sync 방지)
      const curPageId = editor.getCurrentPageId()
      const curPageCount = editor.getPages().length
      if (curPageId !== prevPageId || curPageCount !== prevPageCount) {
        prevPageId = curPageId
        prevPageCount = curPageCount
        syncPages()
      }
    })
    return unsub
  }, [editor])

  const switchPage = (pageId: string) => {
    if (!editor) return
    editor.setCurrentPage(pageId as never)
    setShowDropdown(false)
  }

  const addPage = () => {
    if (!editor) return
    const num = editor.getPages().length + 1
    const newPageId = PageRecordType.createId()
    editor.createPage({ name: `Drawing ${num}`, id: newPageId })
    editor.setCurrentPage(newPageId)
    setShowDropdown(false)
  }

  const selectTool = (id: string) => {
    setActiveTool(id)

    // 공간지정: 오버레이 기반 폴리곤 드로잉
    if (id === 'zone' && editor) {
      startZoneDraw((result) => {
        const { points, areaM2, perimeterM } = result
        const origin = points[0]
        const localPoints = points.map(p => ({ x: p.x - origin.x, y: p.y - origin.y }))
        const shapeId = createShapeId()
        editor.createShape({
          id: shapeId,
          type: 'zone',
          x: origin.x,
          y: origin.y,
          props: {
            points: localPoints,
            label: '',
            wallHeightMm: 2400,
            areaM2,
            perimeterM,
            color: nextZoneColor(),
          },
        })
        window.dispatchEvent(new CustomEvent('bimova:zone-name', { detail: { shapeId } }))
      })
      return
    }

    // 사각형·원형은 tldraw 의 geo 도구 하나로 그린다 — 어떤 도형인지는
    // "다음에 그릴 스타일" 로 정한다.
    if ((id === 'rect' || id === 'circle') && editor) {
      editor.setStyleForNextShapes(GeoShapeGeoStyle, id === 'rect' ? 'rectangle' : 'ellipse')
      editor.setCurrentTool('geo')
      return
    }

    const mapped = TOOL_MAP[id]
    if (mapped && editor) {
      editor.setCurrentTool(mapped)
    }

    if (id === 'copy-tool' && editor) {
      const ids = editor.getSelectedShapeIds()
      if (ids.length) editor.duplicateShapes(ids, { x: 20, y: 20 })
    }
    if (id === 'move-tool' && editor) {
      editor.setCurrentTool('select')
    }
    // 회전은 도구가 아니라 즉시 동작이다 (복사와 같은 결). 선택한 것을 90° 돌린다.
    if (id === 'rotate-tool' && editor) {
      const ids = editor.getSelectedShapeIds()
      if (ids.length) editor.rotateShapesBy(ids, Math.PI / 2)
    }
  }

  const currentPageName = pages.find(p => p.id === currentPageId)?.name || 'Drawing 1'

  return (
    <div className="topbar">
      {/* 기본 */}
      <div className="topbar-group">
        <div className="topbar-project-tab" onClick={() => setShowDropdown(!showDropdown)}>
          <span className="topbar-project-name">{currentPageName}</span>
          <ChevronDown size={14} strokeWidth={2} />
          {showDropdown && (
            <div className="topbar-dropdown">
              {pages.map(p => (
                <div
                  key={p.id}
                  className={`topbar-dropdown-item${p.id === currentPageId ? ' active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); switchPage(p.id) }}
                >
                  {p.name}
                </div>
              ))}
              <div
                className="topbar-dropdown-item topbar-dropdown-add"
                onClick={(e) => { e.stopPropagation(); addPage() }}
              >
                + 새 도면
              </div>
            </div>
          )}
        </div>
        <ToolGroup tools={GROUP_BASIC} activeTool={activeTool} onSelect={selectTool} />
        <button className="topbar-btn" title="명령 취소 (Ctrl+Z)" onClick={() => editor?.undo()}>
          <Undo2 size={18} strokeWidth={1.75} />
        </button>
        <button className="topbar-btn" title="명령 복구 (Ctrl+Y)" onClick={() => editor?.redo()}>
          <Redo2 size={18} strokeWidth={1.75} />
        </button>
      </div>

      {/* 공간 설정 */}
      <div className="topbar-group">
        <ToolGroup tools={GROUP_SPACE} activeTool={activeTool} onSelect={selectTool} />
      </div>

      {/* 그리기 */}
      <div className="topbar-group">
        <ToolGroup tools={GROUP_DRAW} activeTool={activeTool} onSelect={selectTool} />
      </div>

      {/* 편집(수정) */}
      <div className="topbar-group">
        <ToolGroup tools={GROUP_EDIT} activeTool={activeTool} onSelect={selectTool} />
      </div>

      {/* 주석 */}
      <div className="topbar-group">
        <ToolGroup tools={GROUP_ANNOTATE} activeTool={activeTool} onSelect={selectTool} />
      </div>
    </div>
  )
}
