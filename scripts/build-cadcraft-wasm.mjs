// CADCraft 엔진(WASM)을 public/cadcraft/ 에 놓는다.
//
// 길이 둘이다.
//
//   1. **옆에 포크가 있고 Rust 가 깔려 있으면** 직접 빌드한다 (개발).
//   2. 없으면 포크의 커밋된 산출물을 **받아온다** (Vercel 빌드).
//
// Vercel 에는 Rust 도 포크도 없다. 그래서 산출물을 포크 쪽에 커밋해 두고
// (crates/bimove-wasm/pkg/) 여기서 받아간다. Bimove 레포에 12MB 를 매번
// 쌓지 않으려는 것이다.
//
// 엔진을 고쳤으면 **포크의 pkg 도 다시 만들어 커밋**해야 배포에 반영된다.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '..')
const fork = process.env.CADCRAFT_DIR ?? resolve(root, '..', 'cadcraft')
const out = join(root, 'public', 'cadcraft')

/** 받아올 곳. 포크의 브랜치를 바꾸면 여기도 바꾼다. */
const RAW = 'https://raw.githubusercontent.com/moskalabs/cadcraft/bimove/crates/bimove-wasm/pkg'
const FILES = ['bimove_wasm.js', 'bimove_wasm_bg.wasm', 'bimove_wasm.d.ts']

/** 이보다 작으면 받다 만 것이다 (12MB 짜리다). */
const MIN_WASM_BYTES = 1_000_000

function have(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function buildFromSource() {
  const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: fork })
  console.log(`[cadcraft] 포크에서 빌드: ${fork}`)
  run('cargo', ['build', '--release', '-p', 'bimove-wasm', '--target', 'wasm32-unknown-unknown'])

  // wasm-bindgen 의 버전이 crate 의 wasm-bindgen 과 다르면 **조용히 깨진
  // 글루**가 나온다 (함수는 있는데 부르면 터진다). 미리 본다.
  const lock = readFileSync(join(fork, 'Cargo.lock'), 'utf8')
  const want = lock.match(/name = "wasm-bindgen"\r?\nversion = "([^"]+)"/)?.[1]
  const havever = execFileSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }).trim().split(/\s+/).pop()
  if (want && havever && want !== havever) {
    throw new Error(
      `wasm-bindgen 버전이 다르다 — Cargo.lock ${want} vs CLI ${havever}\n` +
      `같은 버전을 깔아라: https://github.com/rustwasm/wasm-bindgen/releases/tag/${want}`,
    )
  }

  mkdirSync(out, { recursive: true })
  run('wasm-bindgen', [
    '--target', 'web', '--out-dir', out,
    join(fork, 'target', 'wasm32-unknown-unknown', 'release', 'bimove_wasm.wasm'),
  ])
}

async function download() {
  console.log(`[cadcraft] 포크 산출물을 받는다: ${RAW}`)
  mkdirSync(out, { recursive: true })
  for (const name of FILES) {
    const res = await fetch(`${RAW}/${name}`)
    if (!res.ok) throw new Error(`${name} 을 못 받았다 (HTTP ${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(join(out, name), buf)
    console.log(`[cadcraft]   ${name} ${(buf.length / 1048576).toFixed(1)}MB`)
  }
}

/** 이미 쓸 만한 게 놓여 있나 (받다 만 것은 쳐낸다). */
function alreadyThere() {
  const wasm = join(out, 'bimove_wasm_bg.wasm')
  return (
    FILES.every(f => existsSync(join(out, f))) &&
    statSync(wasm).size >= MIN_WASM_BYTES
  )
}

const canBuild = existsSync(join(fork, 'Cargo.toml')) && have('cargo') && have('wasm-bindgen')

try {
  if (canBuild) {
    buildFromSource()
  } else if (alreadyThere()) {
    // 포크도 없고 이미 받아 둔 게 있으면 그냥 쓴다. 매 빌드마다 12MB 를
    // 다시 받을 이유가 없다.
    console.log('[cadcraft] 이미 있어서 건너뛴다')
  } else {
    await download()
  }
  console.log('[cadcraft] public/cadcraft/ 준비됨')
} catch (e) {
  // **빌드를 세우지 않는다.** 이건 `#cadcraft` 실험 화면에서만 쓰는 것이라,
  // 없다고 앱 전체를 못 띄울 이유가 없다. 그 화면에서 "엔진을 못 불러왔다"
  // 가 뜰 뿐이다.
  console.warn(`[cadcraft] 준비 실패 — #cadcraft 화면만 안 된다: ${e.message}`)
}
