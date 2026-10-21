// public/cadcraft/ 에 놓인 엔진을 Node 에서 끝까지 태워 본다.
//
// Rust 쪽 테스트가 다 통과해도 이건 따로 봐야 한다. `pkg/` 의 JS 글루는
// wasm-bindgen 이 따로 만들어 커밋하는 것이라, 엔진에 export 를 더해도 글루를
// 다시 만들지 않으면 **브라우저에서만** 조용히 터진다 (`doc.wallCount is not a
// function`). 타입검사도 못 잡는다 — CadDoc 은 손으로 쓴 interface 다.
//
//   node scripts/check-cadcraft-wasm.mjs
import { readFileSync } from 'node:fs'
import init, { BimoveDoc } from '../public/cadcraft/bimove_wasm.js'

await init({ module_or_path: readFileSync(new URL('../public/cadcraft/bimove_wasm_bg.wasm', import.meta.url)) })

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
const shapes = [
  wall(1, 0, 0, 200, 0),
  wall(2, 200, 0, 0, 150),
  wall(3, 200, 150, -200, 0),
  wall(4, 0, 400, 100, 0),
  door(1, 60, 0),
  win(1, 200, 75),
]
const json = JSON.stringify({
  version: 1,
  pages: [{ id: 'page:main', name: '모형', index: 'a1' }],
  shapes,
  records: {}, skipped: 0,
  source: { from: 'tldraw', at: 0, sourceHash: 'x', shapeCount: shapes.length },
})

const doc = BimoveDoc.fromBimove(json, '')
console.log('wallCount      =', doc.wallCount())
console.log('wallMlineCount =', doc.wallMlineCount())
console.log('openingCount   =', doc.openingCount())
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
  doc.notes().length === 0 && ink > 100
console.log(ok ? '\nOK' : '\nFAIL')
if (!ok) process.exitCode = 1
