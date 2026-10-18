// CADCraft 포크의 bimove-wasm 을 빌드해서 public/cadcraft/ 에 넣는다.
//
// 손으로 복사하면 다음에 반드시 어긋난다 — 엔진을 고쳤는데 옛 wasm 이 남아
// "왜 안 바뀌지" 로 시간을 버린다. 그래서 스크립트로 둔다.
//
//   node scripts/build-cadcraft-wasm.mjs
//
// 필요한 것 (한 번만):
//   - rustup + wasm32-unknown-unknown 타겟
//   - wasm-bindgen CLI (버전이 Cargo.lock 과 **같아야** 한다)
//   - CADCraft 포크가 옆에 clone 되어 있을 것 (기본값: ../cadcraft)
//
// 이 PC 의 함정은 두 가지다. MinGW 링커가 한글 경로를 못 읽어 rustup 을
// C:\rust\ 로 옮겨 뒀고(RUSTUP_HOME/CARGO_HOME), wasm-bindgen 은 소스 빌드가
// dlltool 없이 막혀서 릴리스 바이너리를 C:\rust\bin\ 에 뒀다.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '..')
const fork = process.env.CADCRAFT_DIR ?? resolve(root, '..', 'cadcraft')
const out = join(root, 'public', 'cadcraft')

if (!existsSync(join(fork, 'Cargo.toml'))) {
  console.error(`CADCraft 포크를 못 찾았다: ${fork}`)
  console.error('CADCRAFT_DIR 로 경로를 주거나 ../cadcraft 에 clone 해라.')
  console.error('  git clone https://github.com/moskalabs/cadcraft.git ../cadcraft')
  console.error('  cd ../cadcraft && git checkout bimove')
  process.exit(1)
}

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: fork, ...opts })

console.log(`[cadcraft] 포크: ${fork}`)
run('cargo', ['build', '--release', '-p', 'bimove-wasm', '--target', 'wasm32-unknown-unknown'])

// wasm-bindgen 의 버전이 crate 의 wasm-bindgen 과 다르면 조용히 깨진 글루를
// 만든다 (함수는 있는데 호출하면 터진다). 미리 본다.
const lock = readFileSync(join(fork, 'Cargo.lock'), 'utf8')
const want = lock.match(/name = "wasm-bindgen"\r?\nversion = "([^"]+)"/)?.[1]
const have = execFileSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }).trim().split(/\s+/).pop()
if (want && have && want !== have) {
  console.error(`[cadcraft] wasm-bindgen 버전이 다르다 — Cargo.lock ${want} vs CLI ${have}`)
  console.error('같은 버전을 깔아야 한다. 릴리스 바이너리:')
  console.error(`  https://github.com/rustwasm/wasm-bindgen/releases/tag/${want}`)
  process.exit(1)
}

mkdirSync(out, { recursive: true })
run('wasm-bindgen', [
  '--target', 'web',
  '--out-dir', out,
  join(fork, 'target', 'wasm32-unknown-unknown', 'release', 'bimove_wasm.wasm'),
])
console.log(`[cadcraft] public/cadcraft/ 에 설치 완료`)
