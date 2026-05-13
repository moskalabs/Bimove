import type { Editor } from 'tldraw'
import { getScaleConfig, SCALE_PRESETS } from './scaleConfig'

export async function exportPng(editor: Editor, filename = 'bimove_plan') {
  const shapes = editor.getCurrentPageShapes()
  if (shapes.length === 0) return

  const ids = shapes.map((s) => s.id)
  const result = await editor.getSvgString(ids, { padding: 60, background: false })
  if (!result) return

  const blob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  await new Promise<void>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = result.width * scale
      canvas.height = result.height * scale
      const ctx = canvas.getContext('2d')!
      ctx.scale(scale, scale)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, result.width, result.height)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)

      const a = document.createElement('a')
      a.download = `${filename}.png`
      a.href = canvas.toDataURL('image/png')
      a.click()
      resolve()
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve() }
    img.src = url
  })
}

export async function printPdf(editor: Editor, projectName = 'untitled') {
  const shapes = editor.getCurrentPageShapes()
  if (shapes.length === 0) return
  const ids = shapes.map(s => s.id)
  const result = await editor.getSvgString(ids, { padding: 60, background: false })
  if (!result) return

  const svgResponsive = result.svg
    .replace(/(<svg[^>]*)\s+width="[^"]*"/, '$1')
    .replace(/(<svg[^>]*)\s+height="[^"]*"/, '$1')

  const scaleConfig = getScaleConfig(editor)
  const scaleLabel = SCALE_PRESETS.find(p => Math.abs(p.pxPerMm - scaleConfig.pxPerMm) < 0.0001)?.label ?? 'custom'
  const date = new Date().toLocaleDateString('ko-KR')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${projectName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A3 landscape; margin: 10mm; }
  body { width: 420mm; height: 277mm; display: flex; flex-direction: column; font-family: sans-serif; }
  .drawing { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .drawing svg { max-width: 100%; max-height: 100%; }
  .title-block { height: 28mm; border-top: 1.5px solid #333; display: flex; align-items: stretch; font-size: 10pt; }
  .tb-cell { border-right: 1px solid #aaa; padding: 3mm 4mm; display: flex; flex-direction: column; justify-content: center; }
  .tb-cell:last-child { border-right: none; }
  .tb-label { font-size: 7pt; color: #888; margin-bottom: 2px; }
  .tb-value { font-size: 10pt; font-weight: 600; color: #222; }
  .tb-project { flex: 3; }
  .tb-scale, .tb-date, .tb-tool { flex: 1; }
</style>
</head>
<body>
  <div class="drawing">${svgResponsive}</div>
  <div class="title-block">
    <div class="tb-cell tb-project"><div class="tb-label">프로젝트</div><div class="tb-value">${projectName}</div></div>
    <div class="tb-cell tb-scale"><div class="tb-label">축척</div><div class="tb-value">${scaleLabel}</div></div>
    <div class="tb-cell tb-date"><div class="tb-label">날짜</div><div class="tb-value">${date}</div></div>
    <div class="tb-cell tb-tool"><div class="tb-label">제작</div><div class="tb-value">bimove</div></div>
  </div>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  setTimeout(() => win.print(), 600)
}

export async function exportSvg(editor: Editor, filename = 'bimove_plan') {
  const shapes = editor.getCurrentPageShapes()
  if (shapes.length === 0) return

  const ids = shapes.map((s) => s.id)
  const result = await editor.getSvgString(ids, { padding: 60, background: false })
  if (!result) return

  const blob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' })
  const a = document.createElement('a')
  a.download = `${filename}.svg`
  a.href = URL.createObjectURL(blob)
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
