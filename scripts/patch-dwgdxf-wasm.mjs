/**
 * dwgdxf WASM 의 OLE 데이터 상한(10MB)을 풀어 public/dwgdxf/ 로 내보낸다.
 *
 * acadrust 0.4.0 은 DWG 의 OLE2FRAME 바이너리를 읽을 때 길이를 10,000,000
 * 바이트로 깎는다 (src/io/dwg/dwg_stream_readers/object_reader/entities.rs):
 *
 *     // OLE binary data can be very large (embedded images/documents),
 *     // so don't use safe_count (100 KB cap). Use a generous 10 MB cap instead.
 *     let data_len = (reader.read_bit_long().max(0) as usize).min(10_000_000);
 *
 * 배치도 스캔 한 장이 12MB 를 넘는 건 흔하다. 그러면 BMP 아래쪽 줄이 잘려
 * 나가 캔버스에 반쪽 사진이 뜬다 (dxfOle.ts 의 validRows 가 그걸 센다).
 *
 * Rust 를 빌드하지 않고 상수만 바꾼다. i32.const 10_000_000 (41 80 ad e2 04)
 * → 100_000_000 (41 80 c2 d7 2f). LEB128 길이가 같으므로 그 자리에 덮어쓰면
 * 되고, 섹션 크기나 오프셋은 하나도 안 움직인다.
 *
 * **주의 — 6곳 중 2곳은 Rust 표준 라이브러리의 float 포맷터(flt2dec)다.**
 * 실측으로 확인했다: 그 둘을 건드리면 DXF 안의 실수가 `-o.1466061e-150`
 * 처럼 깨지거나 변환 자체가 panic 한다. 그래서 인덱스 2·3 은 건너뛴다.
 * 나머지 4곳은 acadrust 의 sanity cap 이다 (OLE 1곳 + 압축 섹션 검증 3곳).
 *
 * 인덱스로 거르는 건 이 바이너리에서만 유효하므로, 원본 해시가 바뀌면
 * 패치하지 않고 원본을 그대로 내보낸다 — 이미지가 다시 잘릴 뿐 변환은
 * 평소대로 돈다. 그때는 아래 KNOWN_SHA256 과 SKIP 를 다시 재서 갱신한다.
 */

import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'node_modules', 'dwgdxf', 'dist', 'wasm')
const OUT = join(ROOT, 'public', 'dwgdxf')

/** dwgdxf 2.0.1 이 담고 있는 dwgdxf_bg.wasm */
const KNOWN_SHA256 = 'f2daf01c1873e82d4bcae3da82b26ac9a92e916affd767a2babbe1443793f728'

const OLD = Buffer.from([0x41, 0x80, 0xad, 0xe2, 0x04])   // i32.const 10_000_000
const NEW = Buffer.from([0x41, 0x80, 0xc2, 0xd7, 0x2f])   // i32.const 100_000_000
const EXPECTED_SITES = 6
/** flt2dec. 건드리면 숫자가 깨진다. */
const SKIP = new Set([2, 3])

function findSites(buf) {
  const sites = []
  for (let i = 0; ; ) {
    const k = buf.indexOf(OLD, i)
    if (k < 0) break
    sites.push(k)
    i = k + OLD.length
  }
  return sites
}

mkdirSync(OUT, { recursive: true })
copyFileSync(join(SRC, 'dwgdxf.js'), join(OUT, 'dwgdxf.js'))

const buf = readFileSync(join(SRC, 'dwgdxf_bg.wasm'))
const sha = createHash('sha256').update(buf).digest('hex')

if (sha !== KNOWN_SHA256) {
  console.warn(
    `[patch-dwgdxf-wasm] dwgdxf_bg.wasm 해시가 다르다 (${sha.slice(0, 16)}…).\n` +
    `  10MB OLE 상한을 풀지 않고 원본을 내보낸다 — 큰 OLE 이미지는 잘린 채 들어온다.\n` +
    `  scripts/patch-dwgdxf-wasm.mjs 의 KNOWN_SHA256/SKIP 을 다시 재서 갱신할 것.`)
  writeFileSync(join(OUT, 'dwgdxf_bg.wasm'), buf)
  process.exit(0)
}

const sites = findSites(buf)
if (sites.length !== EXPECTED_SITES) {
  console.warn(
    `[patch-dwgdxf-wasm] i32.const 10_000_000 을 ${sites.length}곳 찾았다 ` +
    `(예상 ${EXPECTED_SITES}곳). 패치하지 않고 원본을 내보낸다.`)
  writeFileSync(join(OUT, 'dwgdxf_bg.wasm'), buf)
  process.exit(0)
}

let patched = 0
sites.forEach((off, i) => {
  if (SKIP.has(i)) return
  NEW.copy(buf, off)
  patched++
})
writeFileSync(join(OUT, 'dwgdxf_bg.wasm'), buf)
console.log(
  `[patch-dwgdxf-wasm] OLE 상한 해제: ${patched}/${sites.length}곳 패치 ` +
  `(flt2dec ${[...SKIP].join(',')} 제외) → public/dwgdxf/`)
