// 자재 라이브러리 — 단가/재질/블록단가 매핑 통합 JSON export/import.

import { loadPriceConfig, savePriceConfig, type PriceConfig } from './priceConfig'
import { loadMaterialPresets, saveMaterialPresets, type MaterialPreset } from './materialPresets'

export type LibraryFile = {
  format: 'bimova-library'
  version: '1.0'
  name: string
  createdAt: number
  company?: string
  note?: string
  priceConfig: PriceConfig
  materialPresets: MaterialPreset[]
}

export function exportLibrary(name: string, meta?: { company?: string; note?: string }): LibraryFile {
  return {
    format: 'bimova-library',
    version: '1.0',
    name,
    createdAt: Date.now(),
    company: meta?.company,
    note: meta?.note,
    priceConfig: loadPriceConfig(),
    materialPresets: loadMaterialPresets(),
  }
}

export function downloadLibrary(file: LibraryFile) {
  const json = JSON.stringify(file, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.download = `${sanitizeFilename(file.name)}.bimova-lib.json`
  a.href = url
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function pickAndImportLibrary(onLoaded: (file: LibraryFile) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    try {
      const text = await f.text()
      const parsed = JSON.parse(text) as LibraryFile
      if (parsed.format !== 'bimova-library') {
        alert('형식이 다른 파일입니다. (bimova-library만 지원)')
        return
      }
      onLoaded(parsed)
    } catch (err) {
      alert('파일 읽기 실패: ' + String(err))
    }
  }
  input.click()
}

/** 라이브러리 파일 → 현재 시스템에 적용 (덮어쓰기) */
export function applyLibrary(file: LibraryFile) {
  if (file.priceConfig) savePriceConfig(file.priceConfig)
  if (Array.isArray(file.materialPresets) && file.materialPresets.length > 0) {
    saveMaterialPresets(file.materialPresets)
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'library'
}
