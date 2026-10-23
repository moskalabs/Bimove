// src/ 에서 **화면에서 닿을 수 없는 코드**를 찾는다.
//
// 왜 필요한가. 같은 사고가 세 번 났다 — 패널을 "안 쓰는 것" 으로 보고 지웠는데
// 그 패널이 어떤 기능의 **유일한 입구**였던 경우다.
//
//   450f467  2026-07-06  LBar 리팩토링   → 블록 라이브러리가 잠듦
//   17955ec  2026-08-05  미사용 패널 삭제 → 옛 코멘트 도형이 고아가 됨
//   2f54a65  2026-08-14  BOQ 탭 삭제      → 관계·견적·발주서가 통째로 잠듦
//
// 입구를 지우면 그 아래가 통째로 죽는데, 죽은 건 눈에 안 띈다. 타입검사도
// 린트도 "닿을 수 없는 파일" 은 잡지 않는다. 실제로 잠든 코드에 보안 패치와
// 동시성 수정이 몇 달 동안 들어갔다.
//
//   node scripts/find-orphans.mjs
//
// ── 직접 고아가 아니라 **도달 가능성**을 본다 ──
//
// "아무도 import 하지 않는 파일" 만 세면 하위 트리를 놓친다. 발주서가 그랬다 —
// 입구(POTablesTab)만 고아였고 그 아래 네 파일은 "누군가 import 한다" 로 보여
// 멀쩡해 보였다. 그래서 진입점에서 출발해 **닿는 곳을 칠하고**, 안 칠해진
// 것을 센다.
//
// 테스트는 칠하지 않는다. 테스트만 닿는 코드는 제품에서 죽은 것이고, 테스트가
// 있으면 살아 있는 것처럼 보여서 **가장 속기 쉽다.**

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'

const ROOT = 'src'
/** 여기서 시작한다. */
const ENTRY = ['src/main.tsx']

const slash = (p) => p.split('\\').join('/')
const isTest = (f) => f.includes('__tests__') || /\.test\.tsx?$/.test(f)

const files = []
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts')) files.push(slash(p))
  }
}
walk(ROOT)
const known = new Set(files)

/** 상대 import 를 실제 파일로 맞춘다. 확장자는 생략돼 있다. */
function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null
  const rel = slash(relative(process.cwd(), resolve(dirname(from), spec)))
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
    if (known.has(rel + ext)) return rel + ext
  }
  return null
}

/** 이 파일이 import 하는 것들. 동적 `import('...')` 도 센다 — lazy 화면이 있다. */
const depsOf = new Map()
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const out = new Set()
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]/g)) {
    const t = resolveSpec(f, m[1] ?? m[2])
    if (t && t !== f) out.add(t)
  }
  // 워커는 `new Worker(new URL('./x.worker.ts', import.meta.url))` 로 불린다.
  // import 문이 아니라서 위 정규식에 안 걸린다.
  for (const m of src.matchAll(/new URL\(\s*['"]([^'"]+)['"]/g)) {
    const t = resolveSpec(f, m[1])
    if (t && t !== f) out.add(t)
  }
  depsOf.set(f, out)
}

// 진입점에서 닿는 곳을 칠한다.
const live = new Set()
const queue = ENTRY.filter((f) => known.has(f))
if (queue.length === 0) {
  console.error(`진입점을 못 찾았다: ${ENTRY.join(', ')}`)
  process.exit(1)
}
while (queue.length) {
  const f = queue.pop()
  if (live.has(f)) continue
  live.add(f)
  for (const d of depsOf.get(f) ?? []) queue.push(d)
}

const dead = files.filter((f) => !live.has(f) && !isTest(f))

// 죽은 것들끼리 묶어 보여 준다 — 입구 하나가 무너지면 그 아래가 같이 죽으므로
// 한 덩어리로 봐야 "왜" 가 보인다.
const deadSet = new Set(dead)
const deadImportedByDead = new Set()
for (const f of dead) for (const d of depsOf.get(f) ?? []) if (deadSet.has(d)) deadImportedByDead.add(d)
const roots = dead.filter((f) => !deadImportedByDead.has(f))

console.log(`\n닿을 수 없는 파일 ${dead.length}개 (진입점: ${ENTRY.join(', ')})\n`)
for (const r of roots) {
  console.log(`▸ ${r}`)
  const seen = new Set([r])
  const stack = [...(depsOf.get(r) ?? [])].filter((d) => deadSet.has(d))
  while (stack.length) {
    const d = stack.pop()
    if (seen.has(d)) continue
    seen.add(d)
    console.log(`    ${d}`)
    for (const n of depsOf.get(d) ?? []) if (deadSet.has(n)) stack.push(n)
  }
}

const testedDead = dead.filter((f) =>
  files.some((t) => isTest(t) && (depsOf.get(t) ?? []).has(f)),
)
if (testedDead.length) {
  console.log(`\n이 중 ${testedDead.length}개는 **테스트가 있다** — 살아 있어 보이지만 화면에서는 못 연다:`)
  for (const f of testedDead) console.log(`  ${f}`)
}

console.log('\n지우기 전에 **왜 닿을 수 없게 됐는지** 먼저 본다. 입구만 사라진 것일 수 있다:')
console.log('  git log --all -S"<파일명>" --format="%h %ad %s" --date=short -- src/')
