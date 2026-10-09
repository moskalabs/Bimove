/**
 * 스냅샷 저장의 optimistic lock 회귀 테스트.
 *
 * 예전엔 저장에 성공하면 **우리가 만들어 보낸** ISO 문자열
 * (`…T09:07:33.218Z`) 을 다음 번 기준값으로 들고 있었다. 그런데 같은 행을
 * 다시 읽으면 Postgres 는 `…T09:07:33.218+00:00` 으로 돌려준다. 같은 시각인데
 * 글자가 달라서, 두 번째 저장부터는 **내가 방금 쓴 것을 남이 쓴 것으로** 보고
 * 매번 충돌로 처리했다 → 5초마다 "다른 기기에서 저장한 내용이 있어…" 토스트.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/** PostgREST 가 timestamptz 를 돌려주는 형식 (JS 의 'Z' 가 아니다) */
const toPgFormat = (iso: string) => iso.replace(/Z$/, '+00:00')

type Row = { updated_at: string; snapshot: unknown; thumbnail: string | null }

const initialRow = (): Row => ({
  updated_at: toPgFormat('2026-10-09T09:00:00.000Z'),
  snapshot: null,
  thumbnail: 'data:image/svg+xml;base64,AAA',
})

let row: Row = initialRow()

vi.mock('../../lib/supabase', () => {
  const makeBuilder = () => {
    let pending: Record<string, unknown> | null = null
    const builder = {
      select: () => builder,
      eq: () => builder,
      update: (values: Record<string, unknown>) => { pending = values; return builder },
      single: async () => {
        if (pending) {
          // UPDATE 는 패치다 — 패치에 없는 컬럼은 그대로 남는다.
          // 서버는 받은 시각을 자기 형식으로 저장하고, 자기 형식으로 돌려준다.
          row = {
            ...row,
            ...(pending as Partial<Row>),
            updated_at: toPgFormat(pending.updated_at as string),
          }
          pending = null
        }
        return { data: { updated_at: row.updated_at } }
      },
    }
    return builder
  }
  return {
    supabase: { from: () => makeBuilder() },
    supabaseConfigured: true,
  }
})

const { saveProjectSnapshot, sameInstant } = await import('../../lib/supabaseSync')

beforeEach(() => {
  row = initialRow()
})

describe('sameInstant', () => {
  it('형식이 달라도 같은 시각이면 같다고 본다', () => {
    expect(sameInstant('2026-10-09T09:07:33.218Z', '2026-10-09T09:07:33.218+00:00')).toBe(true)
  })

  it('실제로 다른 시각은 다르다고 본다', () => {
    expect(sameInstant('2026-10-09T09:07:33.218Z', '2026-10-09T09:07:34.000Z')).toBe(false)
  })

  it('한쪽이 비면 다르다 (둘 다 비면 같다)', () => {
    expect(sameInstant(undefined, '2026-10-09T09:00:00Z')).toBe(false)
    expect(sameInstant(undefined, undefined)).toBe(true)
  })
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

  it('저장 뒤 기준값은 서버가 돌려준 형식 그대로다', async () => {
    const result = await saveProjectSnapshot('p1', { a: 1 }, undefined, row.updated_at)
    expect(result.serverUpdatedAt).toBe(row.updated_at)
    expect(result.serverUpdatedAt?.endsWith('Z')).toBe(false)
  })

  it('남이 먼저 저장했으면 충돌로 잡는다', async () => {
    const stale = toPgFormat('2026-10-09T08:00:00.000Z')   // 서버는 09:00
    const result = await saveProjectSnapshot('p1', { a: 1 }, undefined, stale)
    expect(result.conflict).toBe(true)
    expect(result.serverUpdatedAt).toBe(row.updated_at)
    expect(row.snapshot).toBeNull()   // 덮어쓰지 않았다
  })

  it('기준값을 안 주면 확인 없이 쓴다 (충돌 복구 후 재시도 경로)', async () => {
    const result = await saveProjectSnapshot('p1', { a: 9 })
    expect(result.conflict).toBe(false)
    expect(row.snapshot).toEqual({ a: 9 })
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
})
