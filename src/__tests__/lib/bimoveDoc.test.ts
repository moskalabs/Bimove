/**
 * tldraw 스냅샷 → Bimove 문서.
 *
 * 이전에서 중요한 건 **하나도 안 잃는 것** 하나다. 고객 도면이 걸려 있어서
 * "대충 옮겨졌다" 는 쓸모가 없다. 그래서 여기서 보는 건 전부 유실에 관한
 * 것이다 — 모르는 타입도 오는가, props 가 통째로 오는가, 못 읽은 걸 세는가.
 */
import { describe, it, expect } from 'vitest'
import {
  fromTldrawSnapshot, countByType, shapesOfPage, assetsOf, BIMOVE_DOC_VERSION,
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

  it('도형·페이지가 아닌 레코드를 **원형 그대로** 들고 간다', () => {
    // 전엔 "도면이 아니다" 며 버렸다. 그게 틀렸다 — asset 에 이미지 본문이,
    // binding 에 화살표 연결이 들어 있다. 무엇이 중요한지 미리 알 수 없다.
    const assetRec = { id: 'asset:img', typeName: 'asset', type: 'image',
      props: { src: 'data:image/png;base64,AAA', w: 100, h: 50 } }
    const d = fromTldrawSnapshot(snap([
      page('page:main', 'p'),
      { id: 'camera:x', typeName: 'camera', x: 0, y: 0, z: 1 },
      { id: 'instance:x', typeName: 'instance' },
      assetRec,
      { id: 'binding:b', typeName: 'binding', fromId: 'shape:a', toId: 'shape:w' },
      shape('shape:w', 'wall', { thickness: 20 }),
    ]))
    expect(d.shapes).toHaveLength(1)
    expect(d.skipped).toBe(0)
    expect(d.records['asset:img']).toEqual(assetRec)
    expect(d.records['binding:b']).toBeTruthy()
    expect(d.records['camera:x']).toBeTruthy()
  })

  it('이미지 본문(asset)이 살아서 온다', () => {
    // image 도형은 assetId 만 들고 있다. asset 을 버리면 그림이 통째로
    // 사라진다 — 한의 도면에서 실제로 스캔 이미지 하나가 그렇게 날아갔다.
    const src = 'data:image/png;base64,iVBORw0KGgo='
    const d = fromTldrawSnapshot(snap([
      page('page:main', 'p'),
      { id: 'asset:scan', typeName: 'asset', type: 'image', props: { src, w: 1723, h: 1147 } },
      shape('shape:img', 'image', { assetId: 'asset:scan', w: 1723, h: 1147 }),
    ]))
    expect(d.shapes[0].props.assetId).toBe('asset:scan')
    const asset = assetsOf(d)['asset:scan'] as { props: { src: string } }
    expect(asset.props.src).toBe(src)
  })

  it('그룹 안 도형의 부모가 보존된다', () => {
    // parentId 를 pageId 라 부르며 페이지로만 취급하면 그룹 관계가 사라진다.
    const d = fromTldrawSnapshot(snap([
      page('page:main', 'p'),
      shape('shape:g', 'group', {}, { parentId: 'page:main' }),
      shape('shape:in', 'wall', {}, { parentId: 'shape:g' }),
    ]))
    expect(d.shapes.find(s => s.id === 'shape:in')?.parentId).toBe('shape:g')
    // 페이지 직속만 세는 자리에 그룹 자식이 섞이면 안 된다
    expect(shapesOfPage(d, 'page:main').map(s => s.id)).toEqual(['shape:g'])
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

describe('축척', () => {
  const docRec = (meta: Record<string, unknown>) => ({
    id: 'document:document', typeName: 'document', gridSize: 10, name: '', meta,
  })

  it('문서 레코드의 meta 에서 축척을 읽는다', () => {
    const d = fromTldrawSnapshot(snap([
      page('page:main', '모형'),
      docRec({ scale: { pxPerMm: 0.02, unit: 'm' } }),
      shape('shape:w1', 'wall', { x2: 200, y2: 0, thickness: 20 }),
    ]))
    expect(d.scale).toEqual({ pxPerMm: 0.02, unit: 'm' })
  })

  it('축척이 없으면 **없다고** 둔다 — 1 로 메우지 않는다', () => {
    // 조용히 1 로 두면 2000mm 짜리 벽에 "200mm" 가 찍히고 아무도 모른다.
    // 읽는 쪽(엔진)이 없는 걸 알아야 notes 에 올릴 수 있다.
    const d = fromTldrawSnapshot(snap([
      page('page:main', '모형'),
      shape('shape:w1', 'wall', { x2: 200, y2: 0, thickness: 20 }),
    ]))
    expect(d.scale).toBeUndefined()
  })

  it('못 쓰는 pxPerMm 은 버린다', () => {
    // 0 을 넘기면 엔진이 1/0 = Infinity 를 DIMLFAC 으로 쓴다
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '0.1']) {
      const d = fromTldrawSnapshot(snap([
        page('page:main', '모형'),
        docRec({ scale: { pxPerMm: bad, unit: 'mm' } }),
        shape('shape:w1', 'wall', { x2: 200, y2: 0, thickness: 20 }),
      ]))
      expect(d.scale, `pxPerMm=${String(bad)}`).toBeUndefined()
    }
  })

  it('모르는 단위는 mm 로 떨어뜨린다 — pxPerMm 만 맞으면 쓸 수 있다', () => {
    const d = fromTldrawSnapshot(snap([
      page('page:main', '모형'),
      docRec({ scale: { pxPerMm: 0.1, unit: '척' } }),
      shape('shape:w1', 'wall', { x2: 200, y2: 0, thickness: 20 }),
    ]))
    expect(d.scale).toEqual({ pxPerMm: 0.1, unit: 'mm' })
  })

  it('문서 레코드는 records 에도 그대로 남는다', () => {
    // 축척을 꺼내 쓴다고 원본을 빼면 그게 유실이다.
    const d = fromTldrawSnapshot(snap([
      page('page:main', '모형'),
      docRec({ scale: { pxPerMm: 0.1, unit: 'mm' }, 남의것: 1 }),
      shape('shape:w1', 'wall', { x2: 200, y2: 0, thickness: 20 }),
    ]))
    expect(d.records['document:document']).toMatchObject({ meta: { 남의것: 1 } })
  })
})
