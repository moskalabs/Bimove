import { describe, it, expect } from 'vitest'
import { clearShareHash } from '../../lib/shareLink'

// createShareLink / readShareFromHash use Blob.stream() + CompressionStream
// which are not available in jsdom. Test only what works in jsdom.

describe('clearShareHash', () => {
  it('removes #share= from URL', () => {
    window.location.hash = '#share=abc123'
    clearShareHash()
    expect(window.location.hash).toBe('')
  })

  it('no-op when no share hash', () => {
    window.location.hash = '#other=123'
    clearShareHash()
    expect(window.location.hash).toBe('#other=123')
  })

  it('no-op when hash is empty', () => {
    window.location.hash = ''
    clearShareHash()
    expect(window.location.hash).toBe('')
  })
})

describe('module exports', () => {
  it('exports createShareLink as async function', async () => {
    const mod = await import('../../lib/shareLink')
    expect(typeof mod.createShareLink).toBe('function')
  })

  it('exports readShareFromHash as async function', async () => {
    const mod = await import('../../lib/shareLink')
    expect(typeof mod.readShareFromHash).toBe('function')
  })

  it('exports copyToClipboard as async function', async () => {
    const mod = await import('../../lib/shareLink')
    expect(typeof mod.copyToClipboard).toBe('function')
  })
})

// ───────── 신뢰할 수 없는 입력 방어 ─────────
//
// 공유 링크는 누구나 만들어 보낼 수 있다. gzip 은 몇 KB 로 수 GB 를 만들 수
// 있고(zip bomb), 풀어낸 JSON 이 우리가 기대하는 모양이라는 보장도 없다.

describe('decodeShareBase64', () => {
  it('URL safe base64 를 바이트로 되돌린다 (패딩 복원 포함)', async () => {
    const { decodeShareBase64 } = await import('../../lib/shareLink')
    // 'hi' → base64 'aGk=' → URL safe 는 패딩을 떼서 'aGk'
    expect([...decodeShareBase64('aGk')]).toEqual([0x68, 0x69])
  })

  it('- 와 _ 를 + 와 / 로 되돌린다', async () => {
    const { decodeShareBase64 } = await import('../../lib/shareLink')
    expect([...decodeShareBase64('-_8')]).toEqual([0xfb, 0xff])
  })

  it('터무니없이 긴 입력은 압축을 풀기 전에 거부한다', async () => {
    const { decodeShareBase64 } = await import('../../lib/shareLink')
    // 4MB 상한 — 정상 링크가 걸릴 일은 없고, zip bomb 를 스트림 만들기 전에 끊는다
    expect(() => decodeShareBase64('A'.repeat(4 * 1024 * 1024 + 1)))
      .toThrow(/너무 깁니다/)
  })
})

describe('isSharePayload', () => {
  const valid = { name: 'plan', snapshot: { store: {} } }

  it('정상 payload 를 통과시킨다', async () => {
    const { isSharePayload } = await import('../../lib/shareLink')
    expect(isSharePayload(valid)).toBe(true)
  })

  it('name 이 문자열이 아니면 거부한다', async () => {
    const { isSharePayload } = await import('../../lib/shareLink')
    expect(isSharePayload({ ...valid, name: 42 })).toBe(false)
    expect(isSharePayload({ ...valid, name: '' })).toBe(false)
    expect(isSharePayload({ ...valid, name: 'x'.repeat(201) })).toBe(false)
  })

  it('snapshot 이 객체가 아니면 거부한다', async () => {
    const { isSharePayload } = await import('../../lib/shareLink')
    expect(isSharePayload({ ...valid, snapshot: 'nope' })).toBe(false)
    expect(isSharePayload({ ...valid, snapshot: null })).toBe(false)
    // 배열은 tldraw 가 해석하다 터진다 — 여기서 걸러야 한다
    expect(isSharePayload({ ...valid, snapshot: [] })).toBe(false)
  })

  it('객체가 아니거나 비어 있으면 거부한다', async () => {
    const { isSharePayload } = await import('../../lib/shareLink')
    expect(isSharePayload(null)).toBe(false)
    expect(isSharePayload('{}')).toBe(false)
    expect(isSharePayload({})).toBe(false)
  })
})

// shareLink 는 Blob 을 안 쓰므로(jsdom 에 Blob.stream 이 없다) 스트림 API 만 있으면 돈다
const hasCompression = typeof CompressionStream !== 'undefined'
  && typeof DecompressionStream !== 'undefined'
  && typeof ReadableStream !== 'undefined'

/** 테스트에서 gzip 바이트를 만들 때 쓰는, shareLink 와 같은 방식의 압축 */
async function gzipBytes(text: string): Promise<Uint8Array> {
  const src = new ReadableStream<BufferSource>({
    start(c) { c.enqueue(new TextEncoder().encode(text) as BufferSource); c.close() },
  })
  const reader = src.pipeThrough(new CompressionStream('gzip')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value as Uint8Array)
    total += (value as Uint8Array).byteLength
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

function toB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe.skipIf(!hasCompression)('압축 왕복', () => {
  it('만든 링크를 그대로 다시 읽는다', async () => {
    const { createShareLink, readShareFromHash } = await import('../../lib/shareLink')
    const snapshot = { store: { 'shape:a': { x: 1 } } }
    const url = await createShareLink('테스트 도면', snapshot)
    window.location.hash = url.slice(url.indexOf('#'))
    const back = await readShareFromHash()
    expect(back?.name).toBe('테스트 도면')
    expect(back?.snapshot).toEqual(snapshot)
  })

  it('모양이 안 맞는 payload 는 null (던지지 않는다)', async () => {
    const { readShareFromHash } = await import('../../lib/shareLink')
    // name 없이 압축해 넣는다
    const b64 = toB64Url(await gzipBytes(JSON.stringify({ snapshot: {} })))
    window.location.hash = `#share=${b64}`
    expect(await readShareFromHash()).toBeNull()
  })

  it('gzip 이 아니면 null (쓰레기 hash 로 터지지 않는다)', async () => {
    const { readShareFromHash } = await import('../../lib/shareLink')
    window.location.hash = '#share=aGVsbG8gd29ybGQ'   // 그냥 'hello world'
    expect(await readShareFromHash()).toBeNull()
  })

  // zip bomb 방어. 이 모듈에서 제일 중요한 한 줄이라 직접 겨눈다.
  it('압축을 풀었을 때 상한을 넘으면 읽기를 끊는다', async () => {
    const { gunzipLimited } = await import('../../lib/shareLink')
    // 0 으로 채운 40MB — gzip 으로는 40KB 정도지만 풀면 상한(32MB)을 넘는다
    const bomb = await gzipBytes('0'.repeat(40 * 1024 * 1024))
    expect(bomb.byteLength).toBeLessThan(1024 * 1024)   // 입력은 이렇게 작다
    await expect(gunzipLimited(bomb)).rejects.toThrow(/너무 큽니다/)
    // 40MB 를 **압축하는** 쪽이 느리다. 기본 제한(5초)에 아슬아슬하게 걸려서
    // 가끔 빨간불이 떴다 — 코드 문제가 아니라 기계가 바쁜 날의 문제다.
  }, 30_000)

  it('상한 안쪽은 그대로 풀어준다', async () => {
    const { gunzipLimited } = await import('../../lib/shareLink')
    const text = '가'.repeat(100_000)   // 멀티바이트 — TextDecoder 의 stream 처리까지 본다
    expect(await gunzipLimited(await gzipBytes(text))).toBe(text)
  })
})
