/**
 * 스냅샷 압축 저장 테스트
 *
 * 증상: 큰 도면을 열어두면 Supabase 가 CPU 94% 에 묶여 REST 요청이 전부 504 로
 * 떨어지고 로그인조차 안 됐다. 원인은 수 MB 짜리 tldraw 스냅샷을 jsonb 컬럼에
 * 5초마다 그대로 넣은 것 — jsonb 는 받을 때마다 파싱하고 TOAST 로 압축한다.
 *
 * 그래서 클라이언트에서 gzip 해 text 컬럼에 넣는다. 서버는 글자를 그대로 받아
 * 적기만 한다. 읽기는 **옛 jsonb 도 그대로 받아야 한다** — 이미 저장된
 * 프로젝트가 많아서, 배포하자마자 못 읽으면 도면이 사라진 것처럼 보인다.
 */
import { describe, it, expect } from 'vitest'
import { encodeSnapshot, decodeSnapshot, readSnapshotColumn } from '../../lib/snapshotCodec'

const hasCompression = typeof CompressionStream !== 'undefined'
  && typeof DecompressionStream !== 'undefined'
  && typeof ReadableStream !== 'undefined'

/** tldraw 스냅샷을 흉내낸, 반복이 많은(= 잘 압축되는) 객체. */
function fakeSnapshot(shapes: number) {
  const store: Record<string, unknown> = {}
  for (let i = 0; i < shapes; i++) {
    store[`shape:${i}`] = {
      typeName: 'shape', type: 'draw', parentId: 'page:page',
      x: i * 1.5, y: i * 2.25, rotation: 0, isLocked: false,
      props: { color: 'black', size: 'm', dash: 'draw', fill: 'none' },
    }
  }
  return { store, schema: { schemaVersion: 2, sequences: {} } }
}

describe.skipIf(!hasCompression)('encodeSnapshot / decodeSnapshot', () => {
  it('넣은 그대로 돌아온다', async () => {
    const snap = fakeSnapshot(50)
    expect(await decodeSnapshot(await encodeSnapshot(snap))).toEqual(snap)
  })

  it('한글·이모지가 깨지지 않는다', async () => {
    // TextEncoder/Decoder 를 거치므로 멀티바이트가 조각나면 여기서 드러난다.
    const snap = { name: '26.08.07_리닝 🌙', note: '가'.repeat(50_000) }
    expect(await decodeSnapshot(await encodeSnapshot(snap))).toEqual(snap)
  })

  it('실제로 많이 줄어든다 — 이게 이 코덱의 존재 이유다', async () => {
    const snap = fakeSnapshot(2000)
    const raw = JSON.stringify(snap).length
    const packed = (await encodeSnapshot(snap)).length
    expect(raw).toBeGreaterThan(200_000)
    // base64 가 33% 를 되붙여도 원본의 1/5 아래여야 한다
    expect(packed).toBeLessThan(raw / 5)
  })

  it('빈 스냅샷도 왕복한다', async () => {
    expect(await decodeSnapshot(await encodeSnapshot({}))).toEqual({})
  })
})

describe.skipIf(!hasCompression)('readSnapshotColumn', () => {
  it('압축본이 있으면 그걸 푼다', async () => {
    const snap = fakeSnapshot(10)
    const row = { snapshot: null, snapshot_gz: await encodeSnapshot(snap) }
    expect(await readSnapshotColumn(row)).toEqual(snap)
  })

  it('압축본이 없으면 옛 jsonb 를 그대로 쓴다 (배포 직후 호환)', async () => {
    const legacy = { store: { 'shape:a': { x: 1 } } }
    expect(await readSnapshotColumn({ snapshot: legacy })).toEqual(legacy)
  })

  it('둘 다 있으면 압축본이 이긴다', async () => {
    // 저장은 압축본에만 하고 옛 컬럼은 null 로 비운다. 그래도 과도기에
    // 둘 다 들어있는 행을 만날 수 있는데, 새 쪽이 최신이다.
    const fresh = { store: { 'shape:new': {} } }
    const row = { snapshot: { store: { 'shape:old': {} } }, snapshot_gz: await encodeSnapshot(fresh) }
    expect(await readSnapshotColumn(row)).toEqual(fresh)
  })

  it('둘 다 비었으면 null', async () => {
    expect(await readSnapshotColumn({ snapshot: null, snapshot_gz: null })).toBeNull()
    expect(await readSnapshotColumn(null)).toBeNull()
  })
})
