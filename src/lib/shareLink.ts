// 공유 링크 — 프로젝트 snapshot을 gzip 압축 + URL safe base64로 인코딩해서
// URL hash에 담음. 백엔드 없이 시작 (Step 1).
//
// 읽는 쪽은 **신뢰할 수 없는 입력**을 다룬다. 링크는 누구나 만들어 보낼 수
// 있고, gzip 은 몇 KB 로 수 GB 를 만들 수 있다(zip bomb). 그래서 입력 길이와
// 압축 해제 크기에 상한을 두고, 풀어낸 JSON 의 모양도 확인한다.

type SharePayload = { name: string; snapshot: object }

/**
 * hash 에 실린 base64 길이 상한. 브라우저가 실제로 다루는 URL 길이를 한참
 * 넘는 값이라 정상 링크가 걸릴 일은 없고, 터무니없는 입력을 압축 해제 전에
 * 끊는 것이 목적이다.
 */
const MAX_B64_LENGTH = 4 * 1024 * 1024

/** 압축을 풀었을 때 허용하는 최대 바이트. 넘으면 읽기를 중단한다. */
const MAX_INFLATED_BYTES = 32 * 1024 * 1024

/** 프로젝트 이름 길이 상한 (UI 와 DB 양쪽을 생각한 보수적인 값). */
const MAX_NAME_LENGTH = 200

/**
 * 바이트 하나를 흘려보내는 스트림.
 *
 * `new Blob([…]).stream()` 을 쓰지 않는다. jsdom 에 Blob.stream 이 없어서
 * 압축 경로를 테스트로 묶을 수 없었고, 어차피 Blob 을 거칠 이유도 없다.
 */
function bytesToStream(bytes: Uint8Array): ReadableStream<BufferSource> {
  // BufferSource 로 내보낸다 — CompressionStream.writable 이
  // WritableStream<BufferSource> 라서, Uint8Array 로 좁히면 pipeThrough 가
  // 반공변 때문에 거부한다.
  return new ReadableStream<BufferSource>({
    start(controller) {
      // lib.dom 의 BufferSource 는 ArrayBuffer 기반 뷰만 받는다 (SharedArrayBuffer
      // 제외). 우리가 만드는 건 항상 전자라 캐스팅으로 좁힌다.
      controller.enqueue(bytes as BufferSource)
      controller.close()
    },
  })
}

async function gzipToBase64Url(text: string): Promise<string> {
  const stream = bytesToStream(new TextEncoder().encode(text))
    .pipeThrough(new CompressionStream('gzip'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength }

  let bin = ''
  const CHUNK = 0x8000   // 한 번에 다 펼치면 스택이 넘친다
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * URL safe base64 → 바이트. 너무 길면 거부한다.
 *
 * 압축을 풀기 **전에** 거르는 단계다. 여기서 막으면 DecompressionStream 을
 * 아예 만들지 않는다.
 */
export function decodeShareBase64(b64: string): Uint8Array {
  if (b64.length > MAX_B64_LENGTH) {
    throw new Error(`공유 링크가 너무 깁니다 (${b64.length} 글자)`)
  }
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (padded.length % 4)) % 4
  const bin = atob(padded + '='.repeat(padding))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * gzip 바이트 → 문자열. 누적 크기가 상한을 넘으면 읽기를 끊는다.
 *
 * 한 번에 다 받아버리면 상한을 걸 자리가 없다 — 몇 KB 짜리 링크가 메모리를
 * 다 먹고 탭을 죽일 수 있다. 그래서 직접 읽으면서 센다.
 *
 * 테스트가 직접 부를 수 있게 export 한다. zip bomb 방어가 이 모듈의 핵심이라
 * readShareFromHash 를 통해서만 건드리면 경로가 너무 멀다.
 */
export async function gunzipLimited(bytes: Uint8Array): Promise<string> {
  const stream = bytesToStream(bytes).pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_INFLATED_BYTES) {
        throw new Error(
          `공유 데이터가 너무 큽니다 (${Math.round(MAX_INFLATED_BYTES / 1024 / 1024)}MB 초과)`)
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    // 상한에 걸려 중간에 나가도 압축 해제를 멈춘다.
    await reader.cancel().catch(() => {})
  }
}

/** 풀어낸 JSON 이 우리가 기대하는 모양인지. 남이 만든 링크라 믿고 쓸 수 없다. */
export function isSharePayload(value: unknown): value is SharePayload {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  if (typeof o.name !== 'string' || o.name.length === 0) return false
  if (o.name.length > MAX_NAME_LENGTH) return false
  // snapshot 은 tldraw 가 해석할 객체다. 배열이나 문자열이면 아래에서 터진다.
  return !!o.snapshot && typeof o.snapshot === 'object' && !Array.isArray(o.snapshot)
}

/** 현재 프로젝트의 공유 URL 생성. URL hash에 압축 payload 담음. */
export async function createShareLink(name: string, snapshot: object): Promise<string> {
  const payload: SharePayload = { name, snapshot }
  const compressed = await gzipToBase64Url(JSON.stringify(payload))
  const base = window.location.origin + window.location.pathname
  return `${base}#share=${compressed}`
}

/** URL hash에서 공유 payload 추출. 없거나 못 믿을 내용이면 null. */
export async function readShareFromHash(): Promise<SharePayload | null> {
  const hash = window.location.hash
  const m = hash.match(/#share=(.+)/)
  if (!m) return null
  try {
    const json = await gunzipLimited(decodeShareBase64(m[1]))
    const parsed: unknown = JSON.parse(json)
    if (!isSharePayload(parsed)) {
      console.error('공유 링크 내용이 예상과 다릅니다')
      return null
    }
    return parsed
  } catch (err) {
    console.error('공유 링크 디코딩 실패:', err)
    return null
  }
}

/** 클립보드에 텍스트 복사 (보조 함수). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** 공유 링크 처리 후 URL hash 제거 (재진입 방지). */
export function clearShareHash() {
  if (window.location.hash.startsWith('#share=')) {
    history.replaceState(null, '', window.location.pathname + window.location.search)
  }
}
