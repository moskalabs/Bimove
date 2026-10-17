// 가져올 파일 크기 상한.
//
// 세 경로(CAD·PDF·이미지)가 전부 크기를 보지 않고 `file.arrayBuffer()` /
// `readAsDataURL()` 로 통째로 읽고 있었다. 너무 큰 걸 던지면 **탭이 조용히
// 죽는다** — 에러도 토스트도 없이 그냥 사라지고, 작업 중이던 도면도 같이 간다.
// 브라우저가 OOM 으로 렌더러를 죽이는 것이라 try/catch 로는 못 잡는다.
//
// 상한은 "파일 크기" 가 아니라 **그 파일이 만드는 사본 수** 에서 나왔다.
// 어느 경로든 원본 한 벌로 끝나지 않는다.

/**
 * DXF 텍스트. 파일 → 디코딩한 문자열 → CRLF 정규화 사본 → 워커로 보낼 때
 * structured clone 사본. 최소 3~4벌이 동시에 떠 있다.
 */
export const MAX_DXF_BYTES = 150 * 1024 * 1024

/**
 * DWG 바이너리. 여기가 가장 무겁다 — 파일 버퍼 + wasm 안 입력 사본 +
 * wasm 이 뱉은 DXF + `decodeDxfBytes` 의 slice 사본 + 디코딩한 문자열 +
 * CRLF 사본 + 워커 사본. 게다가 DWG→DXF 는 **3~4배로 부푼다**
 * (한의 10.8MB 도면이 37.5MB DXF 가 됐다).
 *
 * 그래서 파일 크기만으로는 못 막는다. 변환 **직후** DXF 바이트도 다시 본다
 * (checkConvertedDxfSize).
 */
export const MAX_DWG_BYTES = 50 * 1024 * 1024

/**
 * PDF. pdf.js 가 문서 전체를 파싱해 들고 있고, 거기서 2000px 폭 캔버스를
 * 래스터화해 PNG data URL 로 만든다.
 */
export const MAX_PDF_BYTES = 50 * 1024 * 1024

/**
 * 이미지. 여기만 이유가 다르다 — 크기가 아니라 **영구 저장**이다.
 *
 * data URL(base64 라 1.33배)이 tldraw asset 으로 들어가 스냅샷에 박힌다.
 * 그 스냅샷은 gzip 해서 Supabase 로 올라가고 IndexedDB 에도 남는다. 참고용으로
 * 20MB 사진 한 장 끌어다 놓으면 프로젝트가 **영구히** 27MB 무거워지고, 저장·
 * 동기화가 매번 그걸 짊어진다.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/** 상한을 넘었을 때 보여줄 말. 넘지 않았으면 null. */
function tooBig(what: string, bytes: number, limit: number, advice: string): string | null {
  if (bytes <= limit) return null
  return `${what}이 너무 큽니다 (${formatMB(bytes)}, 최대 ${formatMB(limit)}). ${advice}`
}

/**
 * CAD 파일을 읽기 **전에** 본다.
 *
 * 확장자로 DWG/DXF 를 가른다 — 같은 크기라도 DWG 가 훨씬 무겁다.
 */
export function checkCadSize(fileName: string, bytes: number): string | null {
  const isDwg = fileName.toLowerCase().endsWith('.dwg')
  return isDwg
    ? tooBig('DWG 파일', bytes, MAX_DWG_BYTES,
        'CAD 에서 필요한 레이어만 남겨 DXF 로 저장한 뒤 가져와주세요.')
    : tooBig('DXF 파일', bytes, MAX_DXF_BYTES,
        'CAD 에서 도면을 나눠 저장한 뒤 하나씩 가져와주세요.')
}

/**
 * DWG→DXF 변환 **직후** 본다.
 *
 * 변환 결과는 원본 크기로 예측이 안 된다 (블록을 얼마나 펼치는지에 달렸다).
 * 여기서 걸러도 이미 wasm 안에 한 벌은 있지만, 그 뒤로 이어지는 문자열 사본
 * 서너 벌을 안 만들고 끝낸다 — 거기서 죽는 것과 여기서 멈추는 건 다르다.
 */
export function checkConvertedDxfSize(bytes: number): string | null {
  return tooBig('변환된 DXF', bytes, MAX_DXF_BYTES,
    '원본 DWG 에서 필요한 레이어만 남겨 다시 시도해주세요.')
}

export function checkPdfSize(bytes: number): string | null {
  return tooBig('PDF 파일', bytes, MAX_PDF_BYTES, '페이지를 나눠 저장한 뒤 가져와주세요.')
}

export function checkImageSize(bytes: number): string | null {
  return tooBig('이미지', bytes, MAX_IMAGE_BYTES,
    '도면에 함께 저장되므로 크기를 줄여 가져와주세요.')
}
