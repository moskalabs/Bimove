/**
 * dwg-convert.worker.ts — DWG → DXF 변환을 워커에서 돌린다.
 *
 * 전엔 메인 스레드에서 돌렸다. 두 가지가 문제였다.
 *
 * 1. **변환 wasm 메모리가 돌아오지 않는다.** 한의 10.28MB 도면을 재보니
 *    변환기가 265MB 를 잡는다 (DWG 1MB 당 25.8MB). wasm 메모리는 줄어들지
 *    않고, dwgdxf 래퍼가 인스턴스를 영구 캐시하며(`if(!I) I=C(...)`), ESM
 *    모듈은 레지스트리에서 내려오지 않는다 — 즉 세션이 끝날 때까지 탭이
 *    그걸 들고 있다. 도면 데이터 자체가 heap 60MB 인데 변환기 찌꺼기가 그
 *    4배였다. 탭을 여러 개 띄우면 탭마다 생긴다.
 *
 *    워커를 **terminate 하면 realm 이 통째로 사라져서** 그 메모리가 확실히
 *    회수된다. 모듈을 다시 import 하는 식으로는 안 된다 (레지스트리가 오히려
 *    같이 쌓인다).
 *
 * 2. 변환이 2.6초 동안 UI 를 완전히 멈춘다 (10MB 기준, 크기에 비례).
 *
 * DWG 버퍼와 DXF 바이트는 둘 다 **transfer** 로 주고받는다 — 사본이 0 이다.
 * 이 모듈은 한 번 쓰고 죽으므로 상태를 들지 않는다.
 */

import { convertDwgToDxf } from 'dwgdxf'

export interface ConvertRequest {
  type: 'convert'
  /** DWG 원본. transfer 로 들어오므로 보낸 쪽 버퍼는 detach 된다. */
  buffer: ArrayBuffer
  /**
   * wasm 파일들이 있는 절대 URL.
   *
   * 워커에는 `document` 가 없어서 `new URL('dwgdxf', document.baseURI)` 를
   * 여기서 만들 수 없다. 메인 스레드가 계산해서 넘긴다.
   */
  wasmBase: string
}

export type ConvertOut =
  /** 모듈이 평가되어 핸들러가 걸렸다는 신호. onerror 의 원인을 가르는 데 쓴다. */
  | { type: 'boot' }
  | { type: 'result'; bytes: Uint8Array }
  | { type: 'error'; message: string }

self.onmessage = async (e: MessageEvent<ConvertRequest>) => {
  const msg = e.data
  if (msg.type !== 'convert') return
  try {
    const bytes = await convertDwgToDxf(new Uint8Array(msg.buffer), { wasmBase: msg.wasmBase })
    // 결과도 transfer 로 — 수백 MB 를 복사해 넘길 이유가 없다.
    //
    // wasm-bindgen 이 `.slice()` 해서 JS 소유 배열로 주므로 이 buffer 는
    // 온전히 우리 것이다 (wasm memory 를 가리키는 view 가 아니다).
    self.postMessage({ type: 'result', bytes } satisfies ConvertOut, { transfer: [bytes.buffer] })
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies ConvertOut)
  }
}

self.postMessage({ type: 'boot' } satisfies ConvertOut)
