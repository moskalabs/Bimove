/**
 * 햄버거 메뉴 상단 프로젝트 이름 회귀 테스트
 *
 * 도면을 가져오면 오른쪽 패널의 "파일명" 칸은 그 파일 이름으로 바뀌는데
 * 왼쪽 메뉴 맨 위는 "● 새 프로젝트" 그대로였다. 이 메뉴만 localStorage
 * 프로젝트 목록을 직접 뒤지고 있었기 때문이다. 두 가지로 어긋난다:
 *  - 대시보드(서버)에서 연 프로젝트는 그 목록에 아예 없다.
 *  - 가져온 직후엔 이름 저장 디바운스(800ms) 전이라 목록이 아직 옛 이름이다.
 * RBar 가 예전에 똑같이 당했던 실수다 (projectInfoSection.test.tsx 참고).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ProjectNameContext } from '../../context/ProjectContext'
import { HamburgerMenu } from '../../components/LBar'

const setName = vi.fn()

function renderMenu(name: string) {
  return render(
    <ProjectNameContext.Provider value={{ name, setName }}>
      <HamburgerMenu open onClose={() => {}} onImport={() => {}} />
    </ProjectNameContext.Provider>,
  )
}

afterEach(() => {
  cleanup()
  setName.mockReset()
})

describe('햄버거 메뉴 프로젝트 이름', () => {
  it('컨텍스트의 이름을 보여준다', () => {
    renderMenu('26.08.07_마실')
    expect(screen.getByText('● 26.08.07_마실')).toBeTruthy()
  })

  it('도면을 가져와 이름이 바뀌면 메뉴도 따라 바뀐다', () => {
    const { rerender } = renderMenu('새 프로젝트')
    expect(screen.getByText('● 새 프로젝트')).toBeTruthy()

    rerender(
      <ProjectNameContext.Provider value={{ name: '210218-판교줌 737-10 _ 건축(사용승인)', setName }}>
        <HamburgerMenu open onClose={() => {}} onImport={() => {}} />
      </ProjectNameContext.Provider>,
    )
    expect(screen.getByText('● 210218-판교줌 737-10 _ 건축(사용승인)')).toBeTruthy()
  })

  it('이름이 비었으면 "새 프로젝트" 로 둔다', () => {
    // 이름 칸을 통째로 지우는 중일 수 있다. 빈 칸보다 기본 이름이 낫다.
    renderMenu('   ')
    expect(screen.getByText('● 새 프로젝트')).toBeTruthy()
  })
})
