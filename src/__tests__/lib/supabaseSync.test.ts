/**
 * 스냅샷 저장의 optimistic lock 회귀 테스트.
 *
 * 두 가지 사고를 여기서 막는다.
 *
 * 1. **확인과 쓰기가 떨어져 있던 문제.** 예전엔 SELECT 로 updated_at 을 보고
 *    나서 UPDATE 를 따로 보냈다. 그 사이에 다른 세션이 저장하면 검사를 통과한
 *    채로 남의 작업을 덮어썼다. 이제 조건을 UPDATE 에 실어 보낸다.
 *
 * 2. **타임스탬프 표기 차이.** 우리가 쓰는 건 JS 의 `…T09:07:33.218Z` 인데
 *    같은 행을 다시 읽으면 Postgres 는 `…T09:07:33.218+00:00` 으로 돌려준다.
 *    글자로 비교하던 때는 내가 방금 쓴 것을 남이 쓴 것으로 보고 매번 충돌로
 *    처리했다 (5초마다 "다른 기기에서 저장한 내용이 있어…" 토스트).
 *    그래서 모킹도 timestamptz 처럼 **값으로** 비교한다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/** PostgREST 가 timestamptz 를 돌려주는 형식 (JS 의 'Z' 가 아니다) */
const toPgFormat = (iso: string) => iso.replace(/Z$/, '+00:00')

type Row = { id: string; updated_at: string; snapshot: unknown; snapshot_gz: string | null; thumbnail: string | null }

const initialRow = (): Row => ({
  id: 'p1',
  updated_at: toPgFormat('2026-10-09T09:00:00.000Z'),
  snapshot: null,
  snapshot_gz: null,
  thumbnail: 'data:image/svg+xml;base64,AAA',
})

let row: Row = initialRow()
/** 다음 요청에 심을 에러 (한 번 쓰면 비워진다) */
let failNext: { message: string } | null = null
/** 마지막 UPDATE 에 실려 간 필터 — 조건이 쿼리에 붙었는지 보려고 기록한다 */
let lastUpdateFilters: Array<[string, unknown]> = []

vi.mock('../../lib/supabase', () => {
  const makeBuilder = () => {
    const filters: Array<[string, unknown]> = []
    let patch: Record<string, unknown> | null = null
    let isUpdate = false

    /** Postgres 처럼 비교한다 — timestamptz 는 표기가 아니라 시각으로 */
    const matches = () => filters.every(([col, val]) => {
      const cur = (row as unknown as Record<string, unknown>)[col]
      if (col === 'updated_at') {
        return Date.parse(String(cur)) === Date.parse(String(val))
      }
      return cur === val
    })

    const run = () => {
      if (failNext) {
        const error = failNext
        failNext = null
        return { data: null, error }
      }
      if (!matches()) return { data: null, error: null }   // 0행
      if (isUpdate && patch) {
        lastUpdateFilters = [...filters]
        row = {
          ...row,
          ...(patch as Partial<Row>),
          // 서버는 받은 시각을 자기 형식으로 저장하고 자기 형식으로 돌려준다
          updated_at: toPgFormat(patch.updated_at as string),
        }
        patch = null
      }
      return { data: { updated_at: row.updated_at, snapshot: row.snapshot }, error: null }
    }

    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder },
      update: (values: Record<string, unknown>) => { isUpdate = true; patch = values; return builder },
      single: async () => run(),
      maybeSingle: async () => run(),
    }
    return builder
  }
  return {
    supabase: { from: () => makeBuilder() },
    supabaseConfigured: true,
  }
})

const { saveProjectSnapshot } = await import('../../lib/supabaseSync')
const { decodeSnapshot } = await import('../../lib/snapshotCodec')

/** 서버에 저장된 스냅샷 — 이제 gzip 된 text 로 들어간다. */
const savedSnapshot = async () =>
  row.snapshot_gz === null ? null : await decodeSnapshot(row.snapshot_gz)

beforeEach(() => {
  row = initialRow()
  failNext = null
  lastUpdateFilters = []
})

describe('saveProjectSnapshot', () => {
  it('연달아 저장해도 자기 자신과 충돌하지 않는다', async () => {
    // 1) 불러올 때 받은 서버 타임스탬프를 기준으로 첫 저장
    const first = await saveProjectSnapshot('p1', { a: 1 }, undefined, row.updated_at)
    expect(first.conflict).toBe(false)

    // 2) 첫 저장이 돌려준 값을 기준으로 두 번째 저장 — 여기서 터지던 버그
    const second = await saveProjectSnapshot('p1', { a: 2 }, undefined, first.serverUpdatedAt)
    expect(second.conflict).toBe(false)

    // 3) 세 번째도 마찬가지
    const third = await saveProjectSnapshot('p1', { a: 3 }, undefined, second.serverUpdatedAt)
    expect(third.conflict).toBe(false)
  })

  it('기준값 표기가 달라도(Z vs +00:00) 같은 시각이면 통과한다', async () => {
    const asZ = row.updated_at.replace(/\+00:00$/, 'Z')
    const result = await saveProjectSnapshot('p1', { a: 1 }, undefined, asZ)
    expect(result.conflict).toBe(false)
    expect(await savedSnapshot()).toEqual({ a: 1 })
  })

  it('저장 뒤 기준값은 서버가 돌려준 형식 그대로다', async () => {
    const result = await saveProjectSnapshot('p1', { a: 1 }, undefined, row.updated_at)
    expect(result.serverUpdatedAt).toBe(row.updated_at)
    expect(result.serverUpdatedAt?.endsWith('Z')).toBe(false)
  })

  it('기준값을 UPDATE 조건에 실어 보낸다 (확인 따로 + 쓰기 따로가 아니다)', async () => {
    // 이게 깨지면 검사와 쓰기 사이에 남의 저장이 끼어들 틈이 생긴다.
    await saveProjectSnapshot('p1', { a: 1 }, undefined, row.updated_at)
    expect(lastUpdateFilters.map(([col]) => col)).toEqual(['id', 'updated_at'])
  })

  it('남이 먼저 저장했으면 충돌로 잡는다', async () => {
    const stale = toPgFormat('2026-10-09T08:00:00.000Z')   // 서버는 09:00
    const result = await saveProjectSnapshot('p1', { a: 1 }, undefined, stale)
    expect(result.conflict).toBe(true)
    expect(result.serverUpdatedAt).toBe(row.updated_at)
    expect(await savedSnapshot()).toBeNull()   // 덮어쓰지 않았다
  })

  it('기준값을 안 주면 확인 없이 쓴다 (충돌 복구 후 재시도 경로)', async () => {
    const result = await saveProjectSnapshot('p1', { a: 9 })
    expect(result.conflict).toBe(false)
    expect(await savedSnapshot()).toEqual({ a: 9 })
    expect(lastUpdateFilters.map(([col]) => col)).toEqual(['id'])
  })

  // 5초 동기화는 썸네일을 넘기지 않는다. 예전엔 그때마다 null 로 덮어써서
  // 대시보드 카드가 늘 빈 칸이었다.
  it('썸네일을 안 넘기면 서버 썸네일을 건드리지 않는다', async () => {
    const before = row.thumbnail
    await saveProjectSnapshot('p1', { a: 1 }, undefined, row.updated_at)
    expect(row.thumbnail).toBe(before)
  })

  it('썸네일을 넘기면 저장한다', async () => {
    await saveProjectSnapshot('p1', { a: 1 }, 'data:image/svg+xml;base64,BBB', row.updated_at)
    expect(row.thumbnail).toBe('data:image/svg+xml;base64,BBB')
  })

  it('jsonb 가 아니라 압축 text 컬럼에 쓴다', async () => {
    // 수 MB JSON 을 jsonb 로 보내면 서버가 매번 파싱·TOAST 압축을 한다.
    // 그게 CPU 94% 로 DB 를 멈춰세운 원인이었다 (snapshotCodec 주석 참고).
    await saveProjectSnapshot('p1', { a: 1 }, undefined, row.updated_at)
    expect(typeof row.snapshot_gz).toBe('string')
    expect(row.snapshot).toBeNull()   // 옛 컬럼은 비워둔다 — 최신본이 둘이면 곤란하다
  })

  it('프로젝트가 없으면 충돌이 아니라 에러다', async () => {
    // 0행이 돌아오는 이유는 둘이다 — 기준값 불일치(충돌)와 행 없음.
    // 후자를 충돌로 보고하면 호출부가 "백업 후 재시도" 를 영원히 돌린다.
    await expect(saveProjectSnapshot('ghost', { a: 1 }, undefined, row.updated_at))
      .rejects.toThrow(/찾을 수 없습니다/)
  })

  it('서버 에러를 삼키지 않는다', async () => {
    failNext = { message: 'permission denied' }
    await expect(saveProjectSnapshot('p1', { a: 1 }, undefined, row.updated_at))
      .rejects.toMatchObject({ message: 'permission denied' })
    expect(await savedSnapshot()).toBeNull()
  })
})

// ───────── 자동 생성 버전 정리 ─────────
//
// project_versions 가 206MB 까지 자라 DB 의 대부분을 차지했다. 목록은 처음부터
// 30개만 보여줬는데 **지우는 코드가 없었다.**
//
// 처음엔 "라벨이 비었으면 자동 생성" 으로 짰는데 그게 틀렸다 — 자동 저장은
// '자동저장', 충돌 백업은 '충돌 백업 — …' 라벨을 달고 들어온다. 비어 있는 건
// 오히려 드물어서, 그 조건으로는 **하나도 못 지운다** (실제 170개 전부 라벨이
// 있었다). 그래서 "우리가 만든 라벨인지" 로 가른다.

const { isAutoVersionLabel } = await import('../../lib/supabaseSync')
const { conflictBackupLabel } = await import('../../lib/conflictBackup')

describe('isAutoVersionLabel', () => {
  it('자동저장 라벨을 알아본다', () => {
    // App.tsx 의 자동 버전 타이머가 이 문자열을 넘긴다
    expect(isAutoVersionLabel('자동저장')).toBe(true)
  })

  it('충돌 백업 라벨을 알아본다 — 실제 생성 함수로 만든 값으로', () => {
    // 문자열을 베껴 적지 않는다. conflictBackup 쪽 문구가 바뀌면 여기서 깨져야 한다.
    expect(isAutoVersionLabel(conflictBackupLabel(new Date('2026-10-08T16:17:00')))).toBe(true)
  })

  it('라벨이 없는 옛 행도 자동으로 본다', () => {
    expect(isAutoVersionLabel(null)).toBe(true)
    expect(isAutoVersionLabel(undefined)).toBe(true)
    expect(isAutoVersionLabel('')).toBe(true)
  })

  it('사용자가 직접 지은 이름은 건드리지 않는다', () => {
    // 이게 깨지면 사용자가 일부러 남긴 버전이 조용히 지워진다.
    expect(isAutoVersionLabel('최종 검토본')).toBe(false)
    expect(isAutoVersionLabel('발주 전')).toBe(false)
    expect(isAutoVersionLabel('자동저장본 따로 보관')).toBe(false)
  })
})
