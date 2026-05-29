// 두 tldraw snapshot 비교 → 추가/삭제/변경된 도형 목록

type Snapshot = {
  store?: Record<string, { id: string; typeName: string; type?: string; [key: string]: unknown }>
}

export type ShapeDiffItem = {
  id: string
  type: string
  status: 'added' | 'removed' | 'modified'
}

export type DiffResult = {
  added: ShapeDiffItem[]
  removed: ShapeDiffItem[]
  modified: ShapeDiffItem[]
  totalChanges: number
}

function extractShapes(snapshot: object): Map<string, { type: string; record: object }> {
  const map = new Map<string, { type: string; record: object }>()
  const store = (snapshot as Snapshot).store ?? {}
  for (const [id, rec] of Object.entries(store)) {
    if (!rec || typeof rec !== 'object') continue
    if (rec.typeName === 'shape') {
      map.set(id, { type: rec.type ?? 'shape', record: rec })
    }
  }
  return map
}

function recordsEqual(a: object, b: object): boolean {
  // 가벼운 비교 — JSON.stringify
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return a === b
  }
}

export function diffSnapshots(before: object, after: object): DiffResult {
  const beforeMap = extractShapes(before)
  const afterMap = extractShapes(after)

  const added: ShapeDiffItem[] = []
  const removed: ShapeDiffItem[] = []
  const modified: ShapeDiffItem[] = []

  // 추가/변경
  for (const [id, info] of afterMap) {
    const old = beforeMap.get(id)
    if (!old) {
      added.push({ id, type: info.type, status: 'added' })
    } else if (!recordsEqual(old.record, info.record)) {
      modified.push({ id, type: info.type, status: 'modified' })
    }
  }
  // 삭제
  for (const [id, info] of beforeMap) {
    if (!afterMap.has(id)) {
      removed.push({ id, type: info.type, status: 'removed' })
    }
  }

  return { added, removed, modified, totalChanges: added.length + removed.length + modified.length }
}
