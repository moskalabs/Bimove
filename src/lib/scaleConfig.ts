import type { Editor } from 'tldraw'

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
  { label: '1:100 (1px = 10cm)', pxPerMm: 0.01 },
]

export const DEFAULT_SCALE: ScaleConfig = { unit: 'mm', pxPerMm: 1 }

export function getScaleConfig(editor: Editor): ScaleConfig {
  const meta = editor.getInstanceState().meta as Partial<ScaleConfig>
  return {
    unit: meta.unit ?? DEFAULT_SCALE.unit,
    pxPerMm: meta.pxPerMm ?? DEFAULT_SCALE.pxPerMm,
  }
}

export function setScaleConfig(editor: Editor, config: Partial<ScaleConfig>) {
  const current = getScaleConfig(editor)
  editor.updateInstanceState({ meta: { ...current, ...config } })
}

export function formatLength(pxLen: number, config: ScaleConfig): string {
  const mm = pxLen / config.pxPerMm
  if (config.unit === 'mm') return `${Math.round(mm)}mm`
  if (config.unit === 'cm') return `${(mm / 10).toFixed(1)}cm`
  return `${(mm / 1000).toFixed(2)}m`
}
