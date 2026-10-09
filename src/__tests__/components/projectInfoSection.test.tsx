/**
 * 오른쪽 패널 "파일명" 칸 회귀 테스트
 *
 * 예전엔 이 칸이 localStorage 프로젝트 목록을 직접 뒤져서 이름을 찾았다.
 * 그런데 대시보드 목록은 서버(Supabase)에서 오고, 그렇게 연 프로젝트는
 * localStorage 목록에 아예 없다 → 조회가 늘 실패해서 어떤 도면을 열어도
 * "새 프로젝트" 라고 적혀 있었다. 이제 ProjectNameContext 를 읽는다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ProjectNameContext } from '../../context/ProjectContext'
import { ProjectInfoSection } from '../../components/RBar'

const setName = vi.fn()

function renderSection(name: string) {
  return render(
    <ProjectNameContext.Provider value={{ name, setName }}>
      <ProjectInfoSection />
    </ProjectNameContext.Provider>,
  )
}

afterEach(() => {
  cleanup()
  setName.mockReset()
})

describe('ProjectInfoSection', () => {
  it('컨텍스트의 이름을 파일명 칸에 보여준다', () => {
    renderSection('1차공사_평면도')
    expect(screen.getByDisplayValue('1차공사_평면도')).toBeTruthy()
  })

  it('가져온 도면 이름으로 바뀌면 칸도 따라 바뀐다', () => {
    const { rerender } = renderSection('새 프로젝트')
    expect(screen.getByDisplayValue('새 프로젝트')).toBeTruthy()

    rerender(
      <ProjectNameContext.Provider value={{ name: 'After_1', setName }}>
        <ProjectInfoSection />
      </ProjectNameContext.Provider>,
    )
    expect(screen.getByDisplayValue('After_1')).toBeTruthy()
  })

  it('입력한 글자를 그대로 올려보낸다 (공백 포함)', () => {
    renderSection('평면도')
    fireEvent.change(screen.getByDisplayValue('평면도'), { target: { value: '평면도 1층 ' } })
    expect(setName).toHaveBeenCalledWith('평면도 1층 ')
  })
})
