/**
 * 보고 있는 **종류(variant)** 와 글을 쓰는 종류가 같아야 한다.
 *
 * 종류 번호가 상세 뷰 안의 state 였다. 그 결과 두 가지가 어긋났다 —
 *
 * 1. 자재를 바꿔도 React 가 같은 컴포넌트를 재사용해서 번호가 남는다.
 *    종류 2개짜리에서 2번째를 보다가 종류 1개짜리 자재로 넘어가면, 화면은
 *    첫 종류를 보여주는데 쓰기는 없는 1번으로 가서 **입력이 조용히 사라진다.**
 * 2. 캔버스의 "재질 적용" 핸들러는 그 번호를 볼 수 없어 늘 0번에 넣었다.
 *    방수 탭을 보며 영역을 지정해도 물량이 일반 쪽에 쌓인다.
 *
 * 둘 다 "화면은 멀쩡한데 숫자가 틀리는" 종류의 사고다. 물량이 틀리면 발주가
 * 틀린다 — 그래서 눈으로 못 잡는다는 게 특히 나쁘다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FinishingTab } from '../../components/panels/boq/FinishingTab'
import { saveFinishingData, createVariant } from '../../lib/finishingData'
import type { FinishingTablesData, FinishingItem } from '../../lib/finishingData'

/** 가짜 에디터 — "재질 적용" 이 읽는 것만 흉내낸다. */
const editor = {
  getShape: () => ({ id: 'shape:a', meta: {} }),
  getShapeGeometry: () => ({ bounds: { width: 2000, height: 3000 } }),
}

vi.mock('../../context/EditorContext', () => ({ useEditor: () => editor }))
vi.mock('../../context/ProjectContext', () => ({
  useProjectId: () => 'p1',
  useProjectName: () => ({ name: 'p', setName: () => {} }),
}))
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ toast: () => {} }) }))
vi.mock('../../lib/scaleConfig', () => ({ getScaleConfig: () => ({ pxPerMm: 1 }) }))

/** 종류 2개짜리 석고보드 + 종류 1개짜리 페인트. */
function data(): FinishingTablesData {
  const gypsum: FinishingItem = {
    id: 'gypsum', label: '석고보드', calcType: 'sheet', lossRate: 0.05, unit: '장',
    variants: [createVariant('일반 석고보드'), createVariant('방수 석고보드')],
  }
  const paint: FinishingItem = {
    id: 'paint', label: '페인트', calcType: 'paint', lossRate: 0.05, unit: 'L',
    variants: [createVariant('수성 페인트')],
  }
  return {
    categories: [{ key: 'c1', label: '마감', expanded: true, items: [gypsum, paint] }],
    updatedAt: 0,
  }
}

/** 평면 물량표의 행 수. 벽면 표가 섞이지 않게 첫 섹션만 센다. */
function floorRows(): number {
  const section = document.querySelectorAll('.ft-section')[0]
  return section ? section.querySelectorAll('tbody tr').length : -1
}

beforeEach(() => {
  localStorage.clear()
  saveFinishingData('p1', data())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('종류 번호', () => {
  it('자재를 바꾸면 남은 번호로 쓰지 않는다 — 행 추가가 먹는다', async () => {
    render(<FinishingTab />)

    // 종류 2개짜리에서 2번째를 본다
    fireEvent.click(await screen.findByText('석고보드'))
    fireEvent.click(await screen.findByText('방수 석고보드'))

    // 종류 1개짜리로 넘어간다
    fireEvent.click(await screen.findByText('페인트'))
    expect(await screen.findByText('수성 페인트')).toBeTruthy()

    // 번호가 1로 남아 있으면 `i === 1` 에 해당하는 종류가 없어서 아무 일도
    // 안 일어난다 — 누른 사람은 버튼이 죽은 줄 안다.
    const before = floorRows()
    fireEvent.click(await screen.findByText('+ 행 추가'))
    expect(floorRows()).toBe(before + 1)
  })

  it('재질 적용이 **보고 있는** 종류에 들어간다', async () => {
    render(<FinishingTab />)
    fireEvent.click(await screen.findByText('석고보드'))
    fireEvent.click(await screen.findByText('방수 석고보드'))

    fireEvent(window, new CustomEvent('bimova:material-applied', {
      detail: { shapeIds: ['shape:a'] },
    }))

    // 방수 쪽에 들어왔다 (2000×3000mm = 2×3m = 6m²)
    expect(await screen.findByDisplayValue('선택 영역')).toBeTruthy()
    expect(screen.getByDisplayValue('6')).toBeTruthy()

    // 일반 쪽은 그대로여야 한다. 전엔 늘 여기로 들어갔다.
    fireEvent.click(screen.getByText('일반 석고보드'))
    expect(screen.queryByDisplayValue('선택 영역')).toBeNull()
  })

  it('종류가 하나뿐인 자재에서도 재질 적용이 들어간다', async () => {
    render(<FinishingTab />)
    fireEvent.click(await screen.findByText('페인트'))

    fireEvent(window, new CustomEvent('bimova:material-applied', {
      detail: { shapeIds: ['shape:a'] },
    }))
    expect(await screen.findByDisplayValue('선택 영역')).toBeTruthy()
  })
})
