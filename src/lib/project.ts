import { AssetRecordType, createShapeId, type Editor } from 'tldraw'
import { isDesktop, openFileDialog, saveFileDialog, readTextFile, writeTextFile } from './tauri'

// ---- project file save / load ----

export async function saveProject(editor: Editor, filename = 'untitled') {
  const snapshot = editor.getSnapshot()
  const json = JSON.stringify(snapshot, null, 2)

  if (isDesktop()) {
    const path = await saveFileDialog(`${filename}.bimove`)
    if (!path) return
    await writeTextFile(path, json)
  } else {
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.download = `${filename}.bimove`
    a.href = URL.createObjectURL(blob)
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }
}

export async function openProject(editor: Editor) {
  if (isDesktop()) {
    const path = await openFileDialog([{ name: 'bimove 도면', extensions: ['bimove', 'json'] }])
    if (!path) return
    try {
      const text = await readTextFile(path)
      const snapshot = JSON.parse(text)
      editor.loadSnapshot(snapshot)
    } catch {
      alert('파일을 읽을 수 없습니다.')
    }
  } else {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bimove,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      try {
        const snapshot = JSON.parse(text)
        editor.loadSnapshot(snapshot)
      } catch {
        alert('파일을 읽을 수 없습니다.')
      }
    }
    input.click()
  }
}

// ---- image upload (background trace) ----

export function uploadImage(editor: Editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/jpeg,image/png,image/webp,image/gif'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = dataUrl
    })

    const w = img.naturalWidth
    const h = img.naturalHeight

    const assetId = AssetRecordType.createId()
    const shapeId = createShapeId()

    editor.createAssets([{
      id: assetId,
      typeName: 'asset',
      type: 'image',
      props: { name: file.name, src: dataUrl, w, h, mimeType: file.type, isAnimated: false },
      meta: {},
    }])

    const vp = editor.getViewportPageBounds()
    const scale = Math.min(vp.w / w, vp.h / h, 1) * 0.9
    const sw = w * scale
    const sh = h * scale

    editor.createShape({
      id: shapeId,
      type: 'image',
      x: vp.x + (vp.w - sw) / 2,
      y: vp.y + (vp.h - sh) / 2,
      opacity: 0.4,
      props: { assetId, w: sw, h: sh },
    })

    editor.sendToBack([shapeId])
    editor.select(shapeId)
  }
  input.click()
}
