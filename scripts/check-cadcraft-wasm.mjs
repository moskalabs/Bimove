// public/cadcraft/ 에 놓인 엔진을 Node 에서 끝까지 태워 본다.
//
// Rust 쪽 테스트가 다 통과해도 이건 따로 봐야 한다. `pkg/` 의 JS 글루는
// wasm-bindgen 이 따로 만들어 커밋하는 것이라, 엔진에 export 를 더해도 글루를
// 다시 만들지 않으면 **브라우저에서만** 조용히 터진다 (`doc.wallCount is not a
// function`). 타입검사도 못 잡는다 — CadDoc 은 손으로 쓴 interface 다.
//
//   node scripts/check-cadcraft-wasm.mjs
//
// 빌드(prebuild)에도 걸려 있다. 손으로만 돌리면 결국 아무도 안 돌린다.
//
// ── 없을 때와 깨졌을 때를 가른다 ──
//
// **엔진이 없는 건 빌드를 세울 일이 아니다.** build-cadcraft-wasm.mjs 가
// 일부러 그렇게 돼 있다 — 이건 `#cadcraft` 실험 화면에서만 쓰는 것이라,
// 받아오기가 실패했다고 앱 전체를 못 띄울 이유가 없다 (그 주석 참고).
// 여기서 세우면 그 설계를 뒤에서 뒤집는 꼴이 된다.
//
// **있는데 안 도는 건 세운다.** 그게 이 파일이 잡으려는 것이다 — 글루와
// 엔진이 어긋나 브라우저에서만 터지는 경우.
import { readFileSync, existsSync } from 'node:fs'

const wasmPath = new URL('../public/cadcraft/bimove_wasm_bg.wasm', import.meta.url)
const gluePath = new URL('../public/cadcraft/bimove_wasm.js', import.meta.url)
if (!existsSync(wasmPath) || !existsSync(gluePath)) {
  console.warn('[check-cadcraft] 엔진이 없어서 건너뛴다 — #cadcraft 화면만 안 된다')
  process.exit(0)
}

const { default: init, BimoveDoc } = await import(gluePath.href)

await init({ module_or_path: readFileSync(wasmPath) })

// ㄷ 자로 이어진 벽 셋 + 떨어진 벽 하나 → MLINE 두 개여야 한다
const wall = (i, x, y, x2, y2) => ({
  id: `shape:w${i}`, type: 'wall', x, y, rotation: 0, index: `a${i}`,
  parentId: 'page:main', props: { x2, y2, thickness: 20 },
})
// 문·창은 `x,y` 가 **가운데**다 — 벽선에 스냅된 그 점
const door = (i, x, y) => ({
  id: `shape:d${i}`, type: 'door', x, y, rotation: 0, index: `b${i}`,
  parentId: 'page:main', props: { width: 80, thickness: 20, swing: 1, flipped: false },
})
const win = (i, x, y) => ({
  id: `shape:n${i}`, type: 'window', x, y, rotation: 0, index: `c${i}`,
  parentId: 'page:main', props: { width: 60, thickness: 20 },
})
// 치수는 `x,y` 가 첫 점이고 `x2,y2` 는 거기서의 상대 좌표다
const dim = (i, x, y, x2, y2, offset) => ({
  id: `shape:m${i}`, type: 'dimension', x, y, rotation: 0, index: `d${i}`,
  parentId: 'page:main', props: { x2, y2, offset },
})
// 공간의 `points` 는 **첫 점 기준 상대 좌표**다
const zone = (i, x, y, w, h, label, area) => ({
  id: `shape:z${i}`, type: 'zone', x, y, rotation: 0, index: `e${i}`,
  parentId: 'page:main',
  props: {
    points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
    label, areaM2: area, perimeterM: 0, wallHeightMm: 2400, color: '#34a853',
  },
})
// 물량표는 `x,y` 가 좌상단. rowsJson 은 문자열 안의 JSON 이다
const boq = (i, x, y, rows, total) => ({
  id: `shape:t${i}`, type: 'boqtable', x, y, rotation: 0, index: `f${i}`,
  parentId: 'page:main',
  props: {
    w: 612, h: 96, title: '마감재 물량 산출표',
    rowsJson: JSON.stringify(rows), totalAreaM2: total,
  },
})
const shapes = [
  wall(1, 0, 0, 200, 0),
  wall(2, 200, 0, 0, 150),
  wall(3, 200, 150, -200, 0),
  wall(4, 0, 400, 100, 0),
  door(1, 60, 0),
  win(1, 200, 75),
  dim(1, 0, 0, 200, 0, 60),
  zone(1, 0, 0, 200, 150, '거실', 30),
  boq(1, 300, 0, [
    { category: '벽체 마감', item: '석고보드', spec: '9.5T 일반', areaM2: 30, qty: 17, unit: '장' },
    { category: '바닥 마감', item: '강마루', spec: '7.5T 오크', areaM2: 30, qty: 2.5, unit: '평' },
  ], 60),
]
const json = JSON.stringify({
  version: 1,
  pages: [{ id: 'page:main', name: '모형', index: 'a1' }],
  // 1:10 — 치수 숫자가 px 가 아니라 mm 로 나와야 한다
  scale: { pxPerMm: 0.1, unit: 'mm' },
  shapes,
  records: {}, skipped: 0,
  source: { from: 'tldraw', at: 0, sourceHash: 'x', shapeCount: shapes.length },
})

const doc = BimoveDoc.fromBimove(json, '')
console.log('wallCount      =', doc.wallCount())
console.log('wallMlineCount =', doc.wallMlineCount())
console.log('openingCount   =', doc.openingCount())
console.log('dimCount       =', doc.dimCount())
console.log('zoneCount      =', doc.zoneCount())
console.log('boqCount       =', doc.boqCount())
console.log('notes          =', JSON.stringify(doc.notes()))

const f = doc.buildFrame('', 1.0)
console.log('bounds         =', Array.from(f.bounds()).map(v => v.toFixed(1)).join(', '))
console.log('primCount      =', f.primCount())

const [w, h] = [300, 300]
const r = doc.renderPixels('', 100, -200, 0.6, w, h, 0xFFFFFF, false)
const px = r.rgba()
let ink = 0
for (let i = 0; i < px.length; i += 4) if (!(px[i] === 255 && px[i+1] === 255 && px[i+2] === 255)) ink++
console.log('ink            =', ink, '/', w * h)

const ok =
  doc.wallCount() === 4 && doc.wallMlineCount() === 2 && doc.openingCount() === 2 &&
  doc.dimCount() === 1 && doc.zoneCount() === 1 && doc.boqCount() === 1 &&
  doc.notes().length === 0 && ink > 100
console.log(ok ? '\nOK' : '\nFAIL')
if (!ok) process.exitCode = 1
