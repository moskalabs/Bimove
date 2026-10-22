import type { Editor } from 'tldraw'
import { readDocMeta, writeDocMeta } from './docMeta'

export type ScaleUnit = 'mm' | 'cm' | 'm'

export type ScaleConfig = {
  unit: ScaleUnit
  /** canvas px당 실제 mm (예: 1px = 5mm이면 pxPerMm = 0.2) */
  pxPerMm: number
}

export const SCALE_PRESETS: { label: string; pxPerMm: number }[] = [
  { label: '1:1  (1px = 1mm)',    pxPerMm: 1 },
  { label: '1:5  (1px = 5mm)',    pxPerMm: 0.2 },
  { label: '1:10 (1px = 1cm)',    pxPerMm: 0.1 },
  { label: '1:50 (1px = 5cm)',    pxPerMm: 0.02 },
  { label: '1:100 (1px = 10cm)',  pxPerMm: 0.01 },
  { label: '1:200 (1px = 20cm)',  pxPerMm: 0.005 },
  { label: '1:500 (1px = 50cm)',  pxPerMm: 0.002 },
  { label: '1:1000 (1px = 1m)',   pxPerMm: 0.001 },
  { label: '1:5000 (1px = 5m)',   pxPerMm: 0.0002 },
  { label: '1:10000 (1px = 10m)', pxPerMm: 0.0001 },
]

export const DEFAULT_SCALE: ScaleConfig = { unit: 'mm', pxPerMm: 1 }

/**
 * 축척이 사는 자리 — tldraw **문서** 레코드의 meta.
 *
 * 전엔 `getInstanceState().meta` 에 뒀다. 그건 tldraw 의 **세션** 상태라
 * `getSnapshot()` 의 `document.store` 에 안 들어간다 — 저장이 안 되고, 새로
 * 열면 기본값으로 돌아간다. 고객이 1:50 으로 맞춰 둔 도면을 다시 열면 1:1 이
 * 된다는 뜻이고, 치수 숫자가 통째로 달라진다.
 *
 * 문서 레코드는 document scope 라 스냅샷에 실린다. 그래서 `fromTldrawSnapshot`
 * 이 읽을 수 있고, 엔진(`crates/bimove-wasm/src/dim.rs`)이 그걸로 DIMLFAC 을
 * 맞춘다. 축척은 도면 하나당 하나라 문서 레코드가 제자리다.
 */
const DOC_META_KEY = 'scale'

export function getScaleConfig(editor: Editor): ScaleConfig {
  const saved = readDocMeta(editor)[DOC_META_KEY] as Partial<ScaleConfig> | undefined
  // 옛 세션은 축척을 instance meta 에만 들고 있다. 그 창을 쓰는 동안은
  // 그대로 읽어줘야 저장 전에 축척이 튀지 않는다.
  const session = (editor.getInstanceState?.()?.meta ?? {}) as Partial<ScaleConfig>
  return {
    unit: saved?.unit ?? session.unit ?? DEFAULT_SCALE.unit,
    pxPerMm: saved?.pxPerMm ?? session.pxPerMm ?? DEFAULT_SCALE.pxPerMm,
  }
}

export function setScaleConfig(editor: Editor, config: Partial<ScaleConfig>) {
  const next = { ...getScaleConfig(editor), ...config }
  // 문서 meta 의 **다른 키를 지우지 않는다** — 통째로 덮으면 코멘트가 사라진다.
  // (그 규칙은 docMeta.ts 가 지킨다.)
  writeDocMeta(editor, DOC_META_KEY, next)
}

export function formatLength(pxLen: number, config: ScaleConfig): string {
  const mm = pxLen / config.pxPerMm
  if (config.unit === 'mm') return `${Math.round(mm)}mm`
  if (config.unit === 'cm') return `${(mm / 10).toFixed(1)}cm`
  // m 단위: 1km 이상이면 km 표기
  if (mm >= 1_000_000) return `${(mm / 1_000_000).toFixed(2)}km`
  return `${(mm / 1000).toFixed(2)}m`
}
