import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getThreads, rawThreads, addThread, addReply, setResolved, moveThread, deleteThread,
  threadsOnPage,
  unresolvedCount, authorName, rememberAuthor, CommentLimitError,
  initialOf, pinColor, formatWhen,
  MAX_THREADS, MAX_MESSAGES_PER_THREAD, MAX_TEXT,
  type CommentThread,
} from '../../lib/commentStore'
import { getScaleConfig, setScaleConfig } from '../../lib/scaleConfig'

/**
 * scaleConfig 테스트와 같은 목 — 문서 meta 한 칸 + 장 몇 개.
 *
 * `pages` 의 **첫 번째**가 첫 장이다. 장 없는 옛 글타래가 어디로 가는지를
 * 보려면 그게 필요하다.
 */
function fakeEditor(
  doc: Record<string, unknown> = {},
  pages: string[] = ['page:main'],
  current = pages[0],
) {
  const settings = { gridSize: 10, name: '', meta: doc }
  let cur = current
  return {
    editor: {
      getDocumentSettings: () => settings,
      updateDocumentSettings: (p: { meta?: Record<string, unknown> }) => {
        if (p.meta) settings.meta = p.meta
      },
      getInstanceState: () => ({ meta: {} }),
      getCurrentPageId: () => cur,
      getPages: () => pages.map(id => ({ id })),
    } as never,
    settings,
    goTo(id: string) { cur = id },
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('commentStore — 어디에 사는가', () => {
  it('문서 meta 에 쓴다 — 도형이 아니라', () => {
    // 도형이면 DXF·PNG·리포트에 섞여 나가고 Ctrl+A → Delete 에 쓸려간다.
    const { editor, settings } = fakeEditor()
    addThread(editor, { x: 10, y: 20 }, '한', '여기 확인')
    expect(Array.isArray(settings.meta.comments)).toBe(true)
    expect((settings.meta.comments as CommentThread[])[0].x).toBe(10)
  })

  it('축척과 같은 칸을 나눠 써도 서로를 지우지 않는다', () => {
    // 이게 깨지면 코멘트 하나 달 때 축척이 사라진다 — 조용히, 다음에 도면을
    // 열 때까지. 치수 숫자가 통째로 달라진다.
    const { editor } = fakeEditor()
    setScaleConfig(editor, { pxPerMm: 0.02, unit: 'm' })
    addThread(editor, { x: 1, y: 2 }, '한', '안녕')
    expect(getScaleConfig(editor)).toEqual({ pxPerMm: 0.02, unit: 'm' })

    setScaleConfig(editor, { unit: 'cm' })
    expect(getThreads(editor)).toHaveLength(1)
  })

  it('남의 키도 지우지 않는다', () => {
    const { editor, settings } = fakeEditor({ 남의것: 1 })
    addThread(editor, { x: 0, y: 0 }, '한', '글')
    expect(settings.meta.남의것).toBe(1)
  })
})

describe('commentStore — 어느 장의 것인가', () => {
  const msg = [{ text: '글' }]

  it('핀을 찍으면 지금 장이 적힌다', () => {
    const { editor } = fakeEditor({}, ['page:a', 'page:b'], 'page:b')
    expect(addThread(editor, { x: 0, y: 0 }, '한', '글').pageId).toBe('page:b')
  })

  it('다른 장의 핀은 안 보인다 — 1장 핀이 2장에 뜨면 안 된다', () => {
    const { editor, goTo } = fakeEditor({
      comments: [
        { id: 'a', pageId: 'page:a', x: 0, y: 0, messages: msg },
        { id: 'b', pageId: 'page:b', x: 0, y: 0, messages: msg },
      ],
    }, ['page:a', 'page:b'], 'page:a')

    expect(threadsOnPage(editor).map(t => t.id)).toEqual(['a'])
    goTo('page:b')
    expect(threadsOnPage(editor).map(t => t.id)).toEqual(['b'])
  })

  it('장이 안 적힌 옛 글타래는 **첫 장**의 것이다', () => {
    // 모든 장에 띄우면 같은 코멘트가 장마다 복제돼 보이고, 아무 데도 안
    // 띄우면 쓴 글이 사라진 것처럼 보인다.
    const { editor, goTo } = fakeEditor({
      comments: [{ id: 'old', x: 0, y: 0, messages: msg }],
    }, ['page:a', 'page:b'], 'page:a')

    expect(threadsOnPage(editor).map(t => t.id)).toEqual(['old'])
    goTo('page:b')
    expect(threadsOnPage(editor)).toEqual([])
  })

  it('장 개념이 없는 얕은 목에서는 전부 보여준다', () => {
    const settings = { gridSize: 10, name: '', meta: { comments: [{ id: 'a', x: 0, y: 0, messages: msg }] } }
    const shallow = {
      getDocumentSettings: () => settings,
      updateDocumentSettings: () => {},
    } as never
    expect(threadsOnPage(shallow)).toHaveLength(1)
  })
})

describe('commentStore — 읽는 값을 믿지 않는다', () => {
  // 공유 링크(URL hash)를 타고 들어올 수 있는 값이다.

  it('배열이 아니면 빈 목록', () => {
    for (const bad of [undefined, null, 0, 'x', { a: 1 }]) {
      expect(getThreads(fakeEditor({ comments: bad }).editor)).toEqual([])
    }
  })

  it('깨진 글타래 **하나만** 버린다', () => {
    const good = { id: 'a', x: 1, y: 2, resolved: false, messages: [{ id: 'm', author: '한', text: '좋음', ts: 5 }] }
    const { editor } = fakeEditor({ comments: [{ 쓰레기: true }, good, null] })
    const got = getThreads(editor)
    expect(got).toHaveLength(1)
    expect(got[0].id).toBe('a')
  })

  it('자리가 없거나 NaN 이면 버린다 — 화면에 NaN 으로 떠 있는 것보다 낫다', () => {
    const msg = [{ id: 'm', author: '한', text: 't', ts: 1 }]
    const { editor } = fakeEditor({
      comments: [
        { id: 'a', y: 1, messages: msg },
        { id: 'b', x: NaN, y: 1, messages: msg },
        { id: 'c', x: 1, y: Infinity, messages: msg },
      ],
    })
    expect(getThreads(editor)).toEqual([])
  })

  it('빈 글타래는 글타래가 아니다', () => {
    const { editor } = fakeEditor({ comments: [{ id: 'a', x: 0, y: 0, messages: [] }] })
    expect(getThreads(editor)).toEqual([])
  })

  it('공백뿐인 글은 버린다', () => {
    const { editor } = fakeEditor({
      comments: [{ id: 'a', x: 0, y: 0, messages: [{ text: '   ' }, { text: '진짜' }] }],
    })
    const got = getThreads(editor)
    expect(got[0].messages).toHaveLength(1)
    expect(got[0].messages[0].text).toBe('진짜')
  })

  it('시각이 없으면 0 이다 — 지금으로 지어내지 않는다', () => {
    // 지금 시각을 넣으면 1년 전 코멘트가 전부 "방금" 으로 보인다.
    const { editor } = fakeEditor({ comments: [{ id: 'a', x: 0, y: 0, messages: [{ text: '글' }] }] })
    expect(getThreads(editor)[0].messages[0].ts).toBe(0)
  })

  it('이름이 없으면 익명', () => {
    const { editor } = fakeEditor({ comments: [{ id: 'a', x: 0, y: 0, messages: [{ text: '글' }] }] })
    expect(getThreads(editor)[0].messages[0].author).toBe('익명')
  })

  it('resolved 는 true 일 때만 true (문자열 "false" 에 속지 않는다)', () => {
    const msg = [{ text: '글' }]
    const { editor } = fakeEditor({
      comments: [
        { id: 'a', x: 0, y: 0, resolved: 'false', messages: msg },
        { id: 'b', x: 0, y: 0, resolved: true, messages: msg },
      ],
    })
    expect(getThreads(editor).map(t => t.resolved)).toEqual([false, true])
  })

  it('긴 글과 많은 답글은 읽을 때 잘린다', () => {
    const messages = Array.from({ length: MAX_MESSAGES_PER_THREAD + 50 }, (_, i) => ({ text: `글${i}` }))
    messages[0].text = 'ㄱ'.repeat(MAX_TEXT + 500)
    const { editor } = fakeEditor({ comments: [{ id: 'a', x: 0, y: 0, messages }] })
    const got = getThreads(editor)[0]
    expect(got.messages).toHaveLength(MAX_MESSAGES_PER_THREAD)
    expect(got.messages[0].text).toHaveLength(MAX_TEXT)
  })

  it('글타래 수도 상한에서 잘린다', () => {
    const comments = Array.from({ length: MAX_THREADS + 10 }, (_, i) => ({
      id: `t${i}`, x: i, y: 0, messages: [{ text: '글' }],
    }))
    expect(getThreads(fakeEditor({ comments }).editor)).toHaveLength(MAX_THREADS)
  })
})

describe('commentStore — 쓰기', () => {
  it('답글이 순서대로 쌓인다', () => {
    const { editor } = fakeEditor()
    const t = addThread(editor, { x: 0, y: 0 }, '한', '첫 글')
    addReply(editor, t.id, '아스카', '답글1')
    addReply(editor, t.id, '한', '답글2')
    expect(getThreads(editor)[0].messages.map(m => m.text)).toEqual(['첫 글', '답글1', '답글2'])
  })

  it('없는 글타래에 답글을 달면 아무 일도 안 난다', () => {
    const { editor } = fakeEditor()
    addThread(editor, { x: 0, y: 0 }, '한', '글')
    addReply(editor, '없는id', '한', '답글')
    expect(getThreads(editor)[0].messages).toHaveLength(1)
  })

  it('해결 토글 · 삭제', () => {
    const { editor } = fakeEditor()
    const a = addThread(editor, { x: 0, y: 0 }, '한', 'A')
    const b = addThread(editor, { x: 5, y: 5 }, '한', 'B')
    setResolved(editor, a.id, true)
    expect(unresolvedCount(getThreads(editor))).toBe(1)

    deleteThread(editor, b.id)
    expect(getThreads(editor).map(t => t.id)).toEqual([a.id])
  })

  it('핀을 옮기면 page 좌표가 바뀐다', () => {
    const { editor } = fakeEditor()
    const t = addThread(editor, { x: 0, y: 0 }, '한', '글')
    moveThread(editor, t.id, { x: 100, y: -40 })
    expect(getThreads(editor)[0]).toMatchObject({ x: 100, y: -40 })
  })

  it('NaN 자리로는 안 옮긴다', () => {
    const { editor } = fakeEditor()
    const t = addThread(editor, { x: 7, y: 8 }, '한', '글')
    moveThread(editor, t.id, { x: NaN, y: 0 })
    expect(getThreads(editor)[0]).toMatchObject({ x: 7, y: 8 })
  })

  it('상한에 닿으면 **막는다** — 조용히 자르지 않는다', () => {
    // 자르면 방금 쓴 글이 사라진다. 그 쪽이 더 나쁘다.
    const comments = Array.from({ length: MAX_THREADS }, (_, i) => ({
      id: `t${i}`, x: i, y: 0, messages: [{ text: '글' }],
    }))
    const { editor } = fakeEditor({ comments })
    expect(() => addThread(editor, { x: 0, y: 0 }, '한', '하나 더')).toThrow(CommentLimitError)

    const one = fakeEditor({
      comments: [{
        id: 'a', x: 0, y: 0,
        messages: Array.from({ length: MAX_MESSAGES_PER_THREAD }, () => ({ text: '글' })),
      }],
    })
    expect(() => addReply(one.editor, 'a', '한', '하나 더')).toThrow(CommentLimitError)
  })

  it('쓴 글이 상한보다 길면 잘라서 저장한다', () => {
    const { editor } = fakeEditor()
    addThread(editor, { x: 0, y: 0 }, '한', 'ㄱ'.repeat(MAX_TEXT + 100))
    expect(getThreads(editor)[0].messages[0].text).toHaveLength(MAX_TEXT)
  })
})

describe('rawThreads', () => {
  it('안 바뀌면 같은 참조를 돌려준다 — 화면이 헛돌지 않게', () => {
    // 카메라만 움직여도 store 는 울린다. 그때마다 500 개를 거르면 팬이 뻑뻑해진다.
    const { editor } = fakeEditor()
    addThread(editor, { x: 0, y: 0 }, '한', '글')
    const before = rawThreads(editor)
    expect(rawThreads(editor)).toBe(before)

    addThread(editor, { x: 1, y: 1 }, '한', '글2')
    expect(rawThreads(editor)).not.toBe(before)
  })

  it('축척만 바꾸면 코멘트 참조는 그대로다', () => {
    const { editor } = fakeEditor()
    addThread(editor, { x: 0, y: 0 }, '한', '글')
    const before = rawThreads(editor)
    setScaleConfig(editor, { unit: 'cm' })
    expect(rawThreads(editor)).toBe(before)
  })
})

describe('authorName', () => {
  it('로그인 이름이 먼저', () => {
    rememberAuthor('현장메모이름')
    expect(authorName('한')).toBe('한')
  })

  it('로그인 이름이 없으면 현장 메모에 쓰던 그 이름', () => {
    // 같은 칸(CHAT_AUTHOR_KEY)을 쓴다 — 채팅에서 "김반장" 이라 쓴 사람이
    // 코멘트에서 "익명" 으로 나오면 같은 사람인 줄 모른다.
    rememberAuthor('김반장')
    expect(authorName(undefined)).toBe('김반장')
    expect(authorName('   ')).toBe('김반장')
  })

  it('아무 데도 없으면 익명', () => {
    expect(authorName(undefined)).toBe('익명')
  })
})

describe('보여주는 쪽', () => {
  it('시각이 없으면 아무것도 안 쓴다 — 1970년도, "방금" 도 아니다', () => {
    expect(formatWhen(0)).toBe('')
  })

  it('방금 · 분 · 시간', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
    expect(formatWhen(Date.now() - 30_000)).toBe('방금')
    expect(formatWhen(Date.now() - 5 * 60_000)).toBe('5분 전')
    expect(formatWhen(Date.now() - 3 * 3_600_000)).toBe('3시간 전')
    expect(formatWhen(Date.now() - 3 * 86_400_000)).toMatch(/10/)
    vi.useRealTimers()
  })

  it('같은 이름이면 늘 같은 색·같은 글자다 — 핀과 목록이 어긋나지 않게', () => {
    expect(pinColor('김반장')).toBe(pinColor('김반장'))
    expect(pinColor('김반장')).not.toBe(pinColor('이기사'))
    expect(initialOf(' 한 ')).toBe('한')
    expect(initialOf('')).toBe('?')
  })
})
