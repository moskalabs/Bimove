/**
 * 읽기 전용에서는 코멘트를 **보기만** 한다.
 *
 * 이걸 테스트로 박는 이유가 있다. 쓰기 손잡이는 여러 군데에 흩어져 있고
 * (패널의 +, 줄마다의 해결 ✓, 창의 해결·삭제·답글, 핀 끌기), 하나만
 * 빠뜨려도 **그 하나는 눌린다.** 그러면 읽기 전용 경로가 엔진으로 바뀌는 날
 * 조용히 안 되기 시작한다 — 쓰던 사람에게는 기능이 사라진 것이다.
 *
 * 왜 닫았는지는 CommentOverlay 머리말에 있다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReadonlyContext } from '../../context/ReadonlyContext'
import { EditorContext } from '../../context/EditorContext'
import { CommentsPanel } from '../../components/panels/CommentsPanel'

/** 글타래 둘 — 하나는 열려 있고 하나는 해결됨. */
const COMMENTS = [
  {
    id: 'a', pageId: 'page:main', x: 10, y: 20, resolved: false,
    messages: [{ id: 'm1', author: '김반장', text: '여기 확인', ts: 0 }],
  },
  {
    id: 'b', pageId: 'page:main', x: 30, y: 40, resolved: true,
    messages: [{ id: 'm2', author: '이기사', text: '끝', ts: 0 }],
  },
]

function fakeEditor() {
  const settings = { gridSize: 10, name: '', meta: { comments: COMMENTS } }
  return {
    getDocumentSettings: () => settings,
    updateDocumentSettings: vi.fn(),
    getCurrentPageId: () => 'page:main',
    getPages: () => [{ id: 'page:main' }],
    store: { listen: () => () => {} },
  } as never
}

function mount(readonly: boolean) {
  return render(
    <ReadonlyContext.Provider value={readonly}>
      <EditorContext.Provider value={fakeEditor()}>
        <CommentsPanel />
      </EditorContext.Provider>
    </ReadonlyContext.Provider>,
  )
}

beforeEach(() => { localStorage.clear() })

describe('CommentsPanel — 읽기 전용', () => {
  it('편집 화면에서는 달기·해결이 있다', () => {
    mount(false)
    expect(screen.getByTitle('코멘트 남기기')).toBeTruthy()
    expect(screen.getAllByTitle(/해결|다시 열기/).length).toBeGreaterThan(0)
  })

  it('읽기 전용에서는 **달기 버튼이 없다**', () => {
    mount(true)
    expect(screen.queryByTitle('코멘트 남기기')).toBeNull()
    expect(screen.queryByTitle('찍기 취소')).toBeNull()
  })

  it('읽기 전용에서는 **해결 토글이 없다**', () => {
    mount(true)
    expect(screen.queryAllByTitle(/^해결$|다시 열기/)).toHaveLength(0)
  })

  it('그래도 **목록은 읽힌다** — 보기까지 막으면 안 된다', () => {
    mount(true)
    expect(screen.getByText('여기 확인')).toBeTruthy()
    expect(screen.getByText('김반장')).toBeTruthy()
  })

  it("'해결된 것 보기' 는 보기 쪽이라 남는다", () => {
    mount(true)
    // 해결된 글타래가 하나 있으므로 토글이 떠야 한다.
    expect(screen.getByText(/해결된 것 1개 보기/)).toBeTruthy()
  })

  it('비어 있을 때의 안내가 화면마다 다르다', () => {
    const empty = { gridSize: 10, name: '', meta: { comments: [] } }
    const ed = {
      getDocumentSettings: () => empty,
      updateDocumentSettings: vi.fn(),
      getCurrentPageId: () => 'page:main',
      getPages: () => [{ id: 'page:main' }],
      store: { listen: () => () => {} },
    } as never
    const view = (readonly: boolean) => render(
      <ReadonlyContext.Provider value={readonly}>
        <EditorContext.Provider value={ed}><CommentsPanel /></EditorContext.Provider>
      </ReadonlyContext.Provider>,
    )
    // 읽기 전용에서 "위 + 를 누르고" 라고 하면 **없는 버튼을 가리킨다.**
    const ro = view(true)
    expect(ro.container.textContent).toContain('편집 화면에서')
    expect(ro.container.textContent).not.toContain('+ 를 누르고')
    ro.unmount()

    const rw = view(false)
    expect(rw.container.textContent).toContain('+ 를 누르고')
  })
})
