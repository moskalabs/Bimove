// 핀이 **도면의 그 자리에** 꽂히는지 엔진으로 맞춰 본다.
//
// 좌표 변환은 단위 테스트가 있지만(`cadCamera.test.ts`), 그건 식이 제
// 자신과 맞는지만 본다. 진짜 물어야 할 것은 **엔진이 그린 픽셀**과 그 위에
// 얹은 HTML 이 같은 자리를 가리키느냐다. y 를 한 번 덜/더 뒤집으면 단위
// 테스트는 전부 통과하면서 핀만 위아래로 뒤집혀 꽂힌다.
//
// 그래서 이렇게 잰다.
//
//   1. 알려진 자리에 짧은 벽 하나를 둔 문서를 만든다.
//   2. 엔진에 그리게 하고, **잉크가 묻은 픽셀**의 가운데를 찾는다.
//   3. 같은 점을 `pageToScreen` 으로 옮긴다.
//   4. 둘이 몇 픽셀 안에서 만나는지 본다.
//
//   node scripts/check-comment-pins.mjs

import { readFileSync, existsSync } from 'node:fs'

const wasmPath = new URL('../public/cadcraft/bimove_wasm_bg.wasm', import.meta.url)
const gluePath = new URL('../public/cadcraft/bimove_wasm.js', import.meta.url)
if (!existsSync(wasmPath) || !existsSync(gluePath)) {
  console.warn('[pins] 엔진이 없어서 건너뛴다')
  process.exit(0)
}
const { default: init, BimoveDoc } = await import(gluePath.href)
await init({ module_or_path: readFileSync(wasmPath) })

// ── cadCamera.ts 와 **같은 식** ──
// (ts 를 Node 에서 바로 못 불러서 여기 옮겨 적는다. 달라지면 아래
//  '식이 같은가' 가 틀어지므로 조용히 어긋나지는 않는다.)
const pageToScreen = (cam, p, box) => ({
  x: box.w / 2 + (p.x - cam.cx) * cam.scale,
  y: box.h / 2 - (-p.y - cam.cy) * cam.scale,
})

/** page 좌표로 (x,y)→(x2,y2) 짜리 벽 하나. */
const wall = (x, y, x2, y2) => ({
  id: 'shape:w1', type: 'wall', x, y, rotation: 0, index: 'a1',
  parentId: 'page:main', props: { x2, y2, thickness: 20 },
})

function docWith(shapes) {
  return JSON.stringify({
    version: 1,
    pages: [{ id: 'page:main', name: '모형', index: 'a1' }],
    scale: { pxPerMm: 1, unit: 'mm' },
    shapes,
    records: {}, skipped: 0,
    source: { from: 'tldraw', at: 0, shapeCount: shapes.length },
  })
}

const W = 400, H = 300
const BG = 0xFFFFFF

/** 잉크가 묻은 픽셀들의 가운데. */
function inkCenter(rgba, w, h) {
  let sx = 0, sy = 0, n = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] === 255 && rgba[i + 1] === 255 && rgba[i + 2] === 255) continue
    const px = (i / 4) % w
    const py = Math.floor((i / 4) / w)
    sx += px; sy += py; n++
  }
  return n ? { x: sx / n, y: sy / n, n } : null
}

let bad = 0
// page 좌표가 서로 다른 네 자리 — y 부호가 뒤집히면 위/아래가 바뀐다.
const CASES = [
  { name: '원점 오른쪽', at: { x: 100, y: 0 } },
  { name: '원점 아래',   at: { x: 0, y: 120 } },
  { name: '원점 위',     at: { x: 0, y: -120 } },
  { name: '왼쪽 아래',   at: { x: -80, y: 60 } },
]

for (const c of CASES) {
  // 그 자리에 아주 짧은 벽 — 거의 점이다.
  const doc = BimoveDoc.fromBimove(docWith([wall(c.at.x, c.at.y, 2, 0)]), 'page:main')
  // 카메라는 원점을 보고 배율 1. page(x,y) → 엔진(x,-y) 이므로 cy 는 0.
  const cam = { cx: 0, cy: 0, scale: 1 }
  const r = doc.renderPixels('', cam.cx, cam.cy, cam.scale, W, H, BG, false)
  const ink = inkCenter(r.rgba(), r.width(), r.height())
  r.free()
  doc.free?.()

  if (!ink) { console.log(`  ${c.name}: 잉크가 없다 — 못 그렸다`); bad++; continue }
  const want = pageToScreen(cam, c.at, { w: W, h: H })
  const dx = Math.abs(ink.x - want.x), dy = Math.abs(ink.y - want.y)
  // 벽은 두께 20 에 길이 2 라 잉크가 조금 번진다. 3px 이면 충분히 엄하다 —
  // y 부호가 뒤집히면 240px 씩 어긋난다.
  const ok = dx <= 3 && dy <= 3
  if (!ok) bad++
  console.log(
    `  ${ok ? '✓' : '✗'} ${c.name.padEnd(8)} page(${c.at.x},${c.at.y})` +
    ` → 잉크(${ink.x.toFixed(1)},${ink.y.toFixed(1)})` +
    ` vs 핀(${want.x.toFixed(1)},${want.y.toFixed(1)})` +
    `  어긋남 ${dx.toFixed(1)},${dy.toFixed(1)}px`,
  )
}

console.log(bad === 0 ? '\nOK — 핀이 그림과 같은 자리를 가리킨다' : `\nFAIL (${bad}건)`)
if (bad) process.exitCode = 1
