/**
 * 휠(중간) 버튼 이동/화면맞춤 회귀 테스트
 *
 * 한 번 통째로 먹통이 된 적이 있다. pointerdown 을 preventDefault 로 취소했는데,
 * 명세상 pointerdown 을 취소하면 브라우저가 뒤따르는 mousedown 을 안 쏜다.
 * 팬도 화면맞춤도 mousedown 에서 시작하니 둘 다 죽었다. 여기서 그걸 묶어둔다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installMiddleMouse, type MiddleMouseEditor } from '../../lib/middleMouse'

const MIDDLE = 1
const MIDDLE_BTN_BIT = 4

function makeEditor() {
  let camera = { x: 0, y: 0, z: 2 }
  return {
    getCamera: () => camera,
    setCamera: vi.fn((c: { x: number; y: number; z: number }) => { camera = c }),
    zoomToFit: vi.fn(),
    _camera: () => camera,
  }
}

let canvas: HTMLDivElement
let uninstall: () => void
let editor: ReturnType<typeof makeEditor>

beforeEach(() => {
  document.body.innerHTML = '<div class="tl-container"><div id="cv"></div></div>'
  canvas = document.getElementById('cv') as HTMLDivElement
  editor = makeEditor()
  uninstall = installMiddleMouse(editor as unknown as MiddleMouseEditor)
})

afterEach(() => {
  uninstall()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function down(x = 100, y = 100, button = MIDDLE) {
  const e = new MouseEvent('mousedown', { button, buttons: MIDDLE_BTN_BIT, clientX: x, clientY: y, bubbles: true, cancelable: true })
  canvas.dispatchEvent(e)
  return e
}

function move(x: number, y: number, buttons = MIDDLE_BTN_BIT) {
  const e = new MouseEvent('mousemove', { buttons, clientX: x, clientY: y, bubbles: true, cancelable: true })
  canvas.dispatchEvent(e)
  return e
}

function up(button = MIDDLE) {
  const e = new MouseEvent('mouseup', { button, buttons: 0, bubbles: true, cancelable: true })
  canvas.dispatchEvent(e)
  return e
}

/** jsdom 엔 PointerEvent 가 없다 — 타입 이름만 맞추면 리스너는 똑같이 받는다 */
function pointerDown(button = MIDDLE) {
  const e = new MouseEvent('pointerdown', { button, buttons: MIDDLE_BTN_BIT, bubbles: true, cancelable: true })
  canvas.dispatchEvent(e)
  return e
}

describe('installMiddleMouse', () => {
  it('pointerdown 을 취소하지 않는다 — 취소하면 mousedown 이 안 와서 전부 죽는다', () => {
    const e = pointerDown()
    expect(e.defaultPrevented).toBe(false)
  })

  it('그래도 tldraw 까지는 안 흘려보낸다 (전파 차단)', () => {
    const seen = vi.fn()
    document.body.addEventListener('pointerdown', seen)   // 캡처 단계보다 뒤
    pointerDown()
    expect(seen).not.toHaveBeenCalled()
    document.body.removeEventListener('pointerdown', seen)
  })

  it('캔버스 밖 휠 클릭은 건드리지 않는다', () => {
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    const e = new MouseEvent('pointerdown', { button: MIDDLE, bubbles: true, cancelable: true })
    const seen = vi.fn()
    document.body.addEventListener('pointerdown', seen)
    outside.dispatchEvent(e)
    expect(seen).toHaveBeenCalledTimes(1)
    document.body.removeEventListener('pointerdown', seen)
  })

  it('휠 버튼 드래그 → 카메라가 끌려간다', () => {
    down(100, 100)
    move(140, 120)           // dx 40, dy 20, zoom 2 → +20 / +10
    expect(editor.setCamera).toHaveBeenCalledTimes(1)
    expect(editor._camera()).toEqual({ x: 20, y: 10, z: 2 })
    up()
  })

  it('2px 이내 흔들림은 팬으로 안 친다', () => {
    down(100, 100)
    move(101, 101)
    expect(editor.setCamera).not.toHaveBeenCalled()
    up()
  })

  it('창 밖에서 버튼을 뗐으면 (buttons 에 4 없음) 팬이 스스로 풀린다', () => {
    down(100, 100)
    move(200, 200, 0)
    move(300, 300, 0)
    expect(editor.setCamera).not.toHaveBeenCalled()
  })

  it('휠 더블클릭 → 화면 맞춤', () => {
    down(100, 100)
    up()
    down(100, 100)
    expect(editor.zoomToFit).toHaveBeenCalledWith({ animation: { duration: 250 } })
  })

  it('끌었던 클릭은 더블클릭의 앞짝으로 안 친다', () => {
    down(100, 100)
    move(200, 200)
    up()
    down(200, 200)
    expect(editor.zoomToFit).not.toHaveBeenCalled()
  })

  it('500ms 넘게 벌어지면 따로된 클릭 두 번', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      down(100, 100)
      up()
      vi.setSystemTime(new Date('2026-01-01T00:00:00.700Z'))
      down(100, 100)
      expect(editor.zoomToFit).not.toHaveBeenCalled()
    } finally {
      up()
    }
  })

  it('왼쪽 버튼은 무시한다', () => {
    const e = down(100, 100, 0)
    expect(e.defaultPrevented).toBe(false)
    move(200, 200, 1)
    expect(editor.setCamera).not.toHaveBeenCalled()
  })

  it('떼고 나면 리스너가 남지 않는다', () => {
    uninstall()
    uninstall = () => {}
    down(100, 100)
    move(200, 200)
    expect(editor.setCamera).not.toHaveBeenCalled()
  })
})
