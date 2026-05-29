// 공유 링크 — 프로젝트 snapshot을 gzip 압축 + URL safe base64로 인코딩해서
// URL hash에 담음. 백엔드 없이 시작 (Step 1).

type SharePayload = { name: string; snapshot: object }

async function gzipToBase64Url(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const buf = await new Response(stream).arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function gunzipFromBase64Url(b64: string): Promise<string> {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (padded.length % 4)) % 4
  const bin = atob(padded + '='.repeat(padding))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

/** 현재 프로젝트의 공유 URL 생성. URL hash에 압축 payload 담음. */
export async function createShareLink(name: string, snapshot: object): Promise<string> {
  const payload: SharePayload = { name, snapshot }
  const compressed = await gzipToBase64Url(JSON.stringify(payload))
  const base = window.location.origin + window.location.pathname
  return `${base}#share=${compressed}`
}

/** URL hash에서 공유 payload 추출. 없으면 null. */
export async function readShareFromHash(): Promise<SharePayload | null> {
  const hash = window.location.hash
  const m = hash.match(/#share=(.+)/)
  if (!m) return null
  try {
    const json = await gunzipFromBase64Url(m[1])
    return JSON.parse(json) as SharePayload
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
