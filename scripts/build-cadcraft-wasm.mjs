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
// ── 받아오는 건 **커밋에 못 박고 해시로 확인한다** ──
//
// 전엔 `.../cadcraft/bimove/...` 를 받았다. 브랜치는 움직이는 이름이라 같은
// Bimove 커밋이 **어제와 다른 엔진**으로 배포된다. 디버깅할 때 "그 배포에
// 무슨 엔진이 들어갔나" 를 되짚을 수가 없고, 포크에 사고가 나면 그게 그대로
// 배포로 흘러간다. 그래서 커밋 SHA 로 박고, 받은 바이트의 SHA-256 까지 본다.
//
// 엔진을 고쳤으면 **포크의 pkg 를 다시 만들어 커밋하고, 아래 PIN 을 그 커밋과
// 해시로 갱신**해야 배포에 반영된다. 해시는 이렇게 뽑는다:
//
//   node scripts/build-cadcraft-wasm.mjs --print-pin <commit-sha>

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '..')
const fork = process.env.CADCRAFT_DIR ?? resolve(root, '..', 'cadcraft')
const out = join(root, 'public', 'cadcraft')

/**
 * 받아올 산출물 — **움직이지 않는 커밋**과 각 파일의 SHA-256.
 *
 * moskalabs/cadcraft 의 bimove 브랜치에 있던 커밋이다. 브랜치가 더 가도 이
 * 커밋은 그대로 남으므로 같은 Bimove 커밋은 언제 빌드해도 같은 엔진을 받는다.
 */
const PIN = {
  commit: 'c93a8ed8d1069d6c5f4848a72043db7d7db88619',
  sha256: {
    'bimove_wasm.js':        '9324c4b715a76841e9a82bbb953ad3dc81a11570215c7f7f6ec2905558dcf2d0',
    'bimove_wasm_bg.wasm':   '3afabd6e312c65251df6f03d8ed7654adc45f97b08b20fa8e05e48f328e455ad',
    'bimove_wasm.d.ts':      'd8a688d11247f45c79fe8c08299b24c68aac823b3c8ad2295063ca3f0dce0c26',
  },
}

const FILES = Object.keys(PIN.sha256)
const rawUrl = (commit, name) =>
  `https://raw.githubusercontent.com/moskalabs/cadcraft/${commit}/crates/bimove-wasm/pkg/${name}`

/** 이보다 작으면 받다 만 것이다 (12MB 짜리다). */
const MIN_WASM_BYTES = 1_000_000

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

/**
 * 그 연장을 어디서 부를지 — PATH 에 없으면 **cargo 가 깔아 두는 자리**까지 본다.
 *
 * rustup 설치는 `~/.cargo/bin` 을 PATH 에 넣어 주지만, 그게 로그인 셸에만
 * 붙어 있는 기계가 있다 (한의 윈도우가 그렇다). PATH 만 보면 포크가 옆에
 * 있는데도 "Rust 가 없다" 며 **못 박은 옛 엔진을 받아와 덮는다** — 방금
 * 고친 엔진이 조용히 사라지고, 화면에서만 옛 동작이 나온다.
 *
 * @returns 부를 수 있는 경로, 없으면 `null`
 */
function tool(cmd) {
  const cargoBin = join(process.env.CARGO_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.cargo'), 'bin')
  for (const c of [cmd, join(cargoBin, `${cmd}.exe`), join(cargoBin, cmd)]) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' })
      return c
    } catch { /* 다음 자리 */ }
  }
  return null
}

function buildFromSource(cargo, bindgen) {
  const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: fork })
  console.log(`[cadcraft] 포크에서 빌드: ${fork}`)
  run(cargo, ['build', '--release', '-p', 'bimove-wasm', '--target', 'wasm32-unknown-unknown'])

  // wasm-bindgen 의 버전이 crate 의 wasm-bindgen 과 다르면 **조용히 깨진
  // 글루**가 나온다 (함수는 있는데 부르면 터진다). 미리 본다.
  const lock = readFileSync(join(fork, 'Cargo.lock'), 'utf8')
  const want = lock.match(/name = "wasm-bindgen"\r?\nversion = "([^"]+)"/)?.[1]
  const havever = execFileSync(bindgen, ['--version'], { encoding: 'utf8' }).trim().split(/\s+/).pop()
  if (want && havever && want !== havever) {
    throw new Error(
      `wasm-bindgen 버전이 다르다 — Cargo.lock ${want} vs CLI ${havever}\n` +
      `같은 버전을 깔아라: https://github.com/rustwasm/wasm-bindgen/releases/tag/${want}`,
    )
  }

  mkdirSync(out, { recursive: true })
  run(bindgen, [
    '--target', 'web', '--out-dir', out,
    join(fork, 'target', 'wasm32-unknown-unknown', 'release', 'bimove_wasm.wasm'),
  ])
}

/**
 * 받아서 **임시 칸에 모으고, 다 맞은 뒤에 한 번에 갈아끼운다.**
 *
 * 곧바로 public/cadcraft/ 에 쓰면 중간에 끊겼을 때 멀쩡했던 엔진이 반쪽
 * 파일로 덮인다 — 다음 빌드는 "이미 있다" 며 그 반쪽을 쓰고, 화면에서만
 * 터진다. 임시 칸이면 실패해도 옛것이 그대로 남는다.
 */
async function download() {
  const tmp = `${out}.tmp`
  console.log(`[cadcraft] 포크 산출물을 받는다: ${PIN.commit.slice(0, 7)}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  try {
    for (const name of FILES) {
      const res = await fetch(rawUrl(PIN.commit, name))
      if (!res.ok) throw new Error(`${name} 을 못 받았다 (HTTP ${res.status})`)
      const buf = Buffer.from(await res.arrayBuffer())
      const got = sha256(buf)
      if (got !== PIN.sha256[name]) {
        // 같은 커밋이 다른 바이트를 줄 수는 없다. 그러면 받다 만 것이거나
        // 중간에서 누가 바꿔치웠다 — 어느 쪽이든 쓰면 안 된다.
        throw new Error(`${name} 해시가 다르다\n  바란 것 ${PIN.sha256[name]}\n  받은 것 ${got}`)
      }
      writeFileSync(join(tmp, name), buf)
      console.log(`[cadcraft]   ${name} ${(buf.length / 1048576).toFixed(1)}MB ✓`)
    }

    // 다 맞았다 — 갈아끼운다. 윈도우는 디렉터리 위로 rename 이 안 되므로
    // 옛것을 먼저 옆으로 밀어 둔다.
    const old = `${out}.old`
    rmSync(old, { recursive: true, force: true })
    if (existsSync(out)) renameSync(out, old)
    renameSync(tmp, out)
    rmSync(old, { recursive: true, force: true })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * 이미 **못 박은 그것이** 놓여 있나.
 *
 * 전엔 파일이 있는지만 봤다. 그러면 옛 커밋 산출물이 남아 있어도 "있다" 며
 * 그냥 쓴다 — PIN 을 올려도 내 기계에서만 옛 엔진이 돈다. 해시까지 본다.
 */
function pinnedAlreadyThere() {
  const wasm = join(out, 'bimove_wasm_bg.wasm')
  if (!FILES.every(f => existsSync(join(out, f)))) return false
  if (statSync(wasm).size < MIN_WASM_BYTES) return false
  return FILES.every(f => sha256(readFileSync(join(out, f))) === PIN.sha256[f])
}

/** PIN 블록을 새로 뽑아 준다 — 엔진 고친 뒤 여기에 붙여넣는다. */
async function printPin(commit) {
  const lines = []
  for (const name of FILES) {
    const res = await fetch(rawUrl(commit, name))
    if (!res.ok) throw new Error(`${name} 을 못 받았다 (HTTP ${res.status})`)
    // 그대로 붙여넣을 수 있어야 한다 — 콜론을 빼먹으면 손으로 고치게 된다
    lines.push(`    ${`'${name}':`.padEnd(24)} '${sha256(Buffer.from(await res.arrayBuffer()))}',`)
  }
  console.log(`const PIN = {\n  commit: '${commit}',\n  sha256: {\n${lines.join('\n')}\n  },\n}`)
}

const pinFlag = process.argv.indexOf('--print-pin')
if (pinFlag >= 0) {
  const commit = process.argv[pinFlag + 1]
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
    console.error('사용법: node scripts/build-cadcraft-wasm.mjs --print-pin <40자 커밋 SHA>')
    process.exit(1)
  }
  await printPin(commit)
} else {
  const forkHere = existsSync(join(fork, 'Cargo.toml'))
  const cargo = forkHere ? tool('cargo') : null
  const bindgen = cargo ? tool('wasm-bindgen') : null
  try {
    if (cargo && bindgen) {
      buildFromSource(cargo, bindgen)
    } else if (cargo) {
      // 포크도 Rust 도 있는데 wasm-bindgen 만 없다. 여기서 받아오면 **지금
      // 고치고 있는 엔진이 옛 PIN 으로 덮인다** — 받는 쪽으로 넘기지 않는다.
      throw new Error(
        'wasm-bindgen 이 없어서 포크를 빌드하지 못한다 — 옛 PIN 으로 덮지 않고 둔다.\n' +
        'Cargo.lock 과 같은 버전을 깔아라: https://github.com/rustwasm/wasm-bindgen/releases',
      )
    } else if (pinnedAlreadyThere()) {
      // 못 박은 그대로 놓여 있다. 매 빌드마다 12MB 를 다시 받을 이유가 없다.
      console.log(`[cadcraft] 이미 있어서 건너뛴다 (${PIN.commit.slice(0, 7)})`)
    } else {
      await download()
    }
    console.log('[cadcraft] public/cadcraft/ 준비됨')
  } catch (e) {
    // **빌드를 세우지 않는다.** 이건 `#cadcraft` 실험 화면에서만 쓰는 것이라,
    // 없다고 앱 전체를 못 띄울 이유가 없다. 그 화면에서 "엔진을 못 불러왔다"
    // 가 뜰 뿐이다.
    //
    // 다만 **조용히 넘기지는 않는다.** 실패했는데 옛 산출물이 남아 있으면
    // 그걸로 돈다는 뜻이고, 그건 배포 로그에서 읽혀야 한다.
    console.warn(`[cadcraft] 준비 실패 — #cadcraft 화면만 안 된다: ${e.message}`)
    if (existsSync(join(out, 'bimove_wasm_bg.wasm'))) {
      console.warn('[cadcraft] 옛 산출물이 남아 있어 그걸로 돈다 — 못 박은 그것이 아닐 수 있다')
    }
  }
}
