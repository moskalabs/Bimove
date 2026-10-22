// tldraw **문서 레코드**의 meta 를 읽고 쓴다.
//
// 축척(scaleConfig)과 코멘트(commentStore)가 같은 칸을 나눠 쓴다. 앞으로도
// "도면 하나에 하나뿐인 값" 은 여기로 온다 — 도형이 아니면서 저장은 돼야
// 하는 것들이다.
//
// **쓰는 쪽을 한 군데로 모은 이유**가 하나다. `updateDocumentSettings({meta})`
// 는 meta 를 **통째로 갈아끼운다.** 그래서 쓸 때마다 기존 키를 펴 넣어야
// 하는데, 그 규칙을 모듈마다 따로 적어두면 언젠가 한 곳이 빠뜨린다. 그러면
// 코멘트를 하나 달 때 축척이 사라진다 — 조용히, 다음에 도면을 열 때까지.
//
// 문서 레코드는 document scope 라 스냅샷에 실린다 (App.tsx 의 저장 구독이
// `store.scopedTypes.document` 로 거른다). 세션 meta 와 헷갈리지 말 것 —
// 그쪽은 저장되지 않는다.

// meta 는 JSON 으로 직렬화돼 저장·전송된다. 그래서 `unknown` 이 아니라
// tldraw 의 `JsonObject` 로 받는다 — 함수나 Date 를 넣으면 저장될 때 조용히
// 뭉개지는데, 타입이 그걸 미리 막는다.
import type { Editor, JsonObject, JsonValue } from 'tldraw'

/** 문서 meta 를 읽는다. 목이 없는 에디터(테스트 목)에서도 안 터지게. */
export function readDocMeta(editor: Editor): JsonObject {
  try {
    return (editor.getDocumentSettings?.()?.meta as JsonObject | undefined) ?? {}
  } catch {
    return {}
  }
}

/** 키 하나만 바꾼다. **다른 키는 그대로 둔다.** */
export function writeDocMeta(editor: Editor, key: string, value: JsonValue): void {
  editor.updateDocumentSettings({ meta: { ...readDocMeta(editor), [key]: value } })
}
