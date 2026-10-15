/**
 * 햄버거 메뉴 "가져오기" 서브창 테스트
 *
 * 예전엔 가져오기를 누르면 왼쪽에 고정 패널이 열렸다. 그런데 그 패널을 **닫는
 * 길이 없었다** — L바 아이콘에 가져오기 토글이 없어서, 끄려면 다른 패널을
 * 열었다가 그걸 다시 닫아야 했다. 파일 한 번 고르자고 화면 한쪽을 계속 차지할
 * 이유도 없다.
 *
 * 그래서 내보내기와 같은 모양의 서브창으로 바꿨다. 항목을 고르면 바로 파일
 * 선택 다이얼로그가 열리고 메뉴는 닫힌다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ProjectNameContext } from '../../context/ProjectContext'
import { HamburgerMenu } from '../../components/LBar'

const setName = vi.fn()

function renderMenu(onImport = vi.fn(), onClose = vi.fn()) {
  render(
    <ProjectNameContext.Provider value={{ name: '테스트', setName }}>
      <HamburgerMenu open onClose={onClose} onImport={onImport} />
    </ProjectNameContext.Provider>,
  )
  return { onImport, onClose }
}

afterEach(() => {
  cleanup()
  setName.mockReset()
})

describe('햄버거 메뉴 가져오기 서브창', () => {
  it('처음에는 서브창이 안 보인다', () => {
    renderMenu()
    expect(screen.queryByText('📐 DXF / DWG 도면')).toBeNull()
  })

  it('가져오기를 누르면 서브창에 세 종류가 뜬다', () => {
    renderMenu()
    fireEvent.click(screen.getByText('가져오기'))
    expect(screen.getByText('📐 DXF / DWG 도면')).toBeTruthy()
    expect(screen.getByText('📄 PDF 도면')).toBeTruthy()
    expect(screen.getByText('🖼 이미지 배경')).toBeTruthy()
  })

  it('항목을 고르면 그 종류로 임포트하고 메뉴를 닫는다', () => {
    const { onImport, onClose } = renderMenu()
    fireEvent.click(screen.getByText('가져오기'))
    fireEvent.click(screen.getByText('📐 DXF / DWG 도면'))
    expect(onImport).toHaveBeenCalledWith('cad')
    // 닫히지 않으면 예전처럼 "끄는 법이 없는" 상태로 돌아간다
    expect(onClose).toHaveBeenCalled()
  })

  it('PDF 와 이미지도 각자 종류로 넘긴다', () => {
    const { onImport } = renderMenu()
    fireEvent.click(screen.getByText('가져오기'))
    fireEvent.click(screen.getByText('📄 PDF 도면'))
    expect(onImport).toHaveBeenCalledWith('pdf')

    cleanup()
    const second = renderMenu()
    fireEvent.click(screen.getByText('가져오기'))
    fireEvent.click(screen.getByText('🖼 이미지 배경'))
    expect(second.onImport).toHaveBeenCalledWith('image')
  })

  it('다시 누르면 접힌다', () => {
    renderMenu()
    fireEvent.click(screen.getByText('가져오기'))
    expect(screen.getByText('📄 PDF 도면')).toBeTruthy()
    fireEvent.click(screen.getByText('가져오기'))
    expect(screen.queryByText('📄 PDF 도면')).toBeNull()
  })

  it('가져오기와 내보내기는 동시에 안 열린다', () => {
    // 둘이 겹쳐 뜨면 어느 쪽 항목인지 알 수 없다.
    renderMenu()
    fireEvent.click(screen.getByText('가져오기'))
    expect(screen.getByText('📄 PDF 도면')).toBeTruthy()

    fireEvent.click(screen.getByText('내보내기'))
    expect(screen.getByText('📐 DXF 내보내기')).toBeTruthy()
    expect(screen.queryByText('📄 PDF 도면')).toBeNull()
  })
})
