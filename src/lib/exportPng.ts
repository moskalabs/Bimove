import type { Editor } from 'tldraw'

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
