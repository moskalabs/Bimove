import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listMergedVersions, pushVersion, type VersionSyncDeps } from '../../lib/versionSync'
import type { Version } from '../../lib/versions'

const SNAP = { store: {}, schema: {} }

const local = (id: string, ts: number, label?: string): Version => ({
  id, timestamp: ts, label, snapshot: { ...SNAP, from: 'local', id },
})

const remote = (id: string, ts: number, label?: string) => ({ id, timestamp: ts, label })

function deps(over: Partial<VersionSyncDeps> = {}): VersionSyncDeps {
  return {
    listLocal: () => [],
    fetchRemoteMetas: async () => [],
    ...over,
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('listMergedVersions', () => {
  it('로컬만 있으면 로컬만 돌려준다', async () => {
    const r = await listMergedVersions('p1', deps({ listLocal: () => [local('a', 200)] }))
    expect(r.versions).toHaveLength(1)
    expect(r.versions[0]).toMatchObject({ id: 'a', local: true, remote: false })
    expect(r.versions[0].snapshot).not.toBeNull()
    expect(r.remoteError).toBeNull()
  })

  it('서버에만 있는 버전도 목록에 들어온다 (예전엔 안 보였다)', async () => {
    const r = await listMergedVersions('p1', deps({
      fetchRemoteMetas: async () => [remote('s1', 300, '서버저장')],
    }))
    expect(r.versions).toHaveLength(1)
    expect(r.versions[0]).toMatchObject({
      id: 's1', label: '서버저장', local: false, remote: true, snapshot: null,
    })
  })

  it('양쪽에 있는 같은 id 는 하나로 합친다', async () => {
    const r = await listMergedVersions('p1', deps({
      listLocal: () => [local('a', 200)],
      fetchRemoteMetas: async () => [remote('a', 200)],
    }))
    expect(r.versions).toHaveLength(1)
    expect(r.versions[0]).toMatchObject({ id: 'a', local: true, remote: true })
    // 스냅샷은 손에 있는 로컬 것을 쓴다 — 다시 내려받을 이유가 없다
    expect(r.versions[0].snapshot).toMatchObject({ from: 'local' })
  })

  it('라벨이 갈리면 로컬 쪽을 쓴다', async () => {
    const r = await listMergedVersions('p1', deps({
      listLocal: () => [local('a', 200, '로컬이름')],
      fetchRemoteMetas: async () => [remote('a', 200, '서버이름')],
    }))
    expect(r.versions[0].label).toBe('로컬이름')
  })

  it('최신순으로 정렬한다 (로컬/서버 섞여도)', async () => {
    const r = await listMergedVersions('p1', deps({
      listLocal: () => [local('a', 100), local('c', 300)],
      fetchRemoteMetas: async () => [remote('b', 200), remote('d', 400)],
    }))
    expect(r.versions.map(v => v.id)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('서버 조회가 실패해도 로컬 목록은 그대로 돌려준다', async () => {
    const r = await listMergedVersions('p1', deps({
      listLocal: () => [local('a', 200)],
      fetchRemoteMetas: async () => { throw new Error('network down') },
    }))
    expect(r.versions.map(v => v.id)).toEqual(['a'])
    expect(r.remoteError).toBe('network down')
  })

  it('서버 조회 실패를 조용히 삼키지 않는다', async () => {
    const r = await listMergedVersions('p1', deps({
      fetchRemoteMetas: async () => { throw new Error('boom') },
    }))
    expect(r.remoteError).not.toBeNull()
  })

  it('created_at 이 깨져 timestamp 가 NaN 인 서버 버전은 뺀다', async () => {
    const r = await listMergedVersions('p1', deps({
      listLocal: () => [local('a', 200)],
      fetchRemoteMetas: async () => [remote('bad', NaN), remote('ok', 300)],
    }))
    expect(r.versions.map(v => v.id)).toEqual(['ok', 'a'])
  })

  it('timestamp 가 NaN 인 로컬 버전도 뺀다', async () => {
    const r = await listMergedVersions('p1', deps({
      listLocal: () => [local('bad', NaN), local('ok', 100)],
    }))
    expect(r.versions.map(v => v.id)).toEqual(['ok'])
  })

  it('projectId 를 양쪽에 그대로 넘긴다', async () => {
    const listLocal = vi.fn(() => [])
    const fetchRemoteMetas = vi.fn(async () => [])
    await listMergedVersions('proj-42', { listLocal, fetchRemoteMetas })
    expect(listLocal).toHaveBeenCalledWith('proj-42')
    expect(fetchRemoteMetas).toHaveBeenCalledWith('proj-42')
  })
})

describe('pushVersion', () => {
  it('성공하면 true', async () => {
    const insert = vi.fn(async () => {})
    await expect(pushVersion('p1', local('a', 1), insert)).resolves.toBe(true)
    expect(insert).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'a' }))
  })

  it('실패해도 throw 하지 않고 false', async () => {
    const insert = vi.fn(async () => { throw new Error('rls denied') })
    await expect(pushVersion('p1', local('a', 1), insert)).resolves.toBe(false)
  })
})
