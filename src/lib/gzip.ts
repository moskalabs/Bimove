// gzip 압축/해제 공용 유틸.
//
// 공유 링크와 스냅샷 저장이 같은 코드를 쓴다. 둘 다 "수 MB JSON 을 작게 만들어
// 어딘가에 보낸다" 는 같은 일을 하는데, 전에는 공유 링크에만 구현이 있었다.

/**
 * 바이트 하나를 흘려보내는 스트림.
 *
 * `new Blob([…]).stream()` 을 쓰지 않는다. jsdom 에 Blob.stream 이 없어서
 * 압축 경로를 테스트로 묶을 수 없었고, 어차피 Blob 을 거칠 이유도 없다.
 *
 * BufferSource 로 내보낸다 — CompressionStream.writable 이
 * WritableStream<BufferSource> 라서, Uint8Array 로 좁히면 pipeThrough 가
 * 반공변 때문에 거부한다.
 */
function bytesToStream(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      // lib.dom 의 BufferSource 는 ArrayBuffer 기반 뷰만 받는다 (SharedArrayBuffer
      // 제외). 우리가 만드는 건 항상 전자라 캐스팅으로 좁힌다.
      controller.enqueue(bytes as BufferSource)
      controller.close()
    },
  })
}

/** 스트림을 끝까지 읽어 한 덩어리로. */
async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

/** 문자열 → gzip 바이트. */
export async function gzipText(text: string): Promise<Uint8Array> {
  const src = bytesToStream(new TextEncoder().encode(text))
  return collect(src.pipeThrough(new CompressionStream('gzip')) as ReadableStream<Uint8Array>)
}

/**
 * gzip 바이트 → 문자열. 누적 크기가 `limitBytes` 를 넘으면 읽기를 끊는다.
 *
 * 한 번에 다 받아버리면 상한을 걸 자리가 없다 — 남이 만든 데이터라면 몇 KB 가
 * 메모리를 다 먹고 탭을 죽일 수 있다(zip bomb). 그래서 직접 읽으면서 센다.
 */
export async function gunzipText(bytes: Uint8Array, limitBytes = Infinity): Promise<string> {
  const stream = bytesToStream(bytes).pipeThrough(new DecompressionStream('gzip'))
  const reader = (stream as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limitBytes) {
        throw new Error(
          `압축을 푼 데이터가 너무 큽니다 (${Math.round(limitBytes / 1024 / 1024)}MB 초과)`)
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    // 상한에 걸려 중간에 나가도 압축 해제를 멈춘다.
    await reader.cancel().catch(() => {})
  }
}

// ── base64 ──
//
// 한 번에 펼치면 스택이 넘친다 (수 MB 를 String.fromCharCode(...bytes) 로
// 넘기면 인자 개수 제한에 걸린다). 32KB 씩 끊어서 잇는다.

const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
