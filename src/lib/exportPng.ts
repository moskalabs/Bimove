import type { Editor } from 'tldraw'

export async function exportPng(editor: Editor, filename = 'bimova_plan') {
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

// 2026-10-19: printPdf / exportSvg 를 지웠다. 둘 다 **아무도 안 불렀다** —
// 메뉴에도 없고 코드 어디서도 안 썼다. PDF 는 '인쇄'(window.print)와 '리포트
// 내보내기'(printReport)가 이미 하고, SVG 는 내보낼 자리가 없었다.
// 쓸 일이 생기면 git 에 남아 있다 — 안 닿는 코드를 들고 있는 값이 더 비싸다.
