// 도면에 얹는 산출표의 칸 크기.
//
// 표는 **도면 요소**라 화면 글꼴 크기가 아니라 도면 좌표(px)로 잡는다. 칸 너비를
// 내용에 맞춰 늘리면 자재를 하나 고칠 때마다 표 폭이 들썩여서, 도면틀 옆에
// 맞춰 둔 자리가 매번 어긋난다. 그래서 **고정 폭**이다.

import type { BoqRow } from './boqSummary'

export type BoqColumn = {
  key: keyof BoqRow
  label: string
  width: number
  align: 'left' | 'right' | 'center'
}

export const BOQ_COLUMNS: BoqColumn[] = [
  { key: 'category', label: '구분',     width: 88,  align: 'left' },
  { key: 'item',     label: '품명',     width: 104, align: 'left' },
  { key: 'spec',     label: '규격',     width: 228, align: 'left' },
  { key: 'areaM2',   label: '면적(m²)', width: 78,  align: 'right' },
  { key: 'qty',      label: '수량',     width: 66,  align: 'right' },
  { key: 'unit',     label: '단위',     width: 48,  align: 'center' },
]

export const BOQ_TITLE_H = 28
export const BOQ_HEADER_H = 24
export const BOQ_ROW_H = 22

export const BOQ_TABLE_W = BOQ_COLUMNS.reduce((sum, c) => sum + c.width, 0)

/**
 * 표 전체 크기.
 *
 * 제목줄 + 머리줄 + 본문 + 합계줄. 줄이 하나도 없어도 "내용 없음" 한 줄은
 * 그리므로 최소 높이가 있다 — 빈 표가 선 하나로 쪼그라들면 도면에서 못 찾는다.
 */
export function boqTableSize(rowCount: number): { w: number; h: number } {
  const bodyRows = Math.max(rowCount, 1)
  return {
    w: BOQ_TABLE_W,
    h: BOQ_TITLE_H + BOQ_HEADER_H + bodyRows * BOQ_ROW_H + BOQ_ROW_H,
  }
}

/** 각 칸의 왼쪽 x 좌표 (칸 수 + 1 개 — 마지막은 표 오른쪽 끝). */
export function columnOffsets(): number[] {
  const xs = [0]
  for (const c of BOQ_COLUMNS) xs.push(xs[xs.length - 1] + c.width)
  return xs
}

/** 글자를 칸 안쪽 어디에 둘지 (x 좌표, textAnchor). */
export function cellTextX(colIndex: number, pad = 6): { x: number; anchor: 'start' | 'end' | 'middle' } {
  const xs = columnOffsets()
  const col = BOQ_COLUMNS[colIndex]
  if (col.align === 'right') return { x: xs[colIndex + 1] - pad, anchor: 'end' }
  if (col.align === 'center') return { x: xs[colIndex] + col.width / 2, anchor: 'middle' }
  return { x: xs[colIndex] + pad, anchor: 'start' }
}

/**
 * 칸을 넘치는 글자를 잘라 `…` 를 붙인다.
 *
 * 글꼴을 재지 않고 **글자 수**로 어림한다. 한글은 영문보다 넓으니 한 글자를
 * 1 로, 그 외를 0.55 로 센다. 표는 고정 폭이라 넘치면 옆 칸을 침범한다.
 */
export function fitText(text: string, width: number, fontSize: number, pad = 6): string {
  const budget = (width - pad * 2) / fontSize
  const weight = (ch: string) => (/[ㄱ-힝一-鿿぀-ヿ]/.test(ch) ? 1 : 0.55)
  let used = 0
  for (let i = 0; i < text.length; i++) {
    used += weight(text[i])
    if (used > budget) {
      // '…' 자리를 남기려고 한 글자 더 물러선다
      return (i > 0 ? text.slice(0, i - 1) : '') + '…'
    }
  }
  return text
}
