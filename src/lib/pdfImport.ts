// PDF 도면 import — 첫 페이지를 이미지로 렌더해서 tldraw에 배치.
// pdf.js (pdfjs-dist) 사용.

import { AssetRecordType, createShapeId, type Editor } from 'tldraw'

// pdf.js worker — dynamic import로 번들 사이즈 영향 최소
async function getPdfJs() {
  const pdfjsLib = await import('pdfjs-dist')
  // worker URL — Vite는 ?url로 worker 모듈 로딩 가능
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjsLib
}

export function importPdf(
  editor: Editor,
  notify?: { onSuccess?: (msg: string) => void; onError?: (msg: string) => void },
) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/pdf'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      await importPdfFile(editor, file)
      notify?.onSuccess?.(`"${file.name}" PDF를 가져왔습니다.`)
    } catch (err) {
      console.error('[PDF import] failed:', err)
      notify?.onError?.('PDF 가져오기 실패: ' + String(err))
    }
  }
  input.click()
}

async function importPdfFile(editor: Editor, file: File) {
  const pdfjsLib = await getPdfJs()
  const arrayBuf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise
  const totalPages = pdf.numPages

  // 첫 페이지 (필요시 옵션화)
  const page = await pdf.getPage(1)
  const targetWidth = 2000  // 고해상도 렌더
  const viewportBase = page.getViewport({ scale: 1 })
  const scale = targetWidth / viewportBase.width
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas context 없음')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: ctx, viewport, intent: 'display' } as Parameters<typeof page.render>[0]).promise

  const dataUrl = canvas.toDataURL('image/png')
  const w = canvas.width
  const h = canvas.height

  const assetId = AssetRecordType.createId()
  const shapeId = createShapeId()

  editor.createAssets([{
    id: assetId,
    typeName: 'asset',
    type: 'image',
    props: { name: file.name + ' (PDF p.1)', src: dataUrl, w, h, mimeType: 'image/png', isAnimated: false },
    meta: { sourcePdf: file.name, totalPages },
  }])

  const vp = editor.getViewportPageBounds()
  const sc = Math.min(vp.w / w, vp.h / h, 1) * 0.9
  const sw = w * sc
  const sh = h * sc

  editor.createShape({
    id: shapeId,
    type: 'image',
    x: vp.x + (vp.w - sw) / 2,
    y: vp.y + (vp.h - sh) / 2,
    opacity: 0.5,
    props: { assetId, w: sw, h: sh },
  })

  editor.sendToBack([shapeId])
  editor.select(shapeId)

  if (totalPages > 1) {
    console.info(`[PDF] ${totalPages} pages — 첫 페이지만 임포트됨.`)
  }
}
