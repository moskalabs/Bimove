import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { Tldraw, createSessionStateSnapshotSignal } from 'tldraw'
import type { Editor, TLEditorSnapshot } from 'tldraw'
import 'tldraw/tldraw.css'
import { lazyWithReload } from './lib/lazyWithReload'
import { detectWheelBehavior, isCanvasWheelTarget } from './lib/wheelBehavior'
import { installMiddleMouse } from './lib/middleMouse'
import { TopBar } from './components/TopBar'
import { LBar } from './components/LBar'
import { RBar } from './components/RBar'
import { ToolOverlay } from './components/ToolOverlay'
import { WallDimOverlay } from './components/WallDimOverlay'
import { RoomOverlay } from './components/RoomOverlay'
import { CanvasPickOverlay } from './components/CanvasPickOverlay'
import { AreaMeasureOverlay } from './components/AreaMeasureOverlay'
import { ZoneDrawOverlay } from './components/ZoneDrawOverlay'
import { PolylineDrawOverlay } from './components/PolylineDrawOverlay'
import { ZoneNamePopup } from './components/ZoneNamePopup'
import { migrateCommentShapes } from './lib/commentMigration'
import { ScaleRuler } from './components/ScaleRuler'
import { CommentOverlay } from './components/CommentOverlay'
import { ChatPanel } from './components/ChatPanel'
import { ImportLoadingOverlay } from './components/ImportLoadingOverlay'
import { ProjectsPage } from './components/ProjectsPage'
import { AuthPage } from './components/AuthPage'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider, useToast } from './context/ToastContext'
import { ReadonlyContext } from './context/ReadonlyContext'
import { isReadonlyViewport, probeViewport } from './lib/readonlyMode'
const Viewer3D = lazyWithReload(() => import('./components/Viewer3D').then(m => ({ default: m.Viewer3D })))
const CadPreview = lazyWithReload(() => import('./components/CadPreview'))
import { WallShapeUtil } from './shapes/WallShape'
import { DxfGroupShapeUtil } from './shapes/DxfGroupShape'
import { DoorShapeUtil } from './shapes/DoorShape'
import { WindowShapeUtil } from './shapes/WindowShape'
import { BlockShapeUtil } from './shapes/BlockShape'
import { DimensionShapeUtil } from './shapes/DimensionShape'
import { ZoneShapeUtil } from './shapes/ZoneShape'
import { BoqTableShapeUtil } from './shapes/BoqTableShape'
import { WallTool } from './tools/WallTool'
import { DoorTool } from './tools/DoorTool'
import { WindowTool } from './tools/WindowTool'
import { BlockTool } from './tools/BlockTool'
import { DimensionTool } from './tools/DimensionTool'
import { EditorContext } from './context/EditorContext'
import { ProjectContext, ProjectNameContext } from './context/ProjectContext'
import { loadSnapshot, dropLegacySnapshot, saveThumbnail, touchProject, resolveSnapshot, renameProject, ensureProjectEntry, snapshotCandidates } from './lib/projectStore'
import { readRecordSnapshot, writeFullRecords, writeRecordDiff, type SnapshotLike } from './lib/snapshotRecords'
import { createDebouncedSaver, type DebouncedSaver } from './lib/debouncedSave'
import { saveProjectSnapshot as saveSnapshotToSupabase, loadProjectSnapshot as loadSnapshotFromSupabase, fetchProjectUpdatedAt, saveProjectVersion, renameProject as renameProjectOnServer, fetchProject } from './lib/supabaseSync'
import { readProjectHash, pushProjectHash, replaceProjectHash, clearProjectHash } from './lib/projectHash'
const CadCraftViewer = lazyWithReload(() => import('./components/CadCraftViewer').then(m => ({ default: m.CadCraftViewer })))
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

const SHAPE_UTILS = [WallShapeUtil, DxfGroupShapeUtil, DoorShapeUtil, WindowShapeUtil, BlockShapeUtil, DimensionShapeUtil, ZoneShapeUtil, BoqTableShapeUtil]
const TOOLS = [WallTool, DoorTool, WindowTool, BlockTool, DimensionTool]

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

function EditorView({ projectId, projectName: initialProjectName, onBack, onView }: {
  projectId: string
  projectName?: string
  onBack: () => void
  /** 보기(엔진) 화면으로 돌아가기. 안 주면 단추가 안 뜬다. */
  onView?: () => void
}) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [show3D, setShow3D] = useState(false)
  /**
   * 좁은 화면에서 **우측 속성 패널을 펼쳤나.**
   *
   * 넓은 화면에서는 우측바가 늘 붙어 있어서 이 값이 아무 일도 하지 않는다
   * (App.css 의 `@media (max-width: 768px)` 안에서만 읽힌다). 좁을 때는
   * 기본이 닫힘이다 — 안 그러면 패널이 캔버스를 통째로 덮는다.
   */
  const [rbarOpen, setRbarOpen] = useState(false)
  /**
   * 저장본을 하나도 읽지 못했을 때의 사유.
   *
   * 이게 차 있으면 **에디터를 올리지 않는다.** 빈 캔버스를 띄우면 자동 저장이
   * 곧바로 돌아서 멀쩡하던 도면을 덮어쓴다 — 되돌릴 수 없다.
   */
  const [loadError, setLoadError] = useState<string | null>(null)

  // 태블릿·모바일은 읽기 전용. 창을 줄였다 늘렸다 해도 따라오게 구독한다.
  const [readonly, setReadonly] = useState(() => isReadonlyViewport(probeViewport()))
  useEffect(() => {
    const update = () => setReadonly(isReadonlyViewport(probeViewport()))
    window.addEventListener('resize', update)
    const mq = window.matchMedia?.('(pointer: coarse)')
    mq?.addEventListener?.('change', update)
    return () => {
      window.removeEventListener('resize', update)
      mq?.removeEventListener?.('change', update)
    }
  }, [])
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
  // **렌더 중에 만들지 않는다.** 처음 이름을 고칠 때(이벤트 핸들러 안)에
  // 만든다 — 렌더 도중 ref 를 넘기면 리액트가 경고하고(react-hooks/refs),
  // StrictMode 의 두 번 렌더에서 타이머가 두 개 생길 수도 있다.
  // POTablesTab 의 senderRef 와 같은 관용구다.
  const nameSaverRef = useRef<DebouncedSaver | null>(null)
  const getNameSaver = useCallback(() => {
    if (nameSaverRef.current === null) {
      nameSaverRef.current = createDebouncedSaver(() => {
        const next = projectNameRef.current.trim()
        if (!next) return  // 빈 이름은 저장하지 않는다 — 지우는 중일 뿐이다
        renameProject(projectId, next)
        void renameProjectOnServer(projectId, next).catch(err => {
          console.warn('[project] 이름 저장 실패', err)
        })
      }, 800)
    }
    return nameSaverRef.current
  }, [projectId])
  // 이름 고치고 바로 대시보드로 나가도 사라지지 않게, 언마운트 때는 flush.
  // 한 번도 안 고쳤으면 saver 자체가 없다 — 그때는 할 일도 없다.
  useEffect(() => () => nameSaverRef.current?.flush(), [])

  const setProjectName = useCallback((name: string) => {
    projectNameRef.current = name
    setProjectNameState(name)
    getNameSaver().schedule()
  }, [getNameSaver])

  const projectNameValue = useMemo(
    () => ({ name: projectName, setName: setProjectName }),
    [projectName, setProjectName],
  )

  // Supabase에서 로드 시 받아온 서버 타임스탬프 (충돌 방지용)
  const serverUpdatedAtRef = useRef<string | undefined>(undefined)
  /**
   * 열 때 서버를 **못 읽었나** (네트워크/권한/500).
   *
   * "서버가 비었다" 와 다르다. 못 읽었으면 기준 시각이 없는 채로 저장
   * 루프가 돌고, 그러면 optimistic lock 없이 서버를 덮는다. 저장 루프가
   * 이 깃발을 보고 첫 쓰기 전에 서버를 한 번 더 읽는다.
   */
  const serverReadFailedRef = useRef(false)

  /**
   * handleMount 가 window 에 건 'bimova:settings' 리스너.
   *
   * handleMount 는 effect 가 아니라 tldraw 콜백이라 cleanup 자리가 없다.
   * 떼어내지 않으면 프로젝트를 여닫을 때마다 **버려진 에디터를 붙든 리스너가
   * 쌓인다** — 설정을 한 번 바꾸면 죽은 에디터들에 대고 다 같이 실행된다.
   */
  const settingsHandlerRef = useRef<(() => void) | null>(null)

  useEffect(() => () => {
    if (!settingsHandlerRef.current) return
    window.removeEventListener('bimova:settings', settingsHandlerRef.current)
    settingsHandlerRef.current = null
  }, [])

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
    // 같은 화면에서 에디터가 다시 마운트될 수도 있다 — 걸기 전에 먼저 뗀다.
    if (settingsHandlerRef.current) {
      window.removeEventListener('bimova:settings', settingsHandlerRef.current)
    }
    settingsHandlerRef.current = onSettingsChange
    window.addEventListener('bimova:settings', onSettingsChange)
    // Supabase와 localStorage 중 더 최근 쪽을 쓴다 (resolveSnapshot 참고)
    ;(async () => {
      let server: { snapshot: object; updatedAt?: string } | null = null
      serverReadFailedRef.current = false
      try {
        const result = await loadSnapshotFromSupabase(projectId)
        if (result) {
          server = { snapshot: result.snapshot as object, updatedAt: result.updatedAt }
          serverUpdatedAtRef.current = result.updatedAt
        }
      } catch (err) {
        // 전엔 통째로 삼켰다. 그러면 "서버에 아무것도 없다" 와 **"서버에
        // 못 물어봤다"** 가 구분되지 않는다. 뒤쪽이면 이 기기 저장본으로
        // 띄우게 되는데, 그 상태로 자동 저장이 돌면 기준 시각이 없어서
        // optimistic lock 없이 **못 본 서버 내용을 그대로 덮는다.**
        //
        // 그래서 "못 물어봤다" 를 기억해 둔다 — 저장 루프가 첫 쓰기 전에
        // 서버를 한 번 더 읽고, 서버가 더 최신이면 백업부터 뜬다.
        serverReadFailedRef.current = true
        console.warn('[load] 서버 도면을 읽지 못했다 — 이 기기 저장본으로 연다', err)
        toast('서버에서 도면을 불러오지 못해 이 기기에 저장된 내용으로 열었습니다. 최신이 아닐 수 있습니다.', 'error')
      }
      // 로컬 목록에 이 프로젝트를 등록한다. 프로젝트는 대시보드(서버)에서만
      // 만들어지므로 여기서 넣지 않으면 로컬 목록에 영영 안 들어가고,
      // touchProject()/isLocalNewer() 가 통째로 무력해진다.
      // **서버 시각으로** 넣는다 — 자세한 이유는 ensureProjectEntry 주석.
      ensureProjectEntry(projectId, projectName, server?.updatedAt)
      // 로컬 후보는 레코드 저장본이 우선이다. null 이면 아직 레코드로 저장된
      // 적이 없는(또는 읽기가 실패한) 프로젝트라 옛 통짜 스냅샷으로 폴백한다.
      const local = (await readRecordSnapshot(projectId)) ?? (await loadSnapshot(projectId))
      const saved = resolveSnapshot(projectId, server, local)

      // 저장본 읽기.
      //
      // 예전엔 실패를 통째로 삼켰다(`catch { /* ignore corrupt */ }`). 그러면
      // **빈 에디터가 멀쩡한 것처럼 올라오고**, 곧바로 자동 저장이 돌아서
      // 멀쩡하던 도면을 빈 캔버스로 덮어썼다. 되돌릴 방법이 없다.
      //
      // 그래서 두 가지를 바꾼다.
      //   1. 고른 쪽이 깨졌으면 **다른 쪽도 시도한다** (서버/로컬 중 하나는
      //      멀쩡한 경우가 많다).
      //   2. 둘 다 안 되면 **에디터를 올리지 않는다** — setEditor 를 부르지
      //      않으면 저장 루프가 시작되지 않으므로 아무것도 덮어쓰지 않는다.
      // 서버를 **못 읽었는데** 로컬도 없다. 이대로 가면 빈 에디터가 올라오고
      // 자동 저장이 돌아서, 서버에 멀쩡히 있던 도면을 **빈 캔버스로 덮는다.**
      // (서버를 멀쩡히 읽었는데 아무것도 없는 건 새 프로젝트다 — 그건 정상이다.)
      if (!saved && serverReadFailedRef.current) {
        console.error('[load] 서버도 못 읽고 이 기기에도 없다 — 에디터를 올리지 않는다')
        setLoadError('서버에 연결하지 못했고 이 기기에도 저장본이 없습니다. 연결을 확인하고 새로고침해주세요.')
        return
      }

      if (saved) {
        const candidates = snapshotCandidates(saved, server?.snapshot ?? null, local)
        let usedIndex = -1
        let lastErr: unknown
        for (let i = 0; i < candidates.length; i++) {
          try {
            // 옛 `comment` 도형을 **tldraw 가 보기 전에** 걷어낸다.
            // 모르는 타입이 하나라도 있으면 loadSnapshot 이 거부하고, 후보가
            // 전부 같은 이유로 실패해 프로젝트가 영영 안 열린다
            // (commentMigration.ts 머리말).
            const mig = migrateCommentShapes(candidates[i])
            if (mig.moved || mig.dropped) {
              console.info(`[comment] 옛 코멘트 도형 ${mig.moved}개를 옮겼다 (빈 것 ${mig.dropped}개는 버림)`)
            }
            ed.loadSnapshot(mig.snapshot as TLEditorSnapshot)
            usedIndex = i
            break
          } catch (err) {
            lastErr = err
            console.warn('[load] 저장본을 읽지 못했다 — 다른 후보를 시도한다', err)
          }
        }
        if (usedIndex < 0) {
          console.error('[load] 저장본을 모두 읽지 못했다', lastErr)
          setLoadError(lastErr instanceof Error ? lastErr.message : String(lastErr))
          return   // ← setEditor 를 부르지 않는다. 저장 루프가 안 돈다.
        }
        if (usedIndex > 0) {
          // 더 최신인 쪽이 깨져서 예비본으로 열었다. 조용히 넘기면 사용자가
          // "왜 아까 작업이 없지" 하고 그 위에 또 저장해 덮어쓴다.
          toast('최근 저장본이 손상돼 이전 저장본으로 열었습니다. 작업 내용을 확인해주세요.', 'error')
        }
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
    })().catch(err => {
      // 불러오는 길 어디서 터지든 **빈 화면으로 두지 않는다.** setEditor 까지
      // 못 갔으면 에디터는 안 올라오는데, 알려주지 않으면 사용자는 멈춘 줄 안다.
      console.error('[load] 프로젝트를 여는 중 실패', err)
      setLoadError(err instanceof Error ? err.message : String(err))
    })
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

    // Supabase 동기화 (optimistic locking)
    //
    // 5초였다. 큰 도면은 스냅샷이 수 MB 라, 그 주기로 쓰면 작은 인스턴스는
    // CPU 를 다 태운다 — t4g.nano 가 94% 에 묶여 쿼리가 전부 504 로 떨어진 적이
    // 있다. 압축해서 보내도(snapshotCodec) 직렬화·전송 비용은 남으므로 주기도
    // 같이 늘린다. 로컬 저장은 1.5초 레코드 단위라 이 값과 무관하게 촘촘하다 —
    // 서버가 늦어도 이 기기에서 작업을 잃지는 않는다.
    let lastServerUpdatedAt: string | undefined = serverUpdatedAtRef.current
    let syncFailed = false
    let syncPaused = false                      // 충돌 백업 실패 → 서버 쓰기 중단
    let backedUpServerAt: string | undefined    // 같은 서버 버전을 반복 백업하지 않기
    /**
     * 서버를 **못 읽고** 열었나 — 그러면 첫 쓰기 전에 한 번 더 읽어야 한다.
     *
     * 못 읽었으면 `lastServerUpdatedAt` 이 없다. 그 상태로 쓰면
     * `saveProjectSnapshot` 이 `.eq('updated_at', …)` 조건 없이 UPDATE 를
     * 날려서, 그 사이 다른 기기가 저장한 내용을 **충돌 감지도 백업도 없이**
     * 덮는다. 사용자는 이 기기 저장본을 보고 있었으니 눈치챌 방법도 없다.
     */
    let needServerRead = serverUpdatedAtRef.current === undefined && serverReadFailedRef.current
    /**
     * 지난 회차가 아직 안 끝났는지.
     *
     * setInterval 은 콜백이 async 여도 기다려주지 않는다. 큰 도면은 압축 +
     * 업로드에 30초를 넘길 수 있고, 그 사이에 편집이 있으면 다음 틱이 **같은
     * lastServerUpdatedAt 으로** 또 출발한다. 두 요청이 서로를 충돌로 보고
     * 쓸데없는 백업을 뜨거나, 늦게 끝난 쪽이 먼저 끝난 쪽을 덮는다.
     *
     * 진행 중이면 그냥 건너뛴다 — serverDirty 는 그대로 남아 다음 회차에서
     * 처리된다.
     *
     * boolean 이 아니라 **진행 중인 Promise** 를 들고 있는다. 화면을 떠날 때
     * 하는 마지막 저장이 그 뒤에 붙어야 하기 때문이다 — boolean 이면 "진행
     * 중" 을 알아도 기다릴 수가 없어서, 같은 기준 시각으로 요청이 하나 더
     * 나간다.
     */
    let syncInFlight: Promise<void> | null = null

    supabaseTimer = window.setInterval(async () => {
      if (syncInFlight) return
      if (!serverDirty || syncPaused) return
      // 통짜 스냅샷은 이제 여기서만 만든다 — 로컬 저장(1.5초)은 레코드 단위라
      // 필요 없다.
      const snap = buildFullSnapshot()
      if (!snap) return
      serverDirty = false
      const thumb = pendingThumbnail
      let settle!: () => void
      syncInFlight = new Promise<void>(res => { settle = res })
      try {
        if (needServerRead) {
          // 열 때 서버를 못 읽었다. 기준 시각 없이 쓰면 조건 없는 UPDATE 가
          // 되므로, 먼저 서버가 무엇을 들고 있는지 본다. 여기서 또 실패하면
          // 쓰지 않고 물러난다 — 다음 틱에 다시 온다 (로컬 저장은 계속 돈다).
          const late = await loadSnapshotFromSupabase(projectId)
          needServerRead = false
          lastServerUpdatedAt = late?.updatedAt
          // 서버에 뭔가 있으면 **무조건** 백업하고 덮는다.
          //
          // 전엔 `isLocalNewer()` 로 걸렀는데 그게 틀렸다. 열 때 서버를 못
          // 읽었으면 그 뒤 첫 로컬 저장이 `touchProject()` 로 **지금 시각**을
          // 찍는다. 그러면 isLocalNewer 가 거의 항상 참이 되어 백업을 건너뛰고,
          // 사용자가 **본 적도 없는** 서버 도면을 조용히 덮는다.
          //
          // 애초에 비교가 성립하지 않는다 — 우리가 연 건 로컬이고, 서버 쪽은
          // 보지도 못했다. "우리 게 더 새것" 이라고 주장할 근거가 없다.
          // backupServerSnapshot 이 같은 서버 버전을 두 번 뜨지는 않으므로
          // 무조건 불러도 버전 기록이 더럽혀지지 않는다.
          if (late) {
            console.warn('[supabase-sync] 못 보고 연 서버 내용 — 백업 후 덮어쓴다')
            const backup = await backupServerSnapshot(
              projectId, late.updatedAt, backedUpServerAt,
              { loadRemote: loadSnapshotFromSupabase, saveVersion: saveVersionSynced, getVersion },
            )
            if (backup === 'saved') {
              backedUpServerAt = late.updatedAt
              toast('서버에 더 최신 내용이 있어 이 화면 내용으로 덮어썼습니다. 서버에 있던 내용은 버전 기록에 백업했습니다.', 'error')
            }
            if (backup === 'failed') {
              syncPaused = true
              toast('서버에 더 최신 내용이 있지만 백업에 실패해 서버 저장을 멈췄습니다. 작업은 이 기기에 저장됩니다 — 새로고침해서 확인해주세요.', 'error')
              return
            }
          }
        }
        // 기준값이 없으면 **조건 없는 UPDATE** 가 된다 — 그 사이 다른 기기가
        // 쓴 걸 충돌 감지도 백업도 없이 덮는다. 본문이 비어 있어도 행은
        // 있으므로 시각만 따로 읽어 와서 조건을 건다. 한 번만 든다.
        if (lastServerUpdatedAt === undefined) {
          lastServerUpdatedAt = await fetchProjectUpdatedAt(projectId)
        }
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
          // 다시 쓸 때도 **기준값을 들고 간다.** 전엔 기준 없이 보냈다 —
          // 백업을 뜨는 사이(스냅샷 하나를 받고 버전으로 올리는 시간이다)에
          // 세 번째 기기가 저장하면 그걸 백업 없이 덮어썼다. 조건을 달면
          // 그 경우엔 0행이 되어 다시 충돌로 돌아온다.
          const retry = await saveSnapshotToSupabase(projectId, snap, thumb, result.serverUpdatedAt)
          if (retry.conflict) {
            // 백업하는 사이에 또 누가 저장했다. 여기서 덮지 않고 물러난다 —
            // serverDirty 를 다시 세워 두면 다음 틱이 **새 서버 버전을 백업한
            // 뒤에** 같은 과정을 되풀이한다. 한 바퀴 늦어질 뿐 잃는 건 없다.
            console.warn('[supabase-sync] 백업 중에 또 충돌 — 다음 틱에 다시 처리한다')
            lastServerUpdatedAt = retry.serverUpdatedAt
            serverDirty = true
            return
          }
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
      } finally {
        syncInFlight = null
        settle()
      }
    }, SERVER_SYNC_MS)

    // 30분마다 자동 버전 저장 (변경 있을 때만).
    // 전엔 5분이었는데, 수 MB 스냅샷이 project_versions 에 쌓여 DB 를
    // 가득 채웠다. 바꾸면 VersionHistoryPanel 의 안내 문구도 같이 고칠 것.
    const AUTO_VERSION_MS = 30 * 60 * 1000
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

      // `needServerRead` 면 기준 시각을 모른다 — 여기서 보내면 조건 없는
      // UPDATE 가 되어 남의 저장을 백업도 없이 덮는다. 보내지 않는다.
      // 로컬에는 남아 있고, 다음에 들어올 때 서버를 읽고 제대로 가린다.
      const snap = serverDirty && !syncPaused && !needServerRead ? buildFullSnapshot() : null
      serverDirty = false
      if (snap) {
        const thumb = pendingThumbnail
        // 언마운트 뒤에도 fetch 는 계속 진행된다. 충돌이면 서버를 건드리지 않고
        // 넘어간다 — 로컬에는 이미 남아 있고, 다음 진입 때 isLocalNewer 가 집어낸다.
        //
        // **진행 중인 저장이 있으면 그 뒤에 붙인다.** 바로 보내면 둘이 같은
        // lastServerUpdatedAt 으로 출발해 서로를 충돌로 보거나, 늦게 끝난 쪽이
        // 먼저 끝난 쪽을 덮는다. 기준 시각은 기다린 뒤에 읽어야 최신이다.
        const inFlight = syncInFlight
        void (async () => {
          if (inFlight) { try { await inFlight } catch { /* 그쪽에서 이미 처리했다 */ } }
          // ── 기다린 뒤에 **다시 본다** ──
          //
          // 위에서 "보낸다" 를 정한 건 기다리기 **전**이다. 기다리는 동안 그
          // 동기화가 충돌을 만나 서버를 백업하려다 실패했으면 syncPaused 가
          // 선다. 그 뒤로는 아무것도 쓰면 안 되는데, 여기서 다시 안 보면
          // 그대로 보낸다 — 게다가 그 경로는 기준 시각을 새로 받아왔으므로
          // 조건이 **맞아떨어져 실제로 덮인다.** 백업하려던 서버 도면이
          // 그렇게 사라진다.
          //
          // 늦은 서버 읽기(needServerRead) 가 실패로 끝난 경우도 같다 —
          // 기준 시각을 여전히 모르는 채로 쓰게 된다.
          if (syncPaused || needServerRead) {
            console.warn('[supabase-sync] 언마운트 flush 취소 — 그 사이 서버 쓰기가 막혔다')
            return
          }
          try {
            // 주기 저장과 같은 규칙. 기준값이 없으면 조건 없는 UPDATE 가 되므로
            // 시각만 따로 읽어 와서 건다. 서버에 행이 아예 없으면 undefined 가
            // 그대로 와서 첫 저장(INSERT)이 된다 — 그건 막을 이유가 없다.
            const expected = lastServerUpdatedAt ?? await fetchProjectUpdatedAt(projectId)
            const result = await saveSnapshotToSupabase(projectId, snap, thumb, expected)
            if (!result.conflict) return

            // ── 충돌은 **버리면 안 된다** ──
            //
            // 전엔 결과를 안 보고 끝냈다. 안 썼으니 서버는 멀쩡하지만, 이쪽의
            // 마지막 편집이 서버에 못 올라간 채 남는다. 다음에 들어올 때
            // `isLocalNewer` 가 가려 주리라 믿었는데 그 비교는 **시각**으로
            // 하므로, 서버 쪽이 더 최신이거나 기기 시계가 어긋나 있으면
            // 서버본을 골라 그 편집을 덮는다.
            //
            // 그래서 주기 저장과 같은 규칙을 쓴다: **서버를 버전으로 백업한
            // 뒤에만** 덮는다. 백업이 안 되면 안 쓴다 — 로컬에는 남아 있고,
            // 조용히 날리는 것보다 안 올리는 쪽이 낫다.
            console.warn('[supabase-sync] 언마운트 flush 충돌 — 서버 백업 후 재시도')
            const backup = await backupServerSnapshot(
              projectId, result.serverUpdatedAt, backedUpServerAt,
              { loadRemote: loadSnapshotFromSupabase, saveVersion: saveVersionSynced, getVersion },
            )
            if (backup === 'failed') {
              console.warn('[supabase-sync] 백업 실패 — 언마운트 flush 포기 (로컬에는 남아 있다)')
              return
            }
            backedUpServerAt = result.serverUpdatedAt
            const retry = await saveSnapshotToSupabase(projectId, snap, thumb, result.serverUpdatedAt)
            if (retry.conflict) {
              // 백업하는 사이에 또 누가 저장했다. 여기서 덮지 않는다 —
              // 이 화면은 이미 사라졌으므로 다음 틱이란 게 없고, 덮으면
              // 그 세 번째 기기의 저장이 백업 없이 날아간다.
              console.warn('[supabase-sync] 백업 중에 또 충돌 — 안 쓰고 물러난다')
            }
          } catch (err) {
            console.warn('[supabase-sync] 언마운트 flush 실패', err)
          }
        })()
      }
    }
  }, [editor, projectId, toast])

  // 휠(중간) 버튼: 드래그=이동(오토캐드 방식), 더블클릭=화면 맞춤.
  // 핸들러는 lib/middleMouse.ts 로 옮겼다 — 이벤트 흐름을 테스트로 묶어두려고.
  useEffect(() => {
    if (!editor) return
    return installMiddleMouse(editor)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    // 마우스 휠 vs 터치패드 자동 감지 → wheelBehavior 동적 전환.
    // 어떻게 가르는지는 lib/wheelBehavior.ts 에 있다.
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
      // 오버레이(공간지정·면적측정) 위도 캔버스로 본다 — wheelBehavior 주석 참고.
      if (!isCanvasWheelTarget(e.target)) return
      const want = detectWheelBehavior(e)
      const opts = editor.getCameraOptions()
      if (opts.wheelBehavior !== want) {
        editor.setCameraOptions({ ...opts, wheelBehavior: want })
      }
    }

    document.addEventListener('wheel', handleWheel, { capture: true, passive: true })
    return () => document.removeEventListener('wheel', handleWheel, true)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const handleKeyDown = (e: KeyboardEvent) => {
      // 읽기 전용에서는 편집 단축키를 통째로 막는다. 도구 바를 감춰도
      // Ctrl+D / Delete 는 그대로 들어오기 때문이다.
      if (readonly) {
        if (e.key === 'Escape') editor.selectNone()
        return
      }
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
  }, [editor, readonly])

  // 읽기 전용이면 tldraw 쪽도 잠그고 도구를 선택으로 돌려놓는다.
  // UI 를 감추는 것만으로는 부족하다 — 캔버스에 직접 들어오는 조작이 남는다.
  useEffect(() => {
    if (!editor) return
    editor.updateInstanceState({ isReadonly: readonly })
    if (readonly) {
      editor.setCurrentTool('select')
      editor.selectNone()
    }
  }, [editor, readonly])

  // 저장본을 못 읽었으면 **에디터 대신 이 화면**을 띄운다. 여기서 끝내야
  // setEditor 로 넘어간 뒤 자동 저장이 도는 일이 없다.
  if (loadError) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8f8f8', padding: 24,
      }}>
        <div style={{
          maxWidth: 520, background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10,
          padding: '28px 30px', boxShadow: '0 2px 16px rgba(0,0,0,.06)',
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>
            도면을 열지 못했습니다
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#444', margin: '0 0 14px' }}>
            저장된 내용을 읽는 데 실패했어요. <b>아무것도 덮어쓰지 않았습니다</b> —
            저장된 도면은 그대로 있어요.
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: '#666', margin: '0 0 18px' }}>
            다시 시도해보시고, 계속 같으면 <b>버전 기록</b>에서 이전 저장본으로
            되돌릴 수 있어요.
          </p>
          <pre style={{
            fontSize: 11, color: '#888', background: '#fafafa', border: '1px solid #eee',
            borderRadius: 6, padding: '8px 10px', margin: '0 0 18px',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>{loadError}</pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: '1px solid #2f6fed', background: '#2f6fed', color: '#fff', borderRadius: 6,
              }}
            >
              다시 시도
            </button>
            {onBack && (
              <button
                onClick={onBack}
                style={{
                  padding: '8px 16px', fontSize: 13, cursor: 'pointer',
                  border: '1px solid #ddd', background: '#fff', color: '#444', borderRadius: 6,
                }}
              >
                프로젝트 목록으로
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <ReadonlyContext.Provider value={readonly}>
    <ProjectContext.Provider value={projectId}>
    <ProjectNameContext.Provider value={projectNameValue}>
    <EditorContext.Provider value={editor}>
      <div className={`bimova-layout${rbarOpen ? ' rbar-open' : ''}`}>
        <TopBar />
        <div className="bimova-body">
          <LBar
            onBack={onBack}
            onView={onView}
            onShow3D={() => setShow3D(true)}
            onToggleRbar={() => setRbarOpen(v => !v)}
            rbarOpen={rbarOpen}
          />
          <main className="canvas-area">
            <ToolOverlay />
            <WallDimOverlay />
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
            <PolylineDrawOverlay />
            <ZoneNamePopup />
            <RoomOverlay />
            <ScaleRuler />
            {/* 코멘트 핀은 다른 오버레이 **위**에 온다 — 눌러야 하는 것이라
                면적 라벨·방 이름에 가려지면 안 된다. */}
            <CommentOverlay />
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
    </ReadonlyContext.Provider>
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

/** 서버 스냅샷 저장 주기. 로컬 저장(1.5초)과 달리 통짜 직렬화라 무겁다. */
const SERVER_SYNC_MS = 30 * 1000

function AppContent() {
  const { user, loading, sessionExpired } = useAuth()
  const { toast } = useToast()
  const [currentProject, setCurrentProject] = useState<{ id: string; name: string } | null>(null)
  /**
   * 주소에 실려 들어온 프로젝트 id — 아직 되살리지 못한 것.
   *
   * 첫 렌더에서 바로 읽는다. 이걸 effect 에서 읽으면 대시보드를 한 프레임
   * 그렸다가 에디터로 넘어가서, 목록을 잘못 누른 것처럼 번쩍인다.
   */
  const [restoreId, setRestoreId] = useState<string | null>(() => readProjectHash())
  /**
   * `#cadcraft` — CADCraft 엔진을 시험하는 화면.
   *
   * tldraw 를 걷어내려면 저장된 도면(전부 tldraw 스냅샷)을 먼저 옮겨야 한다.
   * 그동안 나란히 두고 비교하려고 **따로 난 문**이다. 기존 흐름은 이 플래그가
   * 켜질 때만 비켜준다.
   */
  const [cadcraft, setCadcraft] = useState(() => window.location.hash === '#cadcraft')
  /**
   * 프로젝트를 열었을 때 **무엇으로 보여줄까.**
   *
   * 기본이 `view` — CADCraft 엔진이다. tldraw 를 걷어내는 중이라 엔진이 진짜
   * 도면을 제대로 그리는지 늘 보이는 자리에서 확인해야 하고, 아직 서비스
   * 전이라 그래도 된다.
   *
   * 편집(그리기·물량·발주서·블록)은 전부 tldraw 에 있다. 그래서 `edit` 가
   * 없어지는 게 아니라 **한 번 눌러 들어가는 자리**로 간다 — 주소의 `#edit`
   * 이거나 엔진 화면의 '편집 화면' 단추다.
   */
  const [mode, setMode] = useState<'view' | 'edit'>(
    () => (window.location.hash === '#edit' ? 'edit' : 'view'),
  )

  // 유저 인증 후 body 속성 동기화 (모듈 레벨 init은 userId 없어서 실패할 수 있음)
  useEffect(() => {
    if (user) {
      initGrayscaleAttr()
      initDarkAttr()
    }
  }, [user])

  /**
   * 계정이 바뀌면 **열려 있던 도면을 닫는다.**
   *
   * 전엔 `currentProject` 를 그대로 뒀다. 그러면 로그아웃하고 다른 계정으로
   * 들어왔을 때 남의 도면이 화면에 남아 있고, 더 나쁘게는 그 에디터의 자동
   * 저장 루프가 계속 돌아서 **새 계정의 로컬 저장 칸(u:<userId>:…)에 남의
   * 도면을 쓴다.** 사무실에서 계정을 돌려 쓰는 데라면 금방 겹친다.
   *
   * 닫고 나서 주소의 `#project=` 는 다시 집어 든다 — 같은 기기에서 같은
   * 도면을 보던 사람이 다시 로그인한 경우가 많고, 되살리는 길에 이미
   * "이게 내 것인가" 를 서버에 물어보는 확인이 들어 있다. 남의 것이면
   * 거기서 걸러져 주소까지 치워진다.
   */
  const lastUserIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = user?.id ?? null
    if (lastUserIdRef.current === id) return
    const switched = lastUserIdRef.current !== null
    lastUserIdRef.current = id
    if (!switched) return      // 첫 로그인 — 닫을 게 없다
    setCurrentProject(null)
    setRestoreId(readProjectHash())
  }, [user?.id])

  // 프로젝트 열기/닫기 시 브라우저 히스토리 동기화
  const openProject = (id: string, name: string) => {
    setCurrentProject({ id, name })
    pushProjectHash(id)
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

  /**
   * `#project=<id>` 로 들어왔으면 그 도면을 연다 (새로고침·북마크·공유된 주소).
   *
   * 로컬 목록에 이름이 있어도 **서버에 한 번 물어본다.** 이름을 몰라서가 아니라
   * 그 프로젝트가 아직 내 것인지 봐야 하기 때문이다 — 지워졌거나 다른 계정의
   * id 를 주소창에 넣었을 수 있다. 로그인 전이면 user 가 null 이라 여기서
   * 기다리고, 로그인하는 순간 다시 들어온다.
   */
  useEffect(() => {
    if (!restoreId || !user) return
    let alive = true
    void (async () => {
      try {
        const p = await fetchProject(restoreId, user.id)
        if (!alive) return
        if (p) {
          // 대시보드를 안 거쳐 들어왔으니 로컬 목록에도 없을 수 있다.
          // updatedAt 은 서버 시각으로 — projectStore 쪽 주석 참고.
          ensureProjectEntry(p.id, p.name, p.updated_at)
          // 이미 이 주소에 서 있다. push 하면 뒤로가기를 두 번 눌러야 나간다.
          replaceProjectHash(p.id)
          setCurrentProject({ id: p.id, name: p.name })
        } else {
          clearProjectHash()
          toast('그 프로젝트를 찾을 수 없습니다. 지워졌거나 다른 계정의 도면일 수 있습니다.', 'error')
        }
      } catch (err) {
        if (!alive) return
        // 네트워크 문제면 **주소는 그대로 둔다** — 다시 새로고침하면 열린다.
        // 여기서 hash 를 치우면 되살릴 단서까지 사라진다.
        console.warn('[restore] 프로젝트를 확인하지 못했다', err)
        toast('프로젝트를 불러오지 못했습니다. 연결을 확인해주세요.', 'error')
      }
      if (alive) setRestoreId(null)
    })()
    return () => { alive = false }
  }, [restoreId, user, toast])

  // `#cadcraft` 는 로그인과 무관한 실험 화면이다. 인증·복원보다 앞에 둔다 —
  // 뒤에 두면 로그인하지 않고는 열어볼 수가 없다.
  if (cadcraft) {
    return (
      <Suspense fallback={<ImportLoadingOverlay message="CAD 엔진 불러오는 중..." />}>
        <CadCraftViewer onClose={() => {
          setCadcraft(false)
          history.replaceState(null, '', window.location.pathname + window.location.search)
        }} />
      </Suspense>
    )
  }

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

  // 세션이 끊겼는데 열어둔 도면이 있으면 **에디터를 그대로 둔다.** 배너만
  // 띄우고 작업을 이어갈 수 있게 한다 — 그 사이 저장은 로컬로 간다.
  //
  // 이 분기가 `!user` 보다 **먼저** 와야 한다. 만료되면 user 가 null 이라,
  // 순서가 반대였을 때는 로그인 화면이 먼저 걸려 여기까지 오지 못했다
  // (사실상 죽은 코드였다). 사용자 스코프를 놓지 않는 것도 짝이다 —
  // AuthContext 의 `if (!expired) setCurrentUserId(...)` 참고.
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

  if (!user) {
    return (
      <>
        <SessionExpiredBanner />
        <AuthPage />
      </>
    )
  }

  // 주소에 실린 도면을 확인하는 동안. `!user` 보다 **뒤**에 와야 한다 —
  // 로그인 전에 걸리면 restoreId 를 치울 사람이 없어서 영원히 돌아간다.
  if (restoreId) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8f8f8', color: '#999', fontSize: 14,
      }}>
        도면을 여는 중...
      </div>
    )
  }

  if (!currentProject) {
    return <ProjectsPage onOpen={(id, name) => openProject(id, name ?? '프로젝트')} />
  }

  // 기본은 **엔진 화면**이다 (mode 주석). 편집은 한 번 눌러 들어간다.
  if (mode === 'view') {
    return (
      <>
        <Suspense fallback={<ImportLoadingOverlay message="CAD 엔진 불러오는 중..." />}>
          <CadCraftViewer
            project={{ id: currentProject.id, name: currentProject.name }}
            onEdit={() => { setMode('edit'); history.replaceState(null, '', '#edit') }}
            onClose={closeProject}
          />
        </Suspense>
        <OfflineBanner />
      </>
    )
  }

  return (
    <>
      <EditorView
        projectId={currentProject.id}
        projectName={currentProject.name}
        onBack={closeProject}
        onView={() => { setMode('view'); history.replaceState(null, '', window.location.pathname + window.location.search) }}
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
