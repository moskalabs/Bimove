import type { Editor } from 'tldraw'

/** 이 모듈이 실제로 쓰는 editor 메서드만 — 테스트에서 가짜를 넘기기 쉽게 좁혔다 */
export type MiddleMouseEditor = Pick<Editor, 'getCamera' | 'setCamera' | 'zoomToFit'>

/**
 * 휠(중간) 버튼: 드래그=이동(오토캐드 방식), 더블클릭=화면 맞춤.
 *
 * App.tsx 의 useEffect 안에 있던 걸 꺼냈다 — 리스너 동작을 테스트에서 직접
 * 확인할 수 있게. 돌려주는 함수를 부르면 달아놓은 걸 다 뗀다.
 */
export function installMiddleMouse(editor: MiddleMouseEditor): () => void {
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
  //     잘린다 → 손이 조금만 흔들려도 "안 됨"
  //   - 뗄 때 관성 슬라이드가 맞춰놓은 화면을 다시 밀어낸다
  // mousedown 의 stopPropagation 으로는 못 막는다 — tldraw 가 듣는 건 별개
  // 이벤트인 pointerdown 이다. 그래서 캡처 단계에서 휠 버튼 pointerdown 을
  // 통째로 끊는다 (뗄 때도 같이 — 내려간 걸 못 본 쪽에 올라간 것만 흘려보내지
  // 않는다). tldraw 는 document 에 pointer 리스너를 달지 않고 캔버스 엘리먼트의
  // React 핸들러만 쓰므로, 여기서 끊으면 아예 도달하지 않는다.
  //
  // ⚠ 여기서 preventDefault 를 부르면 안 된다. pointerdown 을 취소하면 브라우저가
  // 뒤따르는 호환 마우스 이벤트(mousedown/mousemove/mouseup)를 아예 안 쏜다
  // (Pointer Events 명세의 compatibility mapping). 아래 팬/화면맞춤이 전부
  // mousedown 에서 시작하니, 취소해 버리면 휠 드래그 이동도 더블클릭 화면맞춤도
  // 통째로 죽는다. 실제로 그래서 두 기능이 한꺼번에 먹통이 됐다.
  // tldraw 를 막는 데는 stopPropagation 만으로 충분하다 — React 는 루트 컨테이너에
  // 리스너를 다는데, document 캡처 단계가 거기 닿기 전이다.
  // 휠 버튼의 브라우저 기본 동작(오토스크롤)은 mousedown 과 auxclick 쪽에서 막는다.
  const blockMiddlePointer = (e: PointerEvent) => {
    if (e.button !== 1) return
    if (!(e.target as HTMLElement)?.closest('.tl-container')) return
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

  document.addEventListener('pointerdown', blockMiddlePointer, true)
  document.addEventListener('pointerup', blockMiddlePointer, true)
  document.addEventListener('mousedown', handleMiddleDown, true)
  document.addEventListener('mousemove', handleMouseMove, true)
  document.addEventListener('mouseup', handleMouseUp, true)
  document.addEventListener('auxclick', handleAuxClick, true)
  // 창 밖으로 포커스가 나가면 mouseup 을 못 받는다 → 팬 상태를 끊는다.
  window.addEventListener('blur', stopPan)

  return () => {
    document.removeEventListener('pointerdown', blockMiddlePointer, true)
    document.removeEventListener('pointerup', blockMiddlePointer, true)
    document.removeEventListener('mousedown', handleMiddleDown, true)
    document.removeEventListener('mousemove', handleMouseMove, true)
    document.removeEventListener('mouseup', handleMouseUp, true)
    document.removeEventListener('auxclick', handleAuxClick, true)
    window.removeEventListener('blur', stopPan)
    document.body.style.cursor = ''
  }
}
