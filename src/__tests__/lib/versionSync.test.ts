import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listMergedVersions, pushVersion, type VersionSyncDeps } from '../../lib/versionSync'
import type { Version, VersionMeta } from '../../lib/versions'

// 목록 단계의 로컬 항목은 메타뿐이다 — 스냅샷 본문은 복원할 때 따로 읽는다.
const local = (id: string, ts: number, label?: string): VersionMeta => ({
  id, timestamp: ts, label,
})

const remote = (id: string, ts: number, label?: string) => ({ id, timestamp: ts, label })

function deps(over: Partial<VersionSyncDeps> = {}): VersionSyncDeps {
  return {
    listLocal: async () => [],
    fetchRemoteMetas: async () => [],
    ...over,
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('listMergedVersions', () => {
  it('로컬만 있으면 로컬만 돌려준다', async () => {
    const r = await listMergedVersions('p1', deps({ listLocal: async () => [local('a', 200)] }))
    expect(r.versions).toHaveLength(1)
    expect(r.versions[0]).toMatchObject({ id: 'a', local: true, remote: false })
    // 목록에는 본문을 싣지 않는다 (수십 MB 를 패널 여는 것만으로 읽지 않기 위해)
    expect(r.versions[0].snapshot).toBeNull()
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
      listLocal: async () => [local('a', 200)],
      fetchRemoteMetas: async () => [remote('a', 200)],
    }))
    expect(r.versions).toHaveLength(1)
    expect(r.versions[0]).toMatchObject({ id: 'a', local: true, remote: true })
    // 양쪽에 있어도 본문은 안 싣는다. 복원할 때 local 플래그를 보고
    // 로컬(getVersion)이냐 서버냐를 고른다.
    expect(r.versions[0].snapshot).toBeNull()
  })

  it('라벨이 갈리면 로컬 쪽을 쓴다', async () => {
    const r = await listMergedVersions('p1', deps({
      listLocal: async () => [local('a', 200, '로컬이름')],
      fetchRemoteMetas: async () => [remote('a', 200, '서버이름')],
    }))
    expect(r.versions[0].label).toBe('로컬이름')
  })

  it('최신순으로 정렬한다 (로컬/서버 섞여도)', async () => {
    const r = await listMergedVersions('p1', deps({
      listLocal: async () => [local('a', 100), local('c', 300)],
      fetchRemoteMetas: async () => [remote('b', 200), remote('d', 400)],
    }))
    expect(r.versions.map(v => v.id)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('서버 조회가 실패해도 로컬 목록은 그대로 돌려준다', async () => {
    const r = await listMergedVersions('p1', deps({
      listLocal: async () => [local('a', 200)],
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
      listLocal: async () => [local('a', 200)],
      fetchRemoteMetas: async () => [remote('bad', NaN), remote('ok', 300)],
    }))
    expect(r.versions.map(v => v.id)).toEqual(['ok', 'a'])
  })

  it('timestamp 가 NaN 인 로컬 버전도 뺀다', async () => {
    const r = await listMergedVersions('p1', deps({
      listLocal: async () => [local('bad', NaN), local('ok', 100)],
    }))
    expect(r.versions.map(v => v.id)).toEqual(['ok'])
  })

  it('projectId 를 양쪽에 그대로 넘긴다', async () => {
    const listLocal = vi.fn(async () => [])
    const fetchRemoteMetas = vi.fn(async () => [])
    await listMergedVersions('proj-42', { listLocal, fetchRemoteMetas })
    expect(listLocal).toHaveBeenCalledWith('proj-42')
    expect(fetchRemoteMetas).toHaveBeenCalledWith('proj-42')
  })
})

describe('pushVersion', () => {
  // 서버로 올릴 때는 본문이 있어야 한다 — 거긴 메타만 보내봐야 쓸 데가 없다.
  const full = (id: string, ts: number): Version => ({
    id, timestamp: ts, snapshot: { store: {}, schema: {} },
  })

  it('성공하면 true', async () => {
    const insert = vi.fn(async () => {})
    await expect(pushVersion('p1', full('a', 1), insert)).resolves.toBe(true)
    expect(insert).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'a' }))
  })

  it('실패해도 throw 하지 않고 false', async () => {
    const insert = vi.fn(async () => { throw new Error('rls denied') })
    await expect(pushVersion('p1', full('a', 1), insert)).resolves.toBe(false)
  })
})
