// 가져올 파일 크기 상한.
//
// 세 경로(CAD·PDF·이미지)가 전부 크기를 보지 않고 `file.arrayBuffer()` /
// `readAsDataURL()` 로 통째로 읽고 있었다. 너무 큰 걸 던지면 **탭이 조용히
// 죽는다** — 브라우저가 OOM 으로 렌더러를 죽이는 것이라 에러도 토스트도 없고
// try/catch 에도 안 걸린다. 작업 중이던 도면도 같이 간다.
//
// ── 숫자는 어디서 왔나 ──
//
// 한의 실제 도면(10.28MB DWG)으로 node 에서 파이프라인을 돌려 RSS 를 쟀다.
//
//   변환 후        330MB   ← 이 중 265MB 가 변환 wasm 이 잡은 메모리
//   디코딩 문자열   417MB
//   + 워커 사본     502MB   ← 피크
//
// DWG→DXF 는 **4.40배**로 부푼다 (10.28MB → 45.2MB). 변환 wasm 은 DWG
// **1MB 당 25.8MB** 를 쓰는데, wasm 메모리는 줄어들지 않으므로 그만큼은
// 세션이 끝날 때까지 탭이 들고 있는다. 피크의 60% 가 거기다.
//
// 선형으로 보면 기준선 ~70MB + DWG 1MB 당 ~42MB. DWG 는 이 계수가 커서
// 파일 크기가 곧 생사다. DXF(텍스트)는 변환 wasm 이 없어 훨씬 싸다.

const MB = 1024 * 1024

/** 재서 얻은 상수 — 아래 계수의 근거는 이 파일 맨 위 주석에 있다. */
const DWG_PEAK_BASE_MB = 70
const DWG_PEAK_PER_MB = 42

/**
 * 이 DWG 를 가져오는 동안 쓸 메모리 어림값(MB).
 *
 * 사용자에게 보여주려고 둔다 — "큽니다" 보다 "약 1.3GB 를 씁니다" 가 판단에
 * 쓸 수 있는 말이다.
 */
export function estimatedDwgPeakMB(bytes: number): number {
  return DWG_PEAK_BASE_MB + (bytes / MB) * DWG_PEAK_PER_MB
}

/** 여기까지는 그냥 통과. 피크 ~1.3GB — 데스크톱에서 넘긴다. */
export const SAFE_DWG_BYTES = 30 * MB
/** 여기까지는 경고하고 진행. 넘으면 거절. */
export const MAX_DWG_BYTES = 50 * MB

/**
 * DXF 텍스트. 변환 wasm 이 없으니 사본만 센다 — 파일 → 디코딩 문자열 →
 * 워커 structured clone. 한글이 섞이면 문자열이 2바이트/자다.
 * (CRLF 정규화 사본은 바이트 단계에서 제자리로 치워 없앴다. decodeDxfBytes 참고.)
 */
export const SAFE_DXF_BYTES = 150 * MB
export const MAX_DXF_BYTES = 250 * MB

/**
 * PDF. pdf.js 가 문서 전체를 들고 거기서 2000px 폭 캔버스를 래스터화한다.
 * 결과물은 원본 크기와 상관이 적어 한 단계로 둔다.
 */
export const MAX_PDF_BYTES = 50 * MB

/**
 * 이미지. 여기만 이유가 다르다 — 메모리가 아니라 **영구 저장**이다.
 *
 * data URL(base64 라 1.33배)이 tldraw asset 으로 들어가 스냅샷에 박힌다.
 * 그 스냅샷은 gzip 해서 Supabase 로 올라가고 IndexedDB 에도 남는다. 참고용으로
 * 20MB 사진 한 장 끌어다 놓으면 프로젝트가 **영구히** 27MB 무거워지고, 저장·
 * 동기화가 매번 그걸 짊어진다. 그래서 한 번 쓰고 버리는 메모리보다 엄하다.
 */
export const MAX_IMAGE_BYTES = 10 * MB

/**
 * 크기 판정.
 *
 * 'block' 은 거절, 'confirm' 은 **물어보고 진행**이다. 둘을 가른 이유는, 될지
 * 안 될지가 쓰는 사람 장비에 달렸기 때문이다 — 32GB 짜리에서 열리는 도면을
 * 우리가 미리 막아버리면 그건 고장이다. 대신 뭘 쓰는지 말하고 고르게 한다.
 */
export type SizeVerdict =
  | { kind: 'ok' }
  | { kind: 'confirm'; message: string }
  | { kind: 'block'; message: string }

const OK: SizeVerdict = { kind: 'ok' }

export function formatMB(bytes: number): string {
  return `${(bytes / MB).toFixed(1)}MB`
}

/** 1024MB 를 넘으면 GB 로 — "1340MB" 는 읽는 사람이 다시 나눠야 한다. */
function formatSize(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${Math.round(mb)}MB`
}

function blocked(what: string, bytes: number, limit: number, advice: string): SizeVerdict {
  return {
    kind: 'block',
    message: `${what}이 너무 큽니다 (${formatMB(bytes)}, 최대 ${formatMB(limit)}). ${advice}`,
  }
}

/**
 * CAD 파일을 읽기 **전에** 본다. 확장자로 DWG/DXF 를 가른다 — 같은 크기라도
 * DWG 가 훨씬 무겁다 (변환 wasm 때문에 DXF 의 몇 배다).
 */
export function checkCadSize(fileName: string, bytes: number): SizeVerdict {
  if (fileName.toLowerCase().endsWith('.dwg')) {
    if (bytes > MAX_DWG_BYTES) {
      return blocked('DWG 파일', bytes, MAX_DWG_BYTES,
        'CAD 에서 DXF 로 저장한 뒤 가져와주세요 — DXF 는 같은 도면이어도 훨씬 가볍습니다.')
    }
    if (bytes > SAFE_DWG_BYTES) {
      return {
        kind: 'confirm',
        message:
          `${formatMB(bytes)} DWG 입니다. 변환하는 동안 약 ` +
          `${formatSize(estimatedDwgPeakMB(bytes))} 를 쓰는데, 메모리가 모자라면 ` +
          `탭이 닫힐 수 있습니다.\n\n` +
          `CAD 에서 DXF 로 저장해 가져오면 훨씬 가볍습니다. 그래도 계속할까요?`,
      }
    }
    return OK
  }

  if (bytes > MAX_DXF_BYTES) {
    return blocked('DXF 파일', bytes, MAX_DXF_BYTES,
      'CAD 에서 도면을 나눠 저장한 뒤 하나씩 가져와주세요.')
  }
  if (bytes > SAFE_DXF_BYTES) {
    return {
      kind: 'confirm',
      message:
        `${formatMB(bytes)} DXF 입니다. 읽는 동안 메모리를 많이 쓰고, ` +
        `도면이 열린 뒤에도 느릴 수 있습니다.\n\n계속할까요?`,
    }
  }
  return OK
}

/**
 * DWG→DXF 변환 **직후** 본다.
 *
 * 변환 결과는 원본 크기로 예측이 안 된다 (블록을 얼마나 펼치는지에 달렸다).
 * 평균 4.4배지만 도면에 따라 더 간다. 여기서 멈추면 이미 wasm 안의 한 벌은
 * 있지만, 뒤따르는 문자열 사본들은 안 만든다.
 *
 * 여기선 묻지 않는다 — 사용자는 이미 파일 크기를 보고 한 번 골랐고, 변환이
 * 끝난 뒤에 또 묻는 건 같은 질문을 두 번 하는 것이다.
 */
export function checkConvertedDxfSize(bytes: number): SizeVerdict {
  if (bytes > MAX_DXF_BYTES) {
    return blocked('변환된 DXF', bytes, MAX_DXF_BYTES,
      '원본 DWG 에서 필요한 레이어만 남겨 다시 시도해주세요.')
  }
  return OK
}

export function checkPdfSize(bytes: number): SizeVerdict {
  if (bytes > MAX_PDF_BYTES) {
    return blocked('PDF 파일', bytes, MAX_PDF_BYTES, '페이지를 나눠 저장한 뒤 가져와주세요.')
  }
  return OK
}

export function checkImageSize(bytes: number): SizeVerdict {
  if (bytes > MAX_IMAGE_BYTES) {
    return blocked('이미지', bytes, MAX_IMAGE_BYTES,
      '도면에 함께 저장되므로 크기를 줄여 가져와주세요.')
  }
  return OK
}
