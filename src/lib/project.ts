import { AssetRecordType, createShapeId, type Editor } from 'tldraw'
import { isDesktop, openProjectFile, saveProjectFile } from './tauri'
import { checkImageSize } from './importLimits'

// ---- project file save / load ----
//
// 내보내기(saveProject)는 LBar 메뉴에 붙어 있다. **불러오기(openProject)는
// 일부러 안 붙였다** — 지금 모양으로 붙이면 안 되기 때문이다. 아래 주석 참고.

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

/**
 * `.bimova` 를 열어 캔버스에 올린다. **아직 메뉴에 안 붙어 있다.**
 *
 * 붙이려면 먼저 고쳐야 한다. 여기는 받은 JSON 을 `editor.loadSnapshot` 에
 * 그대로 넘기는데, 그러면 `lib/bimoveDocStore.loadDocument` 가 지키는 것들을
 * 통째로 건너뛴다 — 그쪽은 변환에서 빠진 도형이 있거나(`skipped > 0`) 결과가
 * 비면 **도면을 안 넘긴다.** 빈 캔버스를 올리는 순간 자동 저장이 돌아서 서버
 * 정본을 덮어쓰고, 그건 되돌릴 수 없기 때문이다.
 *
 * 즉 이 함수는 "파일 하나로 서버 도면을 날릴 수 있는" 길이다. 내보내기만
 * 먼저 열어 둔 이유가 그것이다 — 내보내기는 읽기라 위험이 없다.
 *
 * 붙일 때 할 일: 파싱한 스냅샷을 loadDocument 와 **같은 검사**에 통과시키고,
 * 통과하면 올리고 아니면 사유를 보여준다. 덮어쓰기 전에 서버본을 버전으로
 * 백업하는 것도 같이 봐야 한다 (App.tsx 의 backupServerSnapshot 과 같은 규칙).
 */
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
