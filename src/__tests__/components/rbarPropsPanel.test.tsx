/**
 * PropsPanel 훅 개수 회귀 테스트
 *
 * 예전엔 `if (sel.type === 'zone')` 분기 **안에서** useState 를 두 번 불렀다.
 * 다른 분기는 훅을 쓰지 않으니, Zone 을 선택했다가 벽을 선택하는 순간
 * 훅 개수가 2 → 0 으로 줄어 React 가 "Rendered fewer hooks than expected" 로
 * 터졌다 — 오른쪽 패널이 통째로 날아간다.
 *
 * 덤으로 있던 조용한 버그도 같이 본다: useState 초기값은 마운트 때 한 번만
 * 읽히므로, Zone A → Zone B 로 선택을 바꿔도 입력칸에 A 의 값이 남아 있었고
 * 그대로 blur 하면 B 에 A 의 이름이 써졌다. 이제 key={sel.id} 로 새로 마운트한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorContext } from '../../context/EditorContext'
import { PropsPanel, type SelInfo } from '../../components/RBar'
import type { ScaleConfig } from '../../lib/scaleConfig'

const SCALE: ScaleConfig = { unit: 'mm', pxPerMm: 1 }

const updateShape = vi.fn()
const editor = {
  getShape: () => ({ isLocked: false }),
  updateShape,
} as never

const zone = (id: string, label: string): NonNullable<SelInfo> => ({
  id: id as never,
  type: 'zone',
  props: { label, wallHeightMm: 2400, areaM2: 12.5, perimeterM: 14, color: '#34a853' },
})

const wall: NonNullable<SelInfo> = {
  id: 'shape:w1' as never,
  type: 'wall',
  props: { x2: 1000, y2: 0, thickness: 100 },
}

function renderPanel(sel: NonNullable<SelInfo>) {
  return render(
    <EditorContext.Provider value={editor}>
      <PropsPanel sel={sel} scale={SCALE} />
    </EditorContext.Provider>,
  )
}

afterEach(() => {
  cleanup()
  updateShape.mockReset()
})

describe('PropsPanel', () => {
  // ── 이게 크래시였다 ──
  it('Zone → 벽 으로 선택을 바꿔도 터지지 않는다 (훅 개수 고정)', () => {
    const { rerender } = renderPanel(zone('shape:z1', '거실'))
    expect(screen.getByDisplayValue('거실')).toBeTruthy()

    expect(() => {
      rerender(
        <EditorContext.Provider value={editor}>
          <PropsPanel sel={wall} scale={SCALE} />
        </EditorContext.Provider>,
      )
    }).not.toThrow()

    expect(screen.getByText('벽')).toBeTruthy()
  })

  it('벽 → Zone 으로 바꿔도 터지지 않는다', () => {
    const { rerender } = renderPanel(wall)
    expect(() => {
      rerender(
        <EditorContext.Provider value={editor}>
          <PropsPanel sel={zone('shape:z1', '주방')} scale={SCALE} />
        </EditorContext.Provider>,
      )
    }).not.toThrow()
    expect(screen.getByDisplayValue('주방')).toBeTruthy()
  })

  // ── 이게 조용한 버그였다 ──
  it('다른 Zone 을 선택하면 입력칸이 그 Zone 의 값으로 바뀐다', () => {
    const { rerender } = renderPanel(zone('shape:z1', '거실'))
    expect(screen.getByDisplayValue('거실')).toBeTruthy()

    rerender(
      <EditorContext.Provider value={editor}>
        <PropsPanel sel={zone('shape:z2', '주방')} scale={SCALE} />
      </EditorContext.Provider>,
    )

    expect(screen.getByDisplayValue('주방')).toBeTruthy()
    expect(screen.queryByDisplayValue('거실')).toBeNull()
  })

  it('Zone 을 바꾼 뒤 blur 하면 앞 Zone 의 이름을 써넣지 않는다', () => {
    const { rerender } = renderPanel(zone('shape:z1', '거실'))
    rerender(
      <EditorContext.Provider value={editor}>
        <PropsPanel sel={zone('shape:z2', '주방')} scale={SCALE} />
      </EditorContext.Provider>,
    )

    fireEvent.blur(screen.getByDisplayValue('주방'))

    expect(updateShape).toHaveBeenCalledTimes(1)
    const arg = updateShape.mock.calls[0][0] as { id: string; props: { label: string } }
    expect(arg.id).toBe('shape:z2')
    expect(arg.props.label).toBe('주방')
  })

  it('이름을 고쳐서 blur 하면 그 값이 저장된다', () => {
    renderPanel(zone('shape:z1', '거실'))
    const input = screen.getByDisplayValue('거실')
    fireEvent.change(input, { target: { value: '안방' } })
    fireEvent.blur(input)

    const arg = updateShape.mock.calls[0][0] as { props: { label: string; wallHeightMm: number } }
    expect(arg.props.label).toBe('안방')
    expect(arg.props.wallHeightMm).toBe(2400)
  })
})
