/**
 * commitCadImportV2 가 필요로 하는 최소 Editor 가짜 객체.
 *
 * 전에는 DXF 테스트 네 파일이 각자 같은 걸 복사해 들고 있었다. dxf.ts 가
 * editor 메서드를 하나 더 쓰기 시작하면 네 파일이 한꺼번에 수집 단계에서
 * 터졌다 — 실제로 멀티 레이아웃 작업이 getCurrentPageId 를 추가했을 때
 * 테스트 20개가 그렇게 죽었다. 한 곳에서 관리한다.
 *
 * 여기 없는 메서드를 dxf.ts 가 새로 쓰면 이 파일에 추가하면 된다.
 */
import { vi } from 'vitest'

export type MockEditorOptions = {
  /** 생성된 shape 를 받을 배열. 안 주면 내부 배열을 쓰고 _created() 로 꺼낸다. */
  created?: unknown[]
  /** getInstanceState().meta — 스케일 설정이 필요한 테스트용 */
  instanceMeta?: Record<string, unknown>
  /** 화면 크기. autoScale 계산에 들어간다 */
  viewport?: { width: number; height: number }
}

export function createMockEditor(opts: MockEditorOptions = {}) {
  const created = opts.created ?? []
  const meta = opts.instanceMeta ?? { unit: 'mm', pxPerMm: 1 }
  const viewport = opts.viewport ?? { width: 1200, height: 800 }

  return {
    getInstanceState: () => ({ meta }),
    getViewportScreenBounds: () => viewport,
    createShapes: (shapes: unknown[]) => { created.push(...shapes) },
    getCurrentPageShapes: () => created,
    getCamera: () => ({ x: 0, y: 0, z: 1 }),
    // 멀티 레이아웃 임포트가 "지금도 같은 페이지인가" 를 확인하는 데 쓴다.
    // 페이지를 넘나드는 테스트가 생기면 여기서 바꿀 수 있게 고정값을 돌려준다.
    getCurrentPageId: () => 'page:mock',
    setCamera: vi.fn(),
    selectAll: vi.fn(),
    selectNone: vi.fn(),
    getSelectedShapeIds: () => [],
    zoomToFit: vi.fn(),
    zoomToSelection: vi.fn(),
    select: vi.fn(),
    _created: () => created,
  }
}
