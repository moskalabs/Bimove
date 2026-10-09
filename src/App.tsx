import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { Tldraw, createSessionStateSnapshotSignal } from 'tldraw'
import type { Editor, TLEditorSnapshot } from 'tldraw'
import 'tldraw/tldraw.css'
import { lazyWithReload } from './lib/lazyWithReload'
import { TopBar } from './components/TopBar'
import { LBar } from './components/LBar'
import { RBar } from './components/RBar'
import { ToolOverlay } from './components/ToolOverlay'
import { RoomOverlay } from './components/RoomOverlay'
import { CanvasPickOverlay } from './components/CanvasPickOverlay'
import { AreaMeasureOverlay } from './components/AreaMeasureOverlay'
import { ZoneDrawOverlay } from './components/ZoneDrawOverlay'
import { ZoneNamePopup } from './components/ZoneNamePopup'
import { ScaleRuler } from './components/ScaleRuler'
import { ChatPanel } from './components/ChatPanel'
import { ProjectsPage } from './components/ProjectsPage'
import { AuthPage } from './components/AuthPage'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider, useToast } from './context/ToastContext'
const Viewer3D = lazyWithReload(() => import('./components/Viewer3D').then(m => ({ default: m.Viewer3D })))
const CadPreview = lazyWithReload(() => import('./components/CadPreview'))
import { WallShapeUtil } from './shapes/WallShape'
import { DxfGroupShapeUtil } from './shapes/DxfGroupShape'
import { DoorShapeUtil } from './shapes/DoorShape'
import { WindowShapeUtil } from './shapes/WindowShape'
import { BlockShapeUtil } from './shapes/BlockShape'
import { CommentShapeUtil } from './shapes/CommentShape'
import { DimensionShapeUtil } from './shapes/DimensionShape'
import { ZoneShapeUtil } from './shapes/ZoneShape'
import { WallTool } from './tools/WallTool'
import { DoorTool } from './tools/DoorTool'
import { WindowTool } from './tools/WindowTool'
import { BlockTool } from './tools/BlockTool'
import { CommentTool } from './tools/CommentTool'
import { DimensionTool } from './tools/DimensionTool'
import { EditorContext } from './context/EditorContext'
import { ProjectContext, ProjectNameContext } from './context/ProjectContext'
import { loadSnapshot, dropLegacySnapshot, saveThumbnail, touchProject, resolveSnapshot, renameProject } from './lib/projectStore'
import { readRecordSnapshot, writeFullRecords, writeRecordDiff, type SnapshotLike } from './lib/snapshotRecords'
import { createDebouncedSaver } from './lib/debouncedSave'
import { saveProjectSnapshot as saveSnapshotToSupabase, loadProjectSnapshot as loadSnapshotFromSupabase, saveProjectVersion, renameProject as renameProjectOnServer } from './lib/supabaseSync'
import { saveVersion, getVersion, type Version } from './lib/versions'
import { pushVersion } from './lib/versionSync'
import { backupServerSnapshot } from './lib/conflictBackup'
import { dwgToDxfBytes, decodeDxfBytes, commitCadImportV2 } from './lib/dxf'
import { initGrayscaleAttr, initDarkAttr, getDarkMode, getWheelBehavior, getWheelMode } from './lib/settings'
import './App.css'

// body data-grayscale / dark 동기화 (페이지 로드 시)
initGrayscaleAttr()
initDarkAttr()

/**
 * 버전을 로컬에 저장하고 서버에도 올린다.
 *
 * 예전엔 로컬(localStorage)에만 저장해서, 기기를 바꾸거나 캐시를 지우면
 * 버전 기록이 통째로 사라졌다. 서버 테이블과 그걸 쓰는 함수는 있었지만
 * 아무도 부르지 않는 죽은 코드였다.
 *
 * 서버 쓰기는 기다리지 않는다 — 네트워크를 기다리느라 자동 저장이
 * 밀릴 이유가 없다.
 *
 * 로컬 저장이 실패해도(용량 초과 등) 서버에는 올린다. 서버가 더 오래
 * 남는 사본이라, 로컬에 못 넣었다고 같이 버릴 이유가 없다. 다만 반환값은
 * **로컬에 남았을 때만** 버전을 준다 — 충돌 백업이 이 값을 보고
 * "덮어써도 되나" 를 판단하기 때문이다.
 */
async function saveVersionSynced(projectId: string, snapshot: object, label?: string) {
  const v = await saveVersion(projectId, snapshot, label)
  const forServer: Version = v ?? {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    label: label?.trim() || undefined,
    snapshot,
  }
  void pushVersion(projectId, forServer, saveProjectVersion)
  return v
}

const SHAPE_UTILS = [WallShapeUtil, DxfGroupShapeUtil, DoorShapeUtil, WindowShapeUtil, BlockShapeUtil, CommentShapeUtil, DimensionShapeUtil, ZoneShapeUtil]
const TOOLS = [WallTool, DoorTool, WindowTool, BlockTool, CommentTool, DimensionTool]

function EmptyCanvasHint({ editor }: { editor: Editor | null }) {
  const [hasShapes, setHasShapes] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const check = () => setHasShapes(editor.getCurrentPageShapes().length > 0)
    check()
    unsubRef.current = editor.store.listen(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(check, 300)
    })
    return () => { unsubRef.current?.(); if (timer) clearTimeout(timer) }
  }, [editor])

  if (!editor || hasShapes) return null

  return (
    <div className="empty-canvas-hint" style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', zIndex: 10,
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.93)', borderRadius: 16,
        padding: '28px 36px', textAlign: 'center',
        border: '1.5px dashed #d0d0d0', boxShadow: '0 2px 16px rgba(0,0,0,0.07)',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🏗️</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#222', marginBottom: 8 }}>
          도면을 시작해보세요
        </div>
        <div style={{ fontSize: 12, color: '#888', lineHeight: 1.8 }}>
          왼쪽 패널에서 <strong style={{ color: '#3b82f6' }}>벽</strong>을 선택하고<br />
          캔버스를 클릭·드래그해 그려보세요
        </div>
      </div>
    </div>
  )
}

interface PendingCadPreview {
  dxfText: string
  fileName: string
  fileSize: number
  isDwg: boolean
}

function EditorView({ projectId, projectName: initialProjectName, onBack }: { projectId: string; projectName?: string; onBack: () => void }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [show3D, setShow3D] = useState(false)
  const [pendingCadPreview, setPendingCadPreview] = useState<PendingCadPreview | null>(null)
  const { toast } = useToast()

  // ── 프로젝트 이름 ──
  //
  // 화면(오른쪽 패널 "파일명")은 입력한 그대로 즉시 바뀌고, 저장만 디바운스한다.
  // 서버가 정본이다 — 로컬 목록에는 대시보드에서 연 프로젝트가 아예 없을 수도
  // 있어서, 로컬만 쓰면 이름이 어디에도 안 남는다.
  //
  // projectId 는 이 컴포넌트가 살아 있는 동안 바뀌지 않는다 (프로젝트를 바꾸면
  // 대시보드를 거치면서 언마운트된다). 그래서 saver 를 한 번만 만들어 둔다.
  const [projectName, setProjectNameState] = useState(initialProjectName ?? '')
  const projectNameRef = useRef(projectName)
  const [nameSaver] = useState(() => createDebouncedSaver(() => {
    const next = projectNameRef.current.trim()
    if (!next) return  // 빈 이름은 저장하지 않는다 — 지우는 중일 뿐이다
    renameProject(projectId, next)
    void renameProjectOnServer(projectId, next).catch(err => {
      console.warn('[project] 이름 저장 실패', err)
    })
  }, 800))
  // 이름 고치고 바로 대시보드로 나가도 사라지지 않게, 언마운트 때는 flush.
  useEffect(() => () => nameSaver.flush(), [nameSaver])

  const setProjectName = useCallback((name: string) => {
    projectNameRef.current = name
    setProjectNameState(name)
    nameSaver.schedule()
  }, [nameSaver])

  const projectNameValue = useMemo(
    () => ({ name: projectName, setName: setProjectName }),
    [projectName, setProjectName],
  )

  // Supabase에서 로드 시 받아온 서버 타임스탬프 (충돌 방지용)
  const serverUpdatedAtRef = useRef<string | undefined>(undefined)

  const handleMount = (ed: Editor) => {
    ed.updateInstanceState({ isGridMode: false })
    // 대형 DXF 도면을 위해 최소 zoom을 0.0001로 확장 (10,000m 축소 지원)
    ed.setCameraOptions({
      ...ed.getCameraOptions(),
      zoomSteps: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
      wheelBehavior: getWheelBehavior(),
    })
    // 다크모드: tldraw 내부 테마도 동기화
    ed.user.updateUserPreferences({ colorScheme: getDarkMode() ? 'dark' : 'light' })
    const onSettingsChange = () => {
      ed.user.updateUserPreferences({ colorScheme: getDarkMode() ? 'dark' : 'light' })
      ed.setCameraOptions({ ...ed.getCameraOptions(), wheelBehavior: getWheelBehavior() })
    }
    window.addEventListener('bimova:settings', onSettingsChange)
    // Supabase와 localStorage 중 더 최근 쪽을 쓴다 (resolveSnapshot 참고)
    ;(async () => {
      let server: { snapshot: object; updatedAt?: string } | null = null
      try {
        const result = await loadSnapshotFromSupabase(projectId)
        if (result) {
          server = { snapshot: result.snapshot as object, updatedAt: result.updatedAt }
          serverUpdatedAtRef.current = result.updatedAt
        }
      } catch { /* Supabase 실패 */ }
      // 로컬 후보는 레코드 저장본이 우선이다. null 이면 아직 레코드로 저장된
      // 적이 없는(또는 읽기가 실패한) 프로젝트라 옛 통짜 스냅샷으로 폴백한다.
      const local = (await readRecordSnapshot(projectId)) ?? (await loadSnapshot(projectId))
      const saved = resolveSnapshot(projectId, server, local)
      if (saved) {
        try { ed.loadSnapshot(saved as TLEditorSnapshot) } catch { /* ignore corrupt */ }
      }
      // 빈 페이지 자동 정리: 셰이프가 없는 여분 페이지 삭제 (최소 1페이지 유지)
      const allPages = ed.getPages()
      if (allPages.length > 1) {
        const emptyPages = allPages.filter(p => ed.getPageShapeIds(p.id).size === 0)
        // 전부 빈 페이지면 첫 번째는 남김
        const toDelete = emptyPages.length === allPages.length
          ? emptyPages.slice(1)
          : emptyPages
        for (const p of toDelete) {
          ed.deletePage(p.id)
        }
      }
      // 셰이프가 있으면 전체 보기로 카메라 이동
      requestAnimationFrame(() => {
        const shapes = ed.getCurrentPageShapes()
        if (shapes.length > 0) {
          ed.zoomToFit()
        }
      })
      setEditor(ed)

      // 대시보드에서 "DWG 불러오기"로 생성된 경우: CadPreview 모달로 전달
      const win = window as unknown as Record<string, unknown>
      const pendingFile = win.__pendingCadFile as File | undefined
      if (pendingFile) {
        delete win.__pendingCadFile
        ;(async () => {
          try {
            const isDwg = pendingFile.name.toLowerCase().endsWith('.dwg')
            let dxfText: string
            if (isDwg) {
              const buffer = await pendingFile.arrayBuffer()
              const dxfBytes = await dwgToDxfBytes(buffer)
              if (!dxfBytes || dxfBytes.length < 100) return
              dxfText = decodeDxfBytes(dxfBytes)
            } else {
              const buffer = await pendingFile.arrayBuffer()
              dxfText = decodeDxfBytes(new Uint8Array(buffer))
            }
            if (!dxfText || (!dxfText.includes('SECTION') && !dxfText.includes('ENTITIES'))) return
            setPendingCadPreview({ dxfText, fileName: pendingFile.name, fileSize: pendingFile.size, isDwg })
          } catch (err) {
            console.error('[App] pending CAD file 처리 에러:', err)
          }
        })()
      }
    })()
  }

  useEffect(() => {
    if (!editor) return
    let supabaseTimer = 0
    let dirtySinceAuto = false
    let serverDirty = false        // 마지막 서버 동기화 뒤에 바뀐 게 있나
    let quotaWarned = false        // 용량 초과 토스트는 한 번만
    let quotaFailedAt = 0          // 마지막 용량 초과 시각 (0 = 없음)
    const QUOTA_RETRY_MS = 30_000   // 용량 초과 후 로컬 저장 재시도 간격

    // 세션(카메라/선택) 상태 신호. editor.getSnapshot() 은 세션이 아직 준비되지
    // 않았으면 예외를 던지는데, 안에서 읽는 건 결국 이 신호다 — 직접 읽어서
    // null 을 조용히 다룬다.
    const sessionState$ = createSessionStateSnapshotSignal(editor.store)

    /** 서버로 보낼 통짜 스냅샷. 세션이 아직 없으면 null. */
    const buildFullSnapshot = (): SnapshotLike | null => {
      const session = sessionState$.get()
      if (!session) return null
      return { document: editor.store.getStoreSnapshot(), session }
    }

    /** 다음 서버 동기화에 실어 보낼 썸네일. 보내고 나면 비운다. */
    let pendingThumbnail: string | undefined
    let sentThumbnail: string | undefined

    /**
     * 썸네일을 한 장 떠서 로컬과 (다음 틱에) 서버에 올린다.
     *
     * 대시보드 카드는 `projects.thumbnail` 을 읽는다 — 로컬에만 저장하면
     * 카드는 영원히 빈 칸이다. 그래서 여기서 뜬 걸 서버 동기화에 실어 보낸다.
     *
     * 200+ shapes 는 건너뛴다 (getSvgString 이 너무 무겁다). 도면 그룹은
     * shape 하나지만 안에 수천 개가 들어 있어서 개수로는 안 걸린다 —
     * 그래서 결과 크기로 한 번 더 막는다.
     */
    const THUMB_MAX_BYTES = 200 * 1024
    const updateThumbnail = async () => {
      const shapes = editor.getCurrentPageShapes()
      if (shapes.length === 0 || shapes.length > 200) return
      try {
        const result = await (editor as unknown as { getSvgString: (shapes: unknown[], opts: unknown) => Promise<{ svg: string; width: number; height: number } | undefined> })
          .getSvgString(shapes, { padding: 16, background: true })
        if (result?.svg) {
          const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(result.svg)))
          if (dataUrl.length > THUMB_MAX_BYTES) return
          saveThumbnail(projectId, dataUrl)
          // 같은 그림을 5초마다 다시 올리지는 않는다
          if (dataUrl !== sentThumbnail) pendingThumbnail = dataUrl
        }
      } catch { /* ignore thumbnail errors */ }
    }

    // 로컬 저장은 **레코드 단위**다 (snapshotRecords.ts 참고). tldraw 가 넘겨준
    // 변경 목록을 모아뒀다가 바뀐 레코드만 쓴다 — 손대지 않은 수 MB 짜리
    // dxfgroup 은 디스크에 그대로 누워 있는다.
    const pendingPuts = new Map<string, unknown>()
    const pendingDels = new Set<string>()
    // 마운트 직후 한 번은 전체를 쓴다. 지금 화면에 올라간 도면은 서버에서 왔을
    // 수도 있어서 디스크의 레코드가 이것과 전혀 다를 수 있다 — 그 위에 diff 를
    // 얹으면 두 도면이 섞인 괴물이 된다.
    let needFullWrite = true
    let legacyBlobDropped = false
    let localDirty = false
    let lastSessionJson = ''

    // 쓰기가 겹치면 순서가 뒤집힌다. 한 번에 하나만 돌리고, 그 사이에 쌓인
    // 변경은 루프를 한 바퀴 더 돌아 이어서 쓴다.
    let localWriteInFlight = false

    const persistLocal = async () => {
      if (localWriteInFlight) return
      localWriteInFlight = true
      try {
        while (localDirty || needFullWrite) {
          localDirty = false
          const session = sessionState$.get() ?? undefined
          const sessionJson = JSON.stringify(session ?? null)
          const full = needFullWrite
          const puts = new Map(pendingPuts)
          const dels = new Set(pendingDels)
          // 포인터만 움직여도 리스너는 깨어난다 — 쓸 게 없으면 쓰지 않는다.
          if (!full && puts.size === 0 && dels.size === 0 && sessionJson === lastSessionJson) break
          pendingPuts.clear()
          pendingDels.clear()

          let ok: boolean
          if (full) {
            // 모아둔 diff 는 버린다 — 전체 쓰기에 어차피 다 들어간다.
            needFullWrite = false
            const snapshot = buildFullSnapshot()
            if (!snapshot) { needFullWrite = true; break }  // 세션이 아직 없다. 다음 틱에.
            ok = await writeFullRecords(projectId, snapshot)
          } else {
            const meta = { schema: editor.store.schema.serialize(), session }
            ok = await writeRecordDiff(projectId, puts, dels, meta)
          }

          if (!ok) {
            // 반쪽만 쓰였을 수 있으니 다음 기회엔 전체를 다시 쓴다. 지금 바로
            // 또 쓰지는 않는다 — 용량 초과라면 연달아 또 실패할 뿐이다.
            needFullWrite = true
            quotaFailedAt = Date.now()
            if (!quotaWarned) {
              quotaWarned = true
              toast('이 기기에 도면을 캐시하지 못했습니다. 작업은 서버에 저장되지만, 오프라인에서는 열 수 없습니다.', 'error')
            }
            break
          }

          lastSessionJson = sessionJson
          quotaFailedAt = 0
          // updatedAt 은 성공했을 때만 올린다 — 실패했는데 올리면
          // resolveSnapshot() 이 낡은 로컬을 "최신"으로 착각한다.
          touchProject(projectId)
          if (full && !legacyBlobDropped) {
            // 레코드가 제대로 자리잡았으니 옛 통짜 스냅샷은 자리만 차지한다.
            legacyBlobDropped = true
            void dropLegacySnapshot(projectId)
          }
        }
      } finally {
        localWriteInFlight = false
      }
    }

    const saver = createDebouncedSaver(reason => {
      // 저장 실패 뒤에는 로컬 저장을 잠깐 쉰다. 공간이 나면 다시 되도록
      // 영구 포기는 안 하고 간격만 벌린다.
      //
      // 언마운트/탭 종료(flush) 는 마지막 기회라 그땐 무조건 시도한다.
      // IndexedDB 쓰기가 pagehide 뒤에 완주한다는 보장은 없지만, 1.5초마다
      // 쓰고 있으니 여기서 잃을 수 있는 건 최대 1.5초 분량이고, 같은 내용이
      // 5초 서버 동기화로도 올라간다.
      const backingOff = reason === 'timer' && Date.now() - quotaFailedAt < QUOTA_RETRY_MS
      if (!backingOff) void persistLocal()

      // flush 는 언마운트/탭 종료 직전이다 — 무거운 썸네일은 건너뛴다
      if (reason === 'timer') void updateThumbnail()
    }, 1500)

    // 탭 닫기/새로고침도 같은 손실 경로다 — 여기서도 대기 중인 저장을 흘려보낸다
    const flushOnHide = () => saver.flush()
    window.addEventListener('pagehide', flushOnHide)

    // 변경 목록에서 document 스코프 레코드만 모은다. 세션(카메라/선택/인스턴스)은
    // 레코드로 쪼개지 않고 meta 에 통째로 들어가므로 여기선 건너뛴다.
    const docTypes = editor.store.scopedTypes.document
    const unsub = editor.store.listen(entry => {
      const { added, updated, removed } = entry.changes
      for (const rec of Object.values(added)) {
        if (!docTypes.has(rec.typeName)) continue
        pendingPuts.set(rec.id, rec)
        pendingDels.delete(rec.id)
      }
      for (const [, to] of Object.values(updated)) {
        if (!docTypes.has(to.typeName)) continue
        pendingPuts.set(to.id, to)
        pendingDels.delete(to.id)
      }
      for (const rec of Object.values(removed)) {
        if (!docTypes.has(rec.typeName)) continue
        pendingPuts.delete(rec.id)
        pendingDels.add(rec.id)
      }
      dirtySinceAuto = true
      serverDirty = true
      localDirty = true
      saver.schedule()
    })

    // 아무것도 건드리지 않아도 한 번은 로컬에 내려놓는다. 서버에서 받아온
    // 도면이면 디스크에 레코드가 아직 없어서, 여기서 쓰지 않으면 오프라인
    // 캐시가 비어 있는 채로 남는다.
    saver.schedule()

    // Supabase 동기화 (5초 디바운스, optimistic locking)
    let lastServerUpdatedAt: string | undefined = serverUpdatedAtRef.current
    let syncFailed = false
    let syncPaused = false                      // 충돌 백업 실패 → 서버 쓰기 중단
    let backedUpServerAt: string | undefined    // 같은 서버 버전을 반복 백업하지 않기

    supabaseTimer = window.setInterval(async () => {
      if (!serverDirty || syncPaused) return
      // 통짜 스냅샷은 이제 여기서만 만든다 — 로컬 저장(1.5초)은 레코드 단위라
      // 필요 없다. 즉 수 MB 직렬화가 1.5초마다에서 5초마다로 줄었다.
      const snap = buildFullSnapshot()
      if (!snap) return
      serverDirty = false
      const thumb = pendingThumbnail
      try {
        const result = await saveSnapshotToSupabase(projectId, snap, thumb, lastServerUpdatedAt)
        if (result.conflict) {
          // 다른 세션이 먼저 저장했다. 예전엔 경고 로그만 찍고 조용히 덮어썼다 —
          // 상대가 한 작업이 흔적도 없이 사라진다. 이제 서버 내용을 버전으로
          // 백업한 뒤에만 덮어쓴다. 백업이 안 되면 서버 쓰기를 멈춘다 —
          // 조용히 날리는 것보다 동기화를 포기하는 쪽이 낫다
          // (로컬 저장은 계속 돌아가므로 지금 작업을 잃지는 않는다).
          console.warn('[supabase-sync] 충돌 감지 — 서버 내용 백업 후 덮어쓰기')
          const backup = await backupServerSnapshot(
            projectId, result.serverUpdatedAt, backedUpServerAt,
            { loadRemote: loadSnapshotFromSupabase, saveVersion: saveVersionSynced, getVersion },
          )
          if (backup === 'saved') backedUpServerAt = result.serverUpdatedAt
          if (backup === 'failed') {
            syncPaused = true
            toast('다른 기기의 변경과 충돌했지만 백업에 실패해 서버 저장을 멈췄습니다. 작업은 이 기기에 저장됩니다 — 새로고침해서 확인해주세요.', 'error')
            return
          }
          const retry = await saveSnapshotToSupabase(projectId, snap, thumb)
          lastServerUpdatedAt = retry.serverUpdatedAt
          if (thumb) { sentThumbnail = thumb; if (pendingThumbnail === thumb) pendingThumbnail = undefined }
          if (backup === 'saved') {
            toast('다른 기기에서 저장한 내용이 있어 이 화면 내용으로 덮어썼습니다. 서버에 있던 내용은 버전 기록에 백업했습니다.', 'error')
          }
        } else {
          lastServerUpdatedAt = result.serverUpdatedAt
          if (thumb) { sentThumbnail = thumb; if (pendingThumbnail === thumb) pendingThumbnail = undefined }
          if (syncFailed) {
            toast('서버 동기화가 복구되었습니다.', 'success')
            syncFailed = false
          }
        }
      } catch (err) {
        console.warn('[supabase-sync] snapshot save failed', err)
        serverDirty = true   // 다음 틱에 다시 시도
        if (!syncFailed) {
          toast('서버 동기화에 실패했습니다. 로컬에 저장됩니다.', 'error')
          syncFailed = true
        }
      }
    }, 5000)

    // 5분마다 자동 버전 저장 (변경 있을 때만)
    const AUTO_VERSION_MS = 5 * 60 * 1000
    const autoVersionTimer = window.setInterval(() => {
      if (!dirtySinceAuto) return
      // 비동기라 try/catch 로는 못 잡는다 — catch 를 붙여야 한다.
      dirtySinceAuto = false
      void saveVersionSynced(projectId, editor.store.getStoreSnapshot(), '자동저장')
        .catch(err => {
          console.warn('[auto-version] failed', err)
          toast('자동 버전 저장에 실패했습니다.', 'error')
        })
    }, AUTO_VERSION_MS)

    return () => {
      unsub()
      window.removeEventListener('pagehide', flushOnHide)
      clearInterval(supabaseTimer)
      clearInterval(autoVersionTimer)

      // 대기 중이던 저장을 버리지 않고 여기서 쓴다.
      // 예전엔 clearTimeout/clearInterval 로 그냥 날렸다 — CAD 를 불러오고
      // 로컬 1.5초 / 서버 5초가 지나기 전에 대시보드로 나가면 불러온 도면이
      // 어디에도 저장되지 않았고, 다시 들어오면 사라져 있었다.
      saver.flush()

      const snap = serverDirty && !syncPaused ? buildFullSnapshot() : null
      serverDirty = false
      if (snap) {
        // 언마운트 뒤에도 fetch 는 계속 진행된다. 충돌이면 서버를 건드리지 않고
        // 넘어간다 — 로컬에는 이미 남아 있고, 다음 진입 때 isLocalNewer 가 집어낸다.
        void saveSnapshotToSupabase(projectId, snap, pendingThumbnail, lastServerUpdatedAt)
          .catch(err => console.warn('[supabase-sync] 언마운트 flush 실패', err))
      }
    }
  }, [editor, projectId, toast])

  // 휠(중간) 버튼: 드래그=이동(오토캐드 방식), 더블클릭=화면 맞춤
  useEffect(() => {
    if (!editor) return
    let lastMiddleDown = 0
    let isPanning = false
    let panStartX = 0
    let panStartY = 0
    // didDrag 는 다음 누름에서 초기화하기 전까지 **직전 클릭이 팬이었는지**를
    // 들고 있다. 빠르게 두 번 끌었을 뿐인데 화면맞춤으로 오해하지 않으려고
    // 더블클릭 판정에서 같이 본다 — 끌었던 클릭은 더블클릭의 앞짝으로 안 친다.
    let didDrag = false

    // tldraw 도 휠 버튼을 자기 방식으로 처리한다 (Editor.js 의 MIDDLE_MOUSE_BUTTON:
    // inputs.isPanning → pointer_move 마다 setCamera, 뗄 때 slideCamera 관성,
    // 그리고 매번 stopCameraAnimation). 우리 핸들러와 겹치면서 세 가지가 터졌다.
    //   - 팬이 두 번 먹어서 화면이 두 배로 끌려간다
    //   - 더블클릭 화면맞춤 애니메이션이 tldraw 의 stopCameraAnimation 에 중간에
    //     잘린다 → 손이 조금만 흔들려도 "안 됨". 가만히 눌렀을 때만 가끔 성공해서
    //     대여섯 번 시도해야 되는 것처럼 보였다
    //   - 뗄 때 관성 슬라이드가 맞춰놓은 화면을 다시 밀어낸다
    // mousedown 의 stopPropagation 으로는 못 막는다 — tldraw 가 듣는 건 별개
    // 이벤트인 pointerdown 이다. 그래서 캡처 단계에서 휠 버튼 pointerdown 을
    // 통째로 끊는다 (뗄 때도 같이 — 내려간 걸 못 본 쪽에 올라간 것만 흘려보내지
    // 않는다). tldraw 는 document 에 pointer 리스너를 달지 않고 캔버스 엘리먼트의
    // React 핸들러만 쓰므로, 여기서 끊으면 아예 도달하지 않는다.
    const blockMiddlePointer = (e: PointerEvent) => {
      if (e.button !== 1) return
      if (!(e.target as HTMLElement)?.closest('.tl-container')) return
      e.preventDefault()
      e.stopPropagation()
    }

    const handleMiddleDown = (e: MouseEvent) => {
      if (e.button !== 1) return
      if (!(e.target as HTMLElement)?.closest('.tl-container')) return
      e.preventDefault()
      e.stopPropagation()

      // 윈도우 기본 더블클릭 간격이 500ms 다. 400 으로 잡아두면 조금만 느긋하게
      // 눌러도 두 번의 따로된 클릭이 된다.
      const now = Date.now()
      if (!didDrag && now - lastMiddleDown < 500) {
        // 더블클릭 → 화면 맞춤
        editor.zoomToFit({ animation: { duration: 250 } })
        lastMiddleDown = 0
        return
      }
      lastMiddleDown = now

      // 드래그 팬 시작
      isPanning = true
      didDrag = false
      panStartX = e.clientX
      panStartY = e.clientY
      document.body.style.cursor = 'grabbing'
    }

    const stopPan = () => {
      if (!isPanning) return
      isPanning = false
      document.body.style.cursor = ''
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning) return
      // 휠 버튼을 창 밖에서 떼면 mouseup 이 안 온다. buttons 의 중간버튼 비트(4)가
      // 비어 있으면 이미 놓은 것이니 여기서 스스로 풀어준다. 안 그러면 아무 버튼도
      // 안 눌렀는데 마우스만 움직여도 화면이 계속 끌려간다.
      if ((e.buttons & 4) === 0) { stopPan(); return }
      e.preventDefault()
      const dx = e.clientX - panStartX
      const dy = e.clientY - panStartY
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag = true
      if (!didDrag) return

      const camera = editor.getCamera()
      const zoom = camera.z
      editor.setCamera({
        x: camera.x + dx / zoom,
        y: camera.y + dy / zoom,
        z: zoom,
      })
      panStartX = e.clientX
      panStartY = e.clientY
    }

    const handleMouseUp = (e: MouseEvent) => {
      // button 이 1 이 아니어도(좌클릭 떼기 등) 중간버튼이 이미 빠졌으면 끝낸다.
      if (e.button === 1 || (e.buttons & 4) === 0) stopPan()
    }

    // auxclick 방지 (중간 버튼 기본 동작 차단)
    const handleAuxClick = (e: MouseEvent) => {
      if (e.button !== 1) return
      if ((e.target as HTMLElement)?.closest('.tl-container')) {
        e.preventDefault()
      }
    }

    // 마우스 휠 vs 터치패드 자동 감지 → wheelBehavior 동적 전환.
    // 여기서 고르는 건 tldraw 에 넘길 **설정값**이고, 실제 동작은 tldraw 가
    // ctrl 여부로 한 번 더 뒤집는다 (settings.ts 의 WheelBehavior 주석 참고).
    //
    //   마우스 휠           → 'zoom'  : 그냥 굴려서 확대/축소 (오토캐드 방식)
    //   터치패드 두손가락   → 'pan'   : 스크롤 = 이동
    //   터치패드 핀치       → 'pan'   : ctrl 이 붙어 오므로 tldraw 가 zoom 으로 뒤집는다
    //
    // 의도한 조작은 "그냥 휠 굴리면 확대" 다 — Ctrl+휠이 아니다.
    // 마우스에서 Ctrl+휠은 아무 일도 안 일어난다. ctrl 때문에 'pan' → 'zoom' 으로
    // 뒤집히지만, 뒤집혀 들어간 zoom 분기는 deltaY 가 아니라 deltaZ 를 읽고
    // 마우스는 deltaZ 를 0 으로 보내기 때문이다. wheelBehavior 로는 우회할 수
    // 없는 구조라 그냥 둔다 (휠만으로 확대가 되니 손해도 없다).
    //
    // 설정에서 '이동'/'확대' 를 직접 고르면 감지는 손을 뗀다 (getWheelMode() !== 'auto').
    // 전엔 감지가 무조건 덮어써서 설정 토글이 아무 효과도 없었다.
    //
    // 직전 값을 따로 캐시하지 않고 카메라 옵션을 그대로 읽는다. 전엔 'zoom' 으로
    // 하드코딩해 두고 비교했는데, 설정이 'pan' 인 상태에서 첫 마우스 휠이
    // want==='zoom' 을 "이미 같다"고 판단해 건너뛰고 그 뒤로 추적값과 실제값이
    // 계속 어긋났다. 설정 변경으로 옵션이 바뀌어도 캐시는 모른다.
    const handleWheel = (e: WheelEvent) => {
      if (getWheelMode() !== 'auto') return
      if (!(e.target as HTMLElement)?.closest('.tl-container')) return
      // ctrlKey → 터치패드 핀치 (또는 Ctrl+휠)
      // deltaMode 1 → 마우스 라인 스크롤
      // deltaMode 0 + 큰 정수값 → 마우스 픽셀 스크롤
      // 그 외 (작은/소수점 delta) → 터치패드 두손가락 스크롤
      let want: 'pan' | 'zoom'
      if (e.ctrlKey) {
        want = 'pan'  // tldraw 가 ctrl 로 뒤집어 결과적으로 확대가 된다
      } else if (e.deltaMode === 1) {
        want = 'zoom' // 마우스 라인 모드
      } else if (Math.abs(e.deltaY) >= 50 && e.deltaY % 1 === 0) {
        want = 'zoom' // 마우스 픽셀 모드 (큰 정수 단위)
      } else {
        want = 'pan'  // 터치패드 스크롤
      }
      const opts = editor.getCameraOptions()
      if (opts.wheelBehavior !== want) {
        editor.setCameraOptions({ ...opts, wheelBehavior: want })
      }
    }

    document.addEventListener('wheel', handleWheel, { capture: true, passive: true })
    document.addEventListener('pointerdown', blockMiddlePointer, true)
    document.addEventListener('pointerup', blockMiddlePointer, true)
    document.addEventListener('mousedown', handleMiddleDown, true)
    document.addEventListener('mousemove', handleMouseMove, true)
    document.addEventListener('mouseup', handleMouseUp, true)
    document.addEventListener('auxclick', handleAuxClick, true)
    // 창 밖으로 포커스가 나가면 mouseup 을 못 받는다 → 팬 상태를 끊는다.
    window.addEventListener('blur', stopPan)
    return () => {
      document.removeEventListener('wheel', handleWheel, true)
      document.removeEventListener('pointerdown', blockMiddlePointer, true)
      document.removeEventListener('pointerup', blockMiddlePointer, true)
      document.removeEventListener('mousedown', handleMiddleDown, true)
      document.removeEventListener('mousemove', handleMouseMove, true)
      document.removeEventListener('mouseup', handleMouseUp, true)
      document.removeEventListener('auxclick', handleAuxClick, true)
      window.removeEventListener('blur', stopPan)
      document.body.style.cursor = ''
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'z' && mod) {
        e.preventDefault()
        if (e.shiftKey) editor.redo(); else editor.undo()
      } else if (e.key === 'y' && mod) {
        e.preventDefault(); editor.redo()
      } else if (e.key === 'd' && mod) {
        e.preventDefault()
        const ids = editor.getSelectedShapeIds()
        if (ids.length) editor.duplicateShapes(ids, { x: 20, y: 20 })
      } else if (e.key === 'a' && mod) {
        e.preventDefault(); editor.selectAll()
      } else if (e.key === 'Escape') {
        editor.setCurrentTool('select'); editor.selectNone()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = editor.getSelectedShapeIds()
        if (ids.length) { e.preventDefault(); editor.deleteShapes(ids) }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editor])

  return (
    <ProjectContext.Provider value={projectId}>
    <ProjectNameContext.Provider value={projectNameValue}>
    <EditorContext.Provider value={editor}>
      <div className="bimova-layout">
        <TopBar />
        <div className="bimova-body">
          <LBar onBack={onBack} onShow3D={() => setShow3D(true)} />
          <main className="canvas-area">
            <ToolOverlay />
            <Tldraw
              key={projectId}
              shapeUtils={SHAPE_UTILS}
              tools={TOOLS}
              onMount={handleMount}
              hideUi
            />
            <EmptyCanvasHint editor={editor} />
            <CanvasPickOverlay />
            <AreaMeasureOverlay />
            <ZoneDrawOverlay />
            <ZoneNamePopup />
            <RoomOverlay />
            <ScaleRuler />
            <ChatPanel />
          </main>
          <RBar />
        </div>

        {show3D && (
          <Suspense fallback={
            <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: '#1e2228',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 15 }}>
              3D 엔진 로딩 중…
            </div>
          }>
            <Viewer3D onClose={() => setShow3D(false)} />
          </Suspense>
        )}

        {pendingCadPreview && editor && (
          <Suspense fallback={
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#1a1a2e',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 15 }}>
              CAD 미리보기 로딩 중…
            </div>
          }>
            <CadPreview
              dxfText={pendingCadPreview.dxfText}
              fileName={pendingCadPreview.fileName}
              fileSize={pendingCadPreview.fileSize}
              isDwg={pendingCadPreview.isDwg}
              onImport={async (selectedLayers, dxfText, viewportClip) => {
                const prev = pendingCadPreview
                setPendingCadPreview(null)
                try {
                  const count = await commitCadImportV2(editor, dxfText, selectedLayers, prev.fileName, prev.fileSize, prev.isDwg, undefined, viewportClip)
                  const fmt = prev.isDwg ? 'DWG' : 'DXF'
                  if (count > 0) {
                    toast(`"${prev.fileName}" ${fmt} 가져옴 (${count.toLocaleString()}개)`, 'success')
                  }
                  requestAnimationFrame(() => editor.zoomToFit())
                } catch (err) {
                  console.error('[App] CAD import 에러:', err)
                  toast('도면 렌더링 중 오류가 발생했습니다.', 'error')
                }
              }}
              onClose={() => setPendingCadPreview(null)}
            />
          </Suspense>
        )}
      </div>
    </EditorContext.Provider>
    </ProjectNameContext.Provider>
    </ProjectContext.Provider>
  )
}

function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (online) return null
  return <div className="offline-banner">⚠ 오프라인 상태입니다. 변경사항은 로컬에 저장됩니다.</div>
}

function SessionExpiredBanner() {
  const { sessionExpired, dismissSessionExpired } = useAuth()
  if (!sessionExpired) return null
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
      background: '#fef3c7', borderBottom: '2px solid #f59e0b',
      padding: '12px 20px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: 16,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
        ⚠ 세션이 만료되었습니다. 작업 내용은 로컬에 저장되어 있습니다. 다시 로그인해주세요.
      </span>
      <button
        onClick={dismissSessionExpired}
        style={{
          padding: '6px 16px', borderRadius: 8, border: 'none',
          background: '#f59e0b', color: '#fff', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        로그인하기
      </button>
    </div>
  )
}

function AppContent() {
  const { user, loading, sessionExpired } = useAuth()
  const [currentProject, setCurrentProject] = useState<{ id: string; name: string } | null>(null)

  // 유저 인증 후 body 속성 동기화 (모듈 레벨 init은 userId 없어서 실패할 수 있음)
  useEffect(() => {
    if (user) {
      initGrayscaleAttr()
      initDarkAttr()
    }
  }, [user])

  // 프로젝트 열기/닫기 시 브라우저 히스토리 동기화
  const openProject = (id: string, name: string) => {
    setCurrentProject({ id, name })
    history.pushState({ view: 'editor', id }, '', `#project=${id}`)
  }

  const closeProject = () => {
    setCurrentProject(null)
    // 히스토리에 대시보드 상태 추가 (뒤로가기 시 또 나가지 않도록)
    if (history.state?.view === 'editor') {
      history.pushState({ view: 'dashboard' }, '', window.location.pathname + window.location.search)
    }
  }

  // 브라우저 뒤로가기 → 대시보드로 복귀
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (!e.state || e.state.view !== 'editor') {
        setCurrentProject(null)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8f8f8', color: '#999', fontSize: 14,
      }}>
        로딩 중...
      </div>
    )
  }

  if (!user) {
    return (
      <>
        <SessionExpiredBanner />
        <AuthPage />
      </>
    )
  }

  // 세션 만료 상태이면 에디터 유지하면서 배너만 표시 (작업 보존)
  if (sessionExpired && currentProject) {
    return (
      <>
        <SessionExpiredBanner />
        <EditorView
          projectId={currentProject.id}
          projectName={currentProject.name}
          onBack={closeProject}
        />
      </>
    )
  }

  if (!currentProject) {
    return <ProjectsPage onOpen={(id, name) => openProject(id, name ?? '프로젝트')} />
  }

  return (
    <>
      <EditorView
        projectId={currentProject.id}
        projectName={currentProject.name}
        onBack={closeProject}
      />
      <OfflineBanner />
    </>
  )
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  )
}

export default App
