/**
 * 충돌 백업 테스트
 *
 * 핵심은 'failed' 를 제대로 돌려주는 것. 호출부(App.tsx)는 'failed' 면
 * 서버 덮어쓰기를 포기하므로, 여기서 잘못 'saved' 를 주면 상대 작업이
 * 그대로 사라진다 — 예전 코드가 하던 바로 그 일.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  backupServerSnapshot,
  conflictBackupLabel,
  type ConflictBackupDeps,
} from '../../lib/conflictBackup'

const SNAP = { store: { 'shape:1': {} } }
const SERVER_AT = '2026-10-02T09:54:00.000Z'

/** 정상 동작하는 localStorage 를 흉내낸 deps */
function okDeps(overrides: Partial<ConflictBackupDeps> = {}): ConflictBackupDeps {
  const stored = new Map<string, object>()
  let n = 0
  return {
    loadRemote: vi.fn(async () => ({ snapshot: SNAP })),
    saveVersion: vi.fn((_p: string, snapshot: object) => {
      const id = `v${++n}`
      stored.set(id, snapshot)
      return { id }
    }),
    getVersion: vi.fn((_p: string, id: string) => stored.get(id) ?? null),
    ...overrides,
  }
}

describe('backupServerSnapshot', () => {
  it('서버 스냅샷을 버전으로 저장하고 saved 를 반환한다', async () => {
    const deps = okDeps()
    const r = await backupServerSnapshot('p1', SERVER_AT, undefined, deps)

    expect(r).toBe('saved')
    expect(deps.saveVersion).toHaveBeenCalledTimes(1)
    const [projectId, snapshot, label] = vi.mocked(deps.saveVersion).mock.calls[0]
    expect(projectId).toBe('p1')
    expect(snapshot).toEqual(SNAP)          // 내 것이 아니라 **서버** 내용
    expect(label).toContain('충돌 백업')
  })

  it('같은 서버 타임스탬프는 다시 백업하지 않는다', async () => {
    // 상대가 계속 저장하면 5초마다 충돌이 난다. 그때마다 같은 내용을 쌓으면
    // 버전 30개 한도에 걸려 진짜 버전들이 밀려난다.
    const deps = okDeps()
    const r = await backupServerSnapshot('p1', SERVER_AT, SERVER_AT, deps)

    expect(r).toBe('duplicate')             // 덮어써도 되지만 백업은 생략
    expect(deps.loadRemote).not.toHaveBeenCalled()
    expect(deps.saveVersion).not.toHaveBeenCalled()
  })

  it('localStorage 가 꽉 차서 조용히 안 써지면 failed', async () => {
    // scopedSet 이 quota 예외를 삼키므로 saveVersion 은 성공한 척 반환한다.
    // 읽어서 확인하는 것만이 이걸 잡아낸다.
    const deps = okDeps({ getVersion: vi.fn(() => null) })
    const r = await backupServerSnapshot('p1', SERVER_AT, undefined, deps)

    expect(r).toBe('failed')
  })

  it('서버 스냅샷을 못 읽으면 failed', async () => {
    const deps = okDeps({ loadRemote: vi.fn(async () => null) })
    expect(await backupServerSnapshot('p1', SERVER_AT, undefined, deps)).toBe('failed')

    const empty = okDeps({ loadRemote: vi.fn(async () => ({ snapshot: null })) })
    expect(await backupServerSnapshot('p1', SERVER_AT, undefined, empty)).toBe('failed')
  })

  it('서버 조회가 throw 하면 failed', async () => {
    const deps = okDeps({ loadRemote: vi.fn(async () => { throw new Error('network') }) })
    expect(await backupServerSnapshot('p1', SERVER_AT, undefined, deps)).toBe('failed')
  })

  it('saveVersion 이 throw 해도 failed', async () => {
    const deps = okDeps({ saveVersion: vi.fn(() => { throw new Error('quota') }) })
    expect(await backupServerSnapshot('p1', SERVER_AT, undefined, deps)).toBe('failed')
  })

  it('서버 타임스탬프가 깨져 있으면 failed', async () => {
    const deps = okDeps()
    expect(await backupServerSnapshot('p1', 'not-a-date', undefined, deps)).toBe('failed')
    expect(deps.saveVersion).not.toHaveBeenCalled()
  })

  it('타임스탬프가 없어도 백업은 한다 (중복 판정만 못 함)', async () => {
    const deps = okDeps()
    expect(await backupServerSnapshot('p1', undefined, SERVER_AT, deps)).toBe('saved')
    expect(deps.saveVersion).toHaveBeenCalledTimes(1)
  })
})

describe('conflictBackupLabel', () => {
  it('월/일 시:분 으로 구분 가능한 라벨', () => {
    const label = conflictBackupLabel(new Date(2026, 9, 2, 9, 7))
    expect(label).toBe('충돌 백업 — 다른 기기 (10/2 09:07)')
  })
})
