// 도면 위에 얹는 마감재 산출표.
//
// 패널의 물량표는 "자재 하나를 들여다보는" 화면이고, 이건 도면에 같이 출력되는
// **집계표**다. 그래서 HTML 이 아니라 SVG 로 그린다 — 도면과 함께 SVG/PDF 로
// 내보낼 때 그대로 따라 나가야 하기 때문이다.
//
// 값은 만들 때 한 번 받아 props 에 담는다(스냅샷). 저장된 도면을 나중에 열거나
// 공유 링크로 열어도 그때 본 숫자가 그대로 남아야 하고, 그게 출력물의 성격에도
// 맞다. 자재를 고친 뒤에는 **더블클릭으로 다시 읽는다.**

import { Rectangle2d, ShapeUtil, SVGContainer, T, type TLBaseShape } from 'tldraw'
import type { BoqRow } from '../lib/boqSummary'
import { buildBoqSummary } from '../lib/boqSummary'
import { loadFinishingData } from '../lib/finishingData'
import {
  BOQ_COLUMNS, BOQ_TITLE_H, BOQ_HEADER_H, BOQ_ROW_H,
  boqTableSize, columnOffsets, cellTextX, fitText,
} from '../lib/boqTableLayout'

export type BoqTableShapeProps = {
  w: number
  h: number
  title: string
  /** BoqRow[] 를 담은 JSON */
  rowsJson: string
  totalAreaM2: number
}

export type BoqTableShape = TLBaseShape<'boqtable', BoqTableShapeProps>

const FONT = 11
const TITLE_FONT = 13
const INK = '#333'
const RULE = '#9aa0a6'

function parseRows(json: string): BoqRow[] {
  try {
    const v: unknown = JSON.parse(json || '[]')
    return Array.isArray(v) ? (v as BoqRow[]) : []
  } catch {
    return []
  }
}

/** 칸에 찍을 글자 — 숫자 칸은 자릿수를 맞춘다. */
function cellText(row: BoqRow, key: BoqRow extends never ? never : keyof BoqRow): string {
  const v = row[key]
  if (key === 'areaM2') return (v as number).toFixed(2)
  if (key === 'qty') {
    const n = v as number
    return Number.isInteger(n) ? String(n) : n.toFixed(2)
  }
  return String(v ?? '')
}

export class BoqTableShapeUtil extends ShapeUtil<BoqTableShape> {
  static override type = 'boqtable' as const

  static override props = {
    w: T.number,
    h: T.number,
    title: T.string,
    rowsJson: T.string,
    totalAreaM2: T.number,
  }

  override getDefaultProps(): BoqTableShapeProps {
    const { w, h } = boqTableSize(0)
    return { w, h, title: '마감재 물량 산출표', rowsJson: '[]', totalAreaM2: 0 }
  }

  canEdit = () => false
  // 칸 너비가 고정이라 늘리면 글자만 늘어난다. 크기는 줄 수에서 나온다.
  canResize = () => false

  override getGeometry(shape: BoqTableShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  indicator(shape: BoqTableShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={2} />
  }

  /**
   * 더블클릭하면 지금 마감재 값으로 다시 읽는다.
   *
   * 어느 프로젝트에서 뽑은 표인지는 shape 의 meta 에 적어둔다 — 도면 데이터
   * (props) 에 넣을 성격이 아니고, 다른 프로젝트로 복사해 가도 원래 출처를
   * 들고 간다.
   */
  override onDoubleClick = (shape: BoqTableShape) => {
    const projectId = shape.meta?.projectId
    if (typeof projectId !== 'string' || !projectId) return
    return { ...shape, props: { ...shape.props, ...boqTableProps(projectId, shape.props.title) } }
  }

  override component(shape: BoqTableShape) {
    const rows = parseRows(shape.props.rowsJson)
    const xs = columnOffsets()
    const { w, h } = shape.props
    const bodyTop = BOQ_TITLE_H + BOQ_HEADER_H
    const totalTop = h - BOQ_ROW_H

    return (
      <SVGContainer>
        <rect x={0} y={0} width={w} height={h} fill="#fff" stroke={RULE} strokeWidth={1} />

        {/* 제목 */}
        <rect x={0} y={0} width={w} height={BOQ_TITLE_H} fill="#f1f3f4" stroke={RULE} strokeWidth={1} />
        <text x={8} y={BOQ_TITLE_H / 2 + 4} fontSize={TITLE_FONT} fontWeight={700} fill={INK}
          style={{ userSelect: 'none' }}>
          {shape.props.title}
        </text>

        {/* 머리줄 */}
        <rect x={0} y={BOQ_TITLE_H} width={w} height={BOQ_HEADER_H} fill="#fafafa" stroke={RULE} strokeWidth={1} />
        {BOQ_COLUMNS.map((c, i) => {
          const { x, anchor } = cellTextX(i)
          return (
            <text key={`h-${c.key}`} x={x} y={BOQ_TITLE_H + BOQ_HEADER_H / 2 + 4}
              fontSize={FONT} fontWeight={600} fill={INK} textAnchor={anchor}
              style={{ userSelect: 'none' }}>
              {c.label}
            </text>
          )
        })}

        {/* 세로 괘선 — 머리줄부터 **합계줄 바로 위까지**.
            합계는 칸을 쓰지 않고 한 줄을 가로질러 적으므로, 괘선을 끝까지
            내리면 금액 글자를 세로줄이 관통한다. */}
        {xs.slice(1, -1).map(x => (
          <line key={`v-${x}`} x1={x} y1={BOQ_TITLE_H} x2={x} y2={totalTop} stroke={RULE} strokeWidth={0.5} />
        ))}

        {/* 본문 */}
        {rows.length === 0 && (
          <text x={w / 2} y={bodyTop + BOQ_ROW_H / 2 + 4} fontSize={FONT} fill="#999"
            textAnchor="middle" style={{ userSelect: 'none' }}>
            물량이 입력된 마감재가 없습니다
          </text>
        )}
        {rows.map((row, r) => {
          const y = bodyTop + r * BOQ_ROW_H
          return (
            <g key={`r-${r}`}>
              <line x1={0} y1={y} x2={w} y2={y} stroke={RULE} strokeWidth={0.5} />
              {BOQ_COLUMNS.map((c, i) => {
                const { x, anchor } = cellTextX(i)
                return (
                  <text key={`c-${i}`} x={x} y={y + BOQ_ROW_H / 2 + 4}
                    fontSize={FONT} fill={INK} textAnchor={anchor}
                    style={{ userSelect: 'none' }}>
                    {fitText(cellText(row, c.key), c.width, FONT)}
                  </text>
                )
              })}
            </g>
          )
        })}

        {/* 합계줄 */}
        <rect x={0} y={totalTop} width={w} height={BOQ_ROW_H} fill="#f6f8fa" stroke={RULE} strokeWidth={1} />
        <text x={8} y={totalTop + BOQ_ROW_H / 2 + 4} fontSize={FONT} fontWeight={700} fill={INK}
          style={{ userSelect: 'none' }}>
          합계
        </text>
        <text x={xs[4] - 6} y={totalTop + BOQ_ROW_H / 2 + 4} fontSize={FONT} fontWeight={700}
          fill={INK} textAnchor="end" style={{ userSelect: 'none' }}>
          {shape.props.totalAreaM2.toFixed(2)} m²
        </text>
      </SVGContainer>
    )
  }

  override toSvg(shape: BoqTableShape) {
    // 화면과 같은 그림이면 되므로 component 를 그대로 쓴다.
    return this.component(shape) as React.ReactElement
  }
}

/**
 * 지금 저장된 마감재 값으로 표 props 를 만든다.
 *
 * 표를 놓을 때와 더블클릭으로 다시 읽을 때 둘 다 여기를 지난다 — 두 자리가
 * 갈라지면 "새로 고쳤는데 모양이 다른" 표가 생긴다.
 */
export function boqTableProps(projectId: string, title = '마감재 물량 산출표'): BoqTableShapeProps {
  const summary = buildBoqSummary(loadFinishingData(projectId))
  const { w, h } = boqTableSize(summary.rows.length)
  return {
    w, h, title,
    rowsJson: JSON.stringify(summary.rows),
    totalAreaM2: summary.totalAreaM2,
  }
}
