import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import type { Version } from '../../lib/versions'

// 로컬 저장소와 서버를 둘 다 가짜로 둔다 — 이 테스트가 보려는 건
// "두 출처를 합쳐서 보여주는가" 이고, localStorage/네트워크는 그 수단이다.
const listVersions = vi.fn<(projectId: string) => Version[]>(() => [])
const deleteVersion = vi.fn()
const renameVersion = vi.fn()
vi.mock('../../lib/versions', () => ({
  listVersions: (p: string) => listVersions(p),
  deleteVersion: (...a: unknown[]) => deleteVersion(...a),
  renameVersion: (...a: unknown[]) => renameVersion(...a),
}))

const fetchProjectVersionMetas = vi.fn<(p: string) => Promise<{ id: string; timestamp: number; label?: string }[]>>(async () => [])
const fetchProjectVersionSnapshot = vi.fn<(id: string) => Promise<object | null>>(async () => ({ store: {}, from: 'server' }))
const deleteProjectVersion = vi.fn<(id: string) => Promise<void>>(async () => {})
const renameProjectVersion = vi.fn<(id: string, label: string | null) => Promise<void>>(async () => {})
vi.mock('../../lib/supabaseSync', () => ({
  fetchProjectVersionMetas: (p: string) => fetchProjectVersionMetas(p),
  fetchProjectVersionSnapshot: (id: string) => fetchProjectVersionSnapshot(id),
  deleteProjectVersion: (id: string) => deleteProjectVersion(id),
  renameProjectVersion: (id: string, label: string | null) => renameProjectVersion(id, label),
}))

const { VersionHistoryPanel } = await import('../../components/VersionHistoryPanel')

const loadSnapshot = vi.fn()
const editor = { store: { loadSnapshot } } as never

const localVersion = (id: string, ts: number, label?: string): Version => ({
  id, timestamp: ts, label, snapshot: { store: {}, from: 'local' },
})

function renderPanel(onClose = vi.fn()) {
  return render(<VersionHistoryPanel editor={editor} projectId="p1" onClose={onClose} />)
}

beforeEach(() => {
  vi.stubGlobal('confirm', () => true)
  vi.stubGlobal('alert', vi.fn())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  listVersions.mockReturnValue([])
  fetchProjectVersionMetas.mockResolvedValue([])
  fetchProjectVersionSnapshot.mockResolvedValue({ store: {}, from: 'server' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('VersionHistoryPanel', () => {
  it('서버에만 있는 버전도 목록에 보인다', async () => {
    fetchProjectVersionMetas.mockResolvedValue([{ id: 's1', timestamp: 1_700_000_000_000, label: '서버에서저장' }])
    renderPanel()
    expect(await screen.findByText('서버에서저장')).toBeTruthy()
    expect(screen.getByText('서버')).toBeTruthy()
  })

  it('로컬에만 있는 버전은 "이 기기" 로 표시한다', async () => {
    listVersions.mockReturnValue([localVersion('a', 1_700_000_000_000, '로컬만')])
    renderPanel()
    expect(await screen.findByText('로컬만')).toBeTruthy()
    expect(screen.getByText('이 기기')).toBeTruthy()
  })

  it('양쪽에 있는 버전은 한 줄로 "동기화" 로 표시한다', async () => {
    listVersions.mockReturnValue([localVersion('a', 1_700_000_000_000, '같은것')])
    fetchProjectVersionMetas.mockResolvedValue([{ id: 'a', timestamp: 1_700_000_000_000, label: '같은것' }])
    renderPanel()
    expect(await screen.findByText('동기화')).toBeTruthy()
    expect(screen.getAllByText('같은것')).toHaveLength(1)
  })

  it('목록을 열 때 서버 스냅샷을 미리 받지 않는다 (하나가 수 MB)', async () => {
    fetchProjectVersionMetas.mockResolvedValue([
      { id: 's1', timestamp: 1_700_000_000_000, label: 'A' },
      { id: 's2', timestamp: 1_700_000_001_000, label: 'B' },
    ])
    renderPanel()
    expect(await screen.findByText('A')).toBeTruthy()
    expect(fetchProjectVersionSnapshot).not.toHaveBeenCalled()
  })

  it('서버 목록을 못 받으면 경고를 띄우고 로컬 목록은 그대로 보여준다', async () => {
    listVersions.mockReturnValue([localVersion('a', 1_700_000_000_000, '로컬것')])
    fetchProjectVersionMetas.mockRejectedValue(new Error('offline'))
    renderPanel()
    expect(await screen.findByText(/서버 버전을 불러오지 못했습니다/)).toBeTruthy()
    expect(screen.getByText('로컬것')).toBeTruthy()
  })

  it('서버 버전을 복원하면 그때 스냅샷을 받아온다', async () => {
    fetchProjectVersionMetas.mockResolvedValue([{ id: 's1', timestamp: 1_700_000_000_000, label: '서버것' }])
    renderPanel()
    await screen.findByText('서버것')
    fireEvent.click(screen.getByText('복원'))
    await waitFor(() => expect(fetchProjectVersionSnapshot).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(loadSnapshot).toHaveBeenCalledWith({ store: {}, from: 'server' }))
  })

  it('서버 버전을 삭제하면 서버에서도 지운다 (안 지우면 다시 나타난다)', async () => {
    fetchProjectVersionMetas.mockResolvedValue([{ id: 's1', timestamp: 1_700_000_000_000, label: '서버것' }])
    renderPanel()
    await screen.findByText('서버것')
    fireEvent.click(screen.getByText('삭제'))
    await waitFor(() => expect(deleteProjectVersion).toHaveBeenCalledWith('s1'))
  })

  it('양쪽에 있는 버전을 삭제하면 로컬과 서버 둘 다 지운다', async () => {
    listVersions.mockReturnValue([localVersion('a', 1_700_000_000_000, '같은것')])
    fetchProjectVersionMetas.mockResolvedValue([{ id: 'a', timestamp: 1_700_000_000_000, label: '같은것' }])
    renderPanel()
    await screen.findByText('같은것')
    fireEvent.click(screen.getByText('삭제'))
    await waitFor(() => expect(deleteProjectVersion).toHaveBeenCalledWith('a'))
    expect(deleteVersion).toHaveBeenCalledWith('p1', 'a')
  })

  it('로컬 전용 버전을 삭제하면 서버는 건드리지 않는다', async () => {
    listVersions.mockReturnValue([localVersion('a', 1_700_000_000_000, '로컬만')])
    renderPanel()
    await screen.findByText('로컬만')
    fireEvent.click(screen.getByText('삭제'))
    await waitFor(() => expect(deleteVersion).toHaveBeenCalledWith('p1', 'a'))
    expect(deleteProjectVersion).not.toHaveBeenCalled()
  })

  it('서버 버전의 이름을 고치면 서버에도 쓴다', async () => {
    fetchProjectVersionMetas.mockResolvedValue([{ id: 's1', timestamp: 1_700_000_000_000, label: '옛이름' }])
    renderPanel()
    const name = await screen.findByText('옛이름')
    fireEvent.doubleClick(name)
    const input = screen.getByDisplayValue('옛이름')
    fireEvent.change(input, { target: { value: '새이름' } })
    fireEvent.blur(input)
    await waitFor(() => expect(renameProjectVersion).toHaveBeenCalledWith('s1', '새이름'))
  })

  it('버전이 하나도 없으면 빈 상태를 보여준다', async () => {
    renderPanel()
    expect(await screen.findByText(/아직 저장된 버전이 없어/)).toBeTruthy()
  })
})
