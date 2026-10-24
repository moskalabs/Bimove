import { describe, it, expect } from 'vitest'
import { docStatus, isEmptyDrawing } from '../../lib/docStatus'
import type { BimoveDocument } from '../../lib/bimoveDoc'
import type { FinishingTablesData } from '../../lib/finishingData'

const shape = (type: string, parentId: string, props: Record<string, unknown> = {}, id = `s${Math.random()}`) => ({
  id, type, x: 0, y: 0, rotation: 0, index: 'a1', parentId, props,
})

function doc(over: Partial<BimoveDocument> = {}): BimoveDocument {
  return {
    version: 1,
    pages: [{ id: 'page:a', name: '모형', index: 'a1' }, { id: 'page:b', name: '배치1', index: 'a2' }],
    shapes: [],
    records: {},
    source: { from: 'tldraw', at: 0, shapeCount: 0 },
    skipped: 0,
    ...over,
  } as BimoveDocument
}

/** 카테고리 → 자재 → 변형 → 구역 줄. 네 겹이다. */
function fin(rows: Array<{ label: string; floorAreaM2?: number; wallLengthM?: number }>): FinishingTablesData {
  return {
    updatedAt: 0,
    categories: [{
      key: 'wall', label: '벽', expanded: true,
      items: [{
        id: 'i1', label: '석고보드', calcType: 'sheet', lossRate: 0.05, unit: '장',
        variants: [{
          id: 'v1', label: '일반',
          zones: rows.map((r, i) => ({
            id: `z${i}`, label: r.label,
            floorAreaM2: r.floorAreaM2 ?? 0,
            wallLengthM: r.wallLengthM ?? 0,
            wallHeightM: 2.4,
          })),
        }],
      }],
    }],
  } as FinishingTablesData
}

describe('docStatus', () => {
  it('한 장의 것만 센다 — 핀과 같은 규칙이어야 한다', () => {
    // "공간 3개" 라고 적힌 화면에 다른 장 핀이 섞여 있으면 안 된다.
    const d = doc({
      shapes: [
        shape('zone', 'page:a', { areaM2: 10 }),
        shape('zone', 'page:a', { areaM2: 5.5 }),
        shape('zone', 'page:b', { areaM2: 99 }),
        shape('wall', 'page:a'),
        shape('wall', 'page:b'),
      ],
    })
    const a = docStatus(d, 'page:a', null)
    expect(a.zoneCount).toBe(2)
    expect(a.floorAreaM2).toBe(15.5)
    expect(a.wallCount).toBe(1)

    const b = docStatus(d, 'page:b', null)
    expect(b.zoneCount).toBe(1)
    expect(b.floorAreaM2).toBe(99)
  })

  it('장을 안 고르면 문서 전체', () => {
    const d = doc({ shapes: [shape('zone', 'page:a', { areaM2: 1 }), shape('zone', 'page:b', { areaM2: 2 })] })
    expect(docStatus(d, '', null).zoneCount).toBe(2)
  })

  it('도형 종류를 센다', () => {
    const d = doc({
      shapes: [
        shape('wall', 'page:a'), shape('wall', 'page:a'),
        shape('door', 'page:a'), shape('window', 'page:a'),
        shape('dimension', 'page:a'),
        shape('boqtable', 'page:a'),
        shape('dxfgroup', 'page:a'),
      ],
    })
    const s = docStatus(d, 'page:a', null)
    expect(s).toMatchObject({ wallCount: 2, openingCount: 2, dimCount: 1, boqCount: 1 })
  })

  it('면적 합에 부동소수 찌꺼기가 안 붙는다', () => {
    const d = doc({ shapes: [shape('zone', 'page:a', { areaM2: 0.1 }), shape('zone', 'page:a', { areaM2: 0.2 })] })
    expect(docStatus(d, 'page:a', null).floorAreaM2).toBe(0.3)
  })

  it('areaM2 가 없거나 이상하면 0 으로 본다', () => {
    const d = doc({
      shapes: [
        shape('zone', 'page:a', {}),
        shape('zone', 'page:a', { areaM2: 'x' }),
        shape('zone', 'page:a', { areaM2: NaN }),
        shape('zone', 'page:a', { areaM2: 7 }),
      ],
    })
    const s = docStatus(d, 'page:a', null)
    expect(s.zoneCount).toBe(4)
    expect(s.floorAreaM2).toBe(7)
  })

  it('코멘트를 열림/해결로 가른다 — 그 장의 것만', () => {
    const msg = [{ text: '글' }]
    const d = doc({
      records: {
        'document:document': {
          typeName: 'document',
          meta: {
            comments: [
              { id: '1', pageId: 'page:a', x: 0, y: 0, messages: msg },
              { id: '2', pageId: 'page:a', x: 0, y: 0, resolved: true, messages: msg },
              { id: '3', pageId: 'page:b', x: 0, y: 0, messages: msg },
            ],
          },
        },
      },
    })
    expect(docStatus(d, 'page:a', null)).toMatchObject({ commentsOpen: 1, commentsResolved: 1 })
    expect(docStatus(d, 'page:b', null)).toMatchObject({ commentsOpen: 1, commentsResolved: 0 })
  })

  it('마감재 진행 — 같은 공간을 **이름으로 묶는다**', () => {
    // 안 묶으면 자재 가짓수만큼 부풀어 "8/40" 같은 거짓 진행률이 된다.
    const f = fin([
      { label: '거실', floorAreaM2: 20 },
      { label: '거실', floorAreaM2: 0 },   // 같은 공간, 다른 줄
      { label: '안방', floorAreaM2: 0 },
      { label: '주방', wallLengthM: 12 },  // 벽 길이만 적어도 '적은 것'
      { label: '  ', floorAreaM2: 5 },     // 이름 없는 줄은 안 센다
    ])
    const s = docStatus(doc(), 'page:a', f)
    expect(s.finishingZones).toBe(3)
    expect(s.finishedZones).toBe(2)
  })

  it('마감재 데이터가 없으면 0/0', () => {
    expect(docStatus(doc(), 'page:a', null)).toMatchObject({ finishedZones: 0, finishingZones: 0 })
  })

  it('장 수를 들고 온다', () => {
    expect(docStatus(doc(), 'page:a', null).pageCount).toBe(2)
  })

  it('isEmptyDrawing — 아무것도 안 그렸을 때만 참', () => {
    const empty = docStatus(doc(), 'page:a', null)
    expect(isEmptyDrawing(empty)).toBe(true)
    // 물량표만 있는 건 "도면을 그렸다" 가 아니다
    const onlyBoq = docStatus(doc({ shapes: [shape('boqtable', 'page:a')] }), 'page:a', null)
    expect(isEmptyDrawing(onlyBoq)).toBe(true)
    const withWall = docStatus(doc({ shapes: [shape('wall', 'page:a')] }), 'page:a', null)
    expect(isEmptyDrawing(withWall)).toBe(false)
  })
})
