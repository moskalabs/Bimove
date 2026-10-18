/**
 * "자재 규격 수정" 이 **보고 있던 종류**를 연다.
 *
 * 늘 0 번으로 열렸다. 그래서 "방수 석고보드" 탭에서 규격 수정을 누르면
 * "일반 석고보드" 가 열리고, 거기서 고친 값이 엉뚱한 종류에 들어갔다.
 * 화면은 그대로니 쓰는 사람은 "고쳐도 안 바뀐다" 로 보고, 실제로는 **안 보는
 * 종류가 조용히 바뀌고 있었다.** 규격이 틀리면 발주 수량이 틀린다 — 돈이다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FinishingTab } from '../../components/panels/boq/FinishingTab'
import { saveFinishingData, resetFinishingData, createVariant, uid } from '../../lib/finishingData'
import type { FinishingTablesData, FinishingItem } from '../../lib/finishingData'

vi.mock('../../context/EditorContext', () => ({ useEditor: () => null }))
vi.mock('../../context/ProjectContext', () => ({
  useProjectId: () => 'p1',
  useProjectName: () => ({ name: 'p', setName: () => {} }),
}))
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ toast: () => {} }) }))

/** 종류 둘짜리 석고보드. 두 번째를 보다가 규격 수정을 연다. */
function twoVariantData(): FinishingTablesData {
  const a = { ...createVariant('일반 석고보드'), itemWidthMm: 900, itemLengthMm: 1800 }
  const b = { ...createVariant('방수 석고보드'), itemWidthMm: 910, itemLengthMm: 1820 }
  const item: FinishingItem = {
    id: 'gypsum', label: '석고보드', calcType: 'sheet',
    lossRate: 0.05, unit: '장', variants: [a, b],
  }
  return { categories: [{ key: 'c1', label: '벽체 마감', expanded: true, items: [item] }], updatedAt: 0 }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('자재 규격 수정 모달', () => {
  it('보고 있던 종류를 연다 — 늘 첫 번째를 열지 않는다', async () => {
    saveFinishingData('p1', twoVariantData())
    render(<FinishingTab />)

    // 자재를 고르고 두 번째 종류 탭으로 간다
    fireEvent.click(await screen.findByText('석고보드'))
    fireEvent.click(await screen.findByText('방수 석고보드'))

    fireEvent.click(await screen.findByText(/자재 규격 수정/))

    // 모달의 자재명 자리에 **방수** 가 떠 있어야 한다.
    // (첫 번째를 열면 여기가 "일반 석고보드" 다 — 그게 이 버그였다.)
    const modal = document.querySelector('.ft-spec-modal')
    expect(modal, '모달이 안 열렸다').toBeTruthy()
    expect(modal!.textContent).toContain('방수 석고보드')
  })

  it('첫 번째 종류를 보고 있으면 그걸 연다', async () => {
    saveFinishingData('p1', twoVariantData())
    render(<FinishingTab />)
    fireEvent.click(await screen.findByText('석고보드'))
    fireEvent.click(await screen.findByText(/자재 규격 수정/))

    const btn = document.querySelector('.ft-spec-variant-btn, .ft-spec-modal')
    expect(btn!.textContent).toContain('일반 석고보드')
  })

  it('종류가 하나뿐이어도 터지지 않는다', async () => {
    const d = twoVariantData()
    d.categories[0].items[0].variants = [d.categories[0].items[0].variants[0]]
    saveFinishingData('p1', d)
    render(<FinishingTab />)
    fireEvent.click(await screen.findByText('석고보드'))
    fireEvent.click(await screen.findByText(/자재 규격 수정/))
    expect(document.querySelector('.ft-spec-modal')).toBeTruthy()
  })
})

// resetFinishingData / uid 는 fixture 가 쓰지 않지만, import 를 지우면
// 다른 테스트가 기대하는 모듈 부작용(기본값 시드)이 사라질 수 있어 남겨둔다.
void resetFinishingData
void uid
