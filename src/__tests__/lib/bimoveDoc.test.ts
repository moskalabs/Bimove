/**
 * tldraw 스냅샷 → Bimove 문서.
 *
 * 이전에서 중요한 건 **하나도 안 잃는 것** 하나다. 고객 도면이 걸려 있어서
 * "대충 옮겨졌다" 는 쓸모가 없다. 그래서 여기서 보는 건 전부 유실에 관한
 * 것이다 — 모르는 타입도 오는가, props 가 통째로 오는가, 못 읽은 걸 세는가.
 */
import { describe, it, expect } from 'vitest'
import {
  fromTldrawSnapshot, countByType, shapesOfPage, BIMOVE_DOC_VERSION,
} from '../../lib/bimoveDoc'

const page = (id: string, name: string, index = 'a1') => ({
  id, typeName: 'page', name, index,
})

const shape = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, typeName: 'shape', type, parentId: 'page:main',
  x: 10, y: 20, rotation: 0, index: 'a1', opacity: 1, isLocked: false,
  props, meta: {}, ...extra,
})

function snap(records: Array<Record<string, unknown>>) {
  const store: Record<string, unknown> = {}
  for (const r of records) store[r.id as string] = r
  return { document: { store, schema: {} } }
}

describe('fromTldrawSnapshot', () => {
  it('페이지와 도형을 옮긴다', () => {
    const d = fromTldrawSnapshot(snap([
      page('page:main', '모형'),
      shape('shape:w1', 'wall', { x2: 200, y2: 0, thickness: 20 }),
    ]))
    expect(d.version).toBe(BIMOVE_DOC_VERSION)
    expect(d.pages).toEqual([{ id: 'page:main', name: '모형', index: 'a1' }])
    expect(d.shapes).toHaveLength(1)
    expect(d.skipped).toBe(0)
  })

  it('props 를 **통째로** 옮긴다 — 필드를 골라 담지 않는다', () => {
    // 타입마다 새 모델로 옮겨 적으면 빠뜨린 필드가 조용히 사라진다.
    // 그게 이전에서 가장 흔한 사고다.
    const props = {
      pathData: 'M0,0L100,0', textsJson: '[{"x":1,"y":2,"t":"가"}]',
      hatchesJson: '[]', w: 100, h: 50, thickness: 2, segCount: 7,
      우리가모르는필드: { 깊이: [1, 2, 3] },
    }
    const d = fromTldrawSnapshot(snap([page('page:main', 'p'), shape('shape:g', 'dxfgroup', props)]))
    expect(d.shapes[0].props).toEqual(props)
  })

  it('모르는 타입도 옮긴다', () => {
    // tldraw 기본 도형(geo/arrow/text)과 나중에 생길 우리 도형까지. 변환기가
    // 타입 목록을 알아야 하면 목록에 없는 건 소리 없이 사라진다.
    const d = fromTldrawSnapshot(snap([
      page('page:main', 'p'),
      shape('shape:a', 'geo', { geo: 'rectangle' }),
      shape('shape:b', 'arrow', { bend: 3 }),
      shape('shape:c', '아직없는타입', { 뭔가: 1 }),
    ]))
    expect(countByType(d)).toEqual({ geo: 1, arrow: 1, 아직없는타입: 1 })
  })

  it('도형이 아닌 레코드는 옮기지 않되 버린 걸로 세지도 않는다', () => {
    // camera/instance/asset 은 도면이 아니다. 이걸 skipped 로 세면 멀쩡한
    // 이전이 "유실 있음" 으로 보여서 쓸데없이 막힌다.
    const d = fromTldrawSnapshot(snap([
      page('page:main', 'p'),
      { id: 'camera:x', typeName: 'camera', x: 0, y: 0, z: 1 },
      { id: 'instance:x', typeName: 'instance' },
      { id: 'asset:x', typeName: 'asset' },
      shape('shape:w', 'wall', { thickness: 20 }),
    ]))
    expect(d.shapes).toHaveLength(1)
    expect(d.skipped).toBe(0)
  })

  it('못 읽은 레코드를 **센다**', () => {
    // 조용히 0 이면 "다 옮겼다" 로 보인다. 저장 전에 호출부가 막을 수 있어야 한다.
    const d = fromTldrawSnapshot(snap([
      page('page:main', 'p'),
      { id: 'shape:bad', typeName: 'shape' },          // type 이 없다
    ]))
    expect(d.shapes).toHaveLength(0)
    expect(d.skipped).toBe(1)
  })

  it('쌓임 순서를 사전순으로 지킨다', () => {
    // 분수 인덱스는 문자열이다. 숫자로 비교하면 a2 와 a10 이 뒤집혀서
    // 가려져 있던 도형이 위로 올라온다.
    const d = fromTldrawSnapshot(snap([
      page('page:main', 'p'),
      shape('shape:3', 'geo', {}, { index: 'a3' }),
      shape('shape:10', 'geo', {}, { index: 'a10' }),
      shape('shape:2', 'geo', {}, { index: 'a2' }),
    ]))
    expect(d.shapes.map(s => s.index)).toEqual(['a10', 'a2', 'a3'])
  })

  it('여러 페이지를 가른다', () => {
    const d = fromTldrawSnapshot(snap([
      page('page:a', '모형', 'a1'),
      page('page:b', '배치1', 'a2'),
      shape('shape:1', 'wall', {}, { parentId: 'page:a' }),
      shape('shape:2', 'wall', {}, { parentId: 'page:b' }),
      shape('shape:3', 'wall', {}, { parentId: 'page:b' }),
    ]))
    expect(d.pages.map(p => p.name)).toEqual(['모형', '배치1'])
    expect(shapesOfPage(d, 'page:a')).toHaveLength(1)
    expect(shapesOfPage(d, 'page:b')).toHaveLength(2)
  })

  it('위치·회전·잠금을 옮긴다', () => {
    const d = fromTldrawSnapshot(snap([
      page('page:main', 'p'),
      shape('shape:w', 'wall', { thickness: 20 }, { x: 1.5, y: -2.5, rotation: 1.57, isLocked: true, opacity: 0.5 }),
    ]))
    const s = d.shapes[0]
    expect([s.x, s.y, s.rotation]).toEqual([1.5, -2.5, 1.57])
    expect(s.isLocked).toBe(true)
    expect(s.opacity).toBe(0.5)
  })

  it('옛 통짜 저장본의 { store } 모양도 읽는다', () => {
    // 레거시 localStorage 에 남은 것들이 이 모양이다. 못 읽으면 그 프로젝트는
    // 통째로 못 옮긴다.
    const d = fromTldrawSnapshot({ store: { 'shape:w': shape('shape:w', 'wall', { thickness: 20 }) } })
    expect(d.shapes).toHaveLength(1)
  })

  it('말이 안 되는 입력에도 터지지 않는다', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}, { document: {} }]) {
      const d = fromTldrawSnapshot(bad)
      expect(d.shapes).toEqual([])
      expect(d.pages).toEqual([])
    }
  })
})
