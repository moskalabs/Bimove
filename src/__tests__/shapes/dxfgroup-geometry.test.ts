/**
 * DxfGroupShape 의 클릭 판정이 **실제 선** 을 따르는지.
 *
 * 예전 getGeometry 는 바운딩박스를 채운 Polygon2d 였다. 그러면
 * (1) 도형이 없는 빈 속을 눌러도 잡히고
 * (2) 큰 그룹의 박스가 그 안에 있는 작은 가구를 덮어서 위에 있는 걸 못 고른다.
 * 쪼개기를 고쳐도 "엉뚱한 게 잡힌다" 는 체감이 남는 이유가 이쪽이었다.
 *
 * getGeometry 는 editor 를 쓰지 않는 순수 메서드라 prototype 에서 바로 부른다.
 */
import { describe, it, expect } from 'vitest'
import { Vec } from 'tldraw'
import { DxfGroupShapeUtil, type DxfGroupShape } from '../../shapes/DxfGroupShape'

function shape(props: Partial<DxfGroupShape['props']>): DxfGroupShape {
  return {
    typeName: 'shape',
    id: 'shape:test' as DxfGroupShape['id'],
    type: 'dxfgroup',
    x: 0, y: 0, rotation: 0, index: 'a1' as DxfGroupShape['index'],
    parentId: 'page:test' as DxfGroupShape['parentId'],
    isLocked: false, opacity: 1, meta: {},
    props: {
      w: 100, h: 100, pathData: '', thickness: 2, segCount: 0,
      textsJson: '', hatchesJson: '', ...props,
    },
  }
}

const geom = (s: DxfGroupShape) =>
  (DxfGroupShapeUtil.prototype.getGeometry as (s: DxfGroupShape) => {
    hitTestPoint(p: Vec, margin: number, hitInside: boolean): boolean
  }).call(null as never, s)

describe('DxfGroupShape getGeometry', () => {
  it('선 위를 누르면 잡히고, 빈 속을 누르면 안 잡힌다', () => {
    // 왼쪽 위 → 오른쪽 아래 대각선 하나. bbox 는 100x100.
    const g = geom(shape({ pathData: 'M0.0,0.0L100.0,100.0', segCount: 1 }))

    expect(g.hitTestPoint(new Vec(50, 50), 1, true)).toBe(true)   // 선 위
    expect(g.hitTestPoint(new Vec(95, 5), 1, true)).toBe(false)   // 박스 안, 선에서 멀다
    expect(g.hitTestPoint(new Vec(5, 95), 1, true)).toBe(false)
  })

  it('가구 윤곽선의 빈 속은 안 잡힌다 — 큰 그룹이 작은 걸 덮지 않게', () => {
    // 100x100 사각 윤곽선 (채움 없음)
    const g = geom(shape({
      pathData: 'M0.0,0.0L100.0,0.0M100.0,0.0L100.0,100.0'
        + 'M100.0,100.0L0.0,100.0M0.0,100.0L0.0,0.0',
      segCount: 4,
    }))

    expect(g.hitTestPoint(new Vec(0, 50), 1, true)).toBe(true)    // 왼쪽 변
    expect(g.hitTestPoint(new Vec(50, 50), 1, true)).toBe(false)  // 한가운데 = 빈 속
  })

  it('해치(채움)는 속까지 잡힌다', () => {
    const g = geom(shape({
      pathData: 'M0.0,0.0L100.0,0.0',
      segCount: 1,
      hatchesJson: JSON.stringify([
        { d: 'M0.0,0.0L100.0,0.0L100.0,100.0L0.0,100.0Z', p: 'SOLID', s: 1, a: 0 },
      ]),
    }))

    expect(g.hitTestPoint(new Vec(50, 50), 1, true)).toBe(true)
  })

  it('텍스트만 있는 라벨은 박스 전체가 잡힌다 — 누를 면적이 그것뿐', () => {
    const g = geom(shape({ pathData: '', textsJson: 'x' }))
    expect(g.hitTestPoint(new Vec(50, 50), 1, true)).toBe(true)
  })
})
