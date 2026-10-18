import { AssetRecordType, createShapeId, type Editor } from 'tldraw'
import { isDesktop, openProjectFile, saveProjectFile } from './tauri'
import { checkImageSize } from './importLimits'

// ---- project file save / load ----

export async function saveProject(editor: Editor, filename = 'untitled') {
  const snapshot = editor.getSnapshot()
  const json = JSON.stringify(snapshot, null, 2)

  if (isDesktop()) {
    // 경로는 Rust 쪽 다이얼로그가 고르고 거기서 바로 쓴다 — 우리가 경로를
    // 넘기지 않는다 (tauri.ts 주석 참고).
    await saveProjectFile(`${filename}.bimova`, json)
  } else {
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a')
    a.download = `${filename}.bimova`
    a.href = URL.createObjectURL(blob)
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }
}

export async function openProject(editor: Editor) {
  if (isDesktop()) {
    try {
      const opened = await openProjectFile()
      if (!opened) return          // 취소는 에러가 아니다
      editor.loadSnapshot(JSON.parse(opened.content))
    } catch {
      alert('파일을 읽을 수 없습니다.')
    }
  } else {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bimova,.json'
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

export function uploadImage(
  editor: Editor,
  notify?: { onError?: (msg: string) => void },
) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/jpeg,image/png,image/webp,image/gif'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return

    // 읽기 전에 막는다. 이 이미지는 base64 로 **스냅샷에 박혀** 영구 저장되므로
    // (importLimits 주석 참고) 한 번 들어오면 프로젝트가 계속 그걸 짊어진다.
    const sizeCheck = checkImageSize(file.size)
    if (sizeCheck.kind === 'block') { notify?.onError?.(sizeCheck.message); return }

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
