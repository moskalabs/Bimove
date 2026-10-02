/**
 * "불러온 파일이 사라진다" 회귀 테스트 — 로드 쪽
 *
 * 증상: CAD 를 불러오고 대시보드 갔다 다시 들어오면 캔버스가 비어 있다.
 * 원인 중 하나: 서버에 스냅샷이 있으면 무조건 서버를 썼다. 서버 쓰기가
 *       실패했거나(용량/네트워크/충돌) 5초 동기화 틱 전에 화면을 떠나면
 *       로컬에만 남은 최신 작업을 낡은 서버 스냅샷이 덮어썼다.
 * 이제 둘 중 더 최근 쪽을 쓴다 (resolveSnapshot).
 *
 * 로컬 타임스탬프는 touchProject() 가 올리고, 서버 updated_at 도 저장한
 * 클라이언트 시계로 찍히므로 그대로 비교할 수 있다.
 */
import { describe, it, expect } from 'vitest'
import {
  createProject, saveSnapshot, loadSnapshot,
  isLocalNewer, resolveSnapshot, getProjects,
} from '../../lib/projectStore'

/** 프로젝트의 updatedAt 을 특정 시각으로 강제 (touchProject 는 now 밖에 못 쓴다) */
function setLocalUpdatedAt(id: string, at: number) {
  const list = getProjects().map(p => p.id === id ? { ...p, updatedAt: at } : p)
  localStorage.setItem('bimova_projects_v1', JSON.stringify(list))
}

const iso = (ms: number) => new Date(ms).toISOString()

describe('isLocalNewer', () => {
  it('서버 타임스탬프가 없으면 로컬을 믿는다', () => {
    const p = createProject('ts 없음')
    expect(isLocalNewer(p.id, undefined)).toBe(true)
  })

  it('서버 타임스탬프를 파싱할 수 없으면 로컬을 믿는다', () => {
    const p = createProject('깨진 ts')
    expect(isLocalNewer(p.id, 'not-a-date')).toBe(true)
  })

  it('로컬 프로젝트 기록이 없으면 false (비교 불가 → 서버)', () => {
    expect(isLocalNewer('존재하지-않는-id', iso(Date.now()))).toBe(false)
  })

  it('로컬이 더 최근이면 true', () => {
    const p = createProject('로컬 최신')
    const now = Date.now()
    setLocalUpdatedAt(p.id, now)
    expect(isLocalNewer(p.id, iso(now - 60_000))).toBe(true)
  })

  it('서버가 더 최근이면 false', () => {
    const p = createProject('서버 최신')
    const now = Date.now()
    setLocalUpdatedAt(p.id, now - 60_000)
    expect(isLocalNewer(p.id, iso(now))).toBe(false)
  })

  it('1초 이내 차이는 같은 저장 라운드로 보고 서버를 쓴다', () => {
    const p = createProject('동시')
    const now = Date.now()
    setLocalUpdatedAt(p.id, now + 500)
    expect(isLocalNewer(p.id, iso(now))).toBe(false)
  })
})

describe('resolveSnapshot', () => {
  it('서버가 없으면 로컬을 쓴다', () => {
    const p = createProject('오프라인')
    expect(resolveSnapshot(p.id, null, { v: 'local' })).toEqual({ v: 'local' })
  })

  it('서버도 로컬도 없으면 null', () => {
    const p = createProject('빈 프로젝트')
    expect(resolveSnapshot(p.id, null, null)).toBeNull()
  })

  it('로컬이 없으면 서버를 쓴다 (다른 기기에서 작업한 경우)', () => {
    const p = createProject('새 기기')
    const server = { snapshot: { v: 'server' }, updatedAt: iso(Date.now()) }
    expect(resolveSnapshot(p.id, server, null)).toEqual({ v: 'server' })
  })

  it('평소에는 서버를 쓴다 (서버가 최신)', () => {
    const p = createProject('정상')
    const now = Date.now()
    setLocalUpdatedAt(p.id, now - 10_000)
    const server = { snapshot: { v: 'server' }, updatedAt: iso(now) }
    expect(resolveSnapshot(p.id, server, { v: 'local' })).toEqual({ v: 'server' })
  })

  // ── 이게 버그였다 ──
  it('로컬이 더 최신이면 낡은 서버 스냅샷으로 덮어쓰지 않는다', () => {
    const p = createProject('CAD 불러옴')
    const now = Date.now()
    // 서버에는 CAD 불러오기 전 스냅샷만 있고 (동기화 실패),
    // 로컬에는 불러온 직후 flush 된 스냅샷이 있다
    setLocalUpdatedAt(p.id, now)
    const server = { snapshot: { shapes: [] }, updatedAt: iso(now - 30_000) }
    const local = { shapes: [{ id: 'dxf-group-1' }] }
    expect(resolveSnapshot(p.id, server, local)).toEqual(local)
  })
})

describe('saveSnapshot 실패 보고', () => {
  it('저장에 성공하면 true', () => {
    const p = createProject('ok')
    expect(saveSnapshot(p.id, { v: 1 })).toBe(true)
    expect(loadSnapshot(p.id)).toEqual({ v: 1 })
  })

  it('용량 초과면 false — 조용히 삼키지 않는다', () => {
    const p = createProject('용량 초과')
    const original = localStorage.setItem
    localStorage.setItem = () => {
      const err = new Error('QuotaExceededError') as Error & { name: string }
      err.name = 'QuotaExceededError'
      throw err
    }
    try {
      expect(saveSnapshot(p.id, { big: 'x'.repeat(100) })).toBe(false)
    } finally {
      localStorage.setItem = original
    }
  })
})
