import { useCallback, useEffect, useState } from 'react'
import type { Editor, TLStoreSnapshot } from 'tldraw'
import { listVersions, getVersion, deleteVersion, renameVersion } from '../lib/versions'
import { listMergedVersions, type MergedVersion } from '../lib/versionSync'
import {
  fetchProjectVersionMetas, fetchProjectVersionSnapshot,
  deleteProjectVersion, renameProjectVersion,
} from '../lib/supabaseSync'
import { diffSnapshots, type DiffResult } from '../lib/versionDiff'

type Props = {
  editor: Editor | null
  projectId: string
  onClose: () => void
  onRestored?: () => void
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 이 버전이 어디에 남아 있는지. "이 기기" 는 다른 기기에서 안 보인다는 뜻. */
function originBadge(v: MergedVersion) {
  if (v.local && v.remote) return { text: '동기화', color: '#2d8a2d', bg: '#eaf6ea' }
  if (v.remote) return { text: '서버', color: '#1a73e8', bg: '#e8f0fe' }
  return { text: '이 기기', color: '#8a6d00', bg: '#fff8d8' }
}

const syncDeps = {
  listLocal: listVersions,
  fetchRemoteMetas: fetchProjectVersionMetas,
}

export function VersionHistoryPanel({ editor, projectId, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<MergedVersion[]>([])
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [compareIds, setCompareIds] = useState<[string?, string?]>([])
  const [diff, setDiff] = useState<DiffResult | null>(null)

  const refresh = useCallback(async () => {
    const { versions: merged, remoteError: err } = await listMergedVersions(projectId, syncDeps)
    // 이미 받아둔 스냅샷은 유지한다 — 안 그러면 비교하려고 내려받은 서버
    // 버전을 목록 갱신 한 번에 다시 받는다.
    setVersions(prev => {
      const cached = new Map(prev.filter(v => v.snapshot).map(v => [v.id, v.snapshot!]))
      return merged.map(v => v.snapshot ? v : { ...v, snapshot: cached.get(v.id) ?? null })
    })
    setRemoteError(err)
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    let alive = true
    void listMergedVersions(projectId, syncDeps).then(({ versions: merged, remoteError: err }) => {
      if (!alive) return
      setVersions(merged)
      setRemoteError(err)
      setLoading(false)
    })
    return () => { alive = false }
  }, [projectId])

  /** 서버에만 있는 버전의 스냅샷을 받아서 목록에 채워넣는다. */
  const ensureSnapshot = useCallback(async (id: string): Promise<object | null> => {
    const hit = versions.find(v => v.id === id)
    if (!hit) return null
    if (hit.snapshot) return hit.snapshot
    setBusyId(id)
    try {
      // 로컬에 있으면 로컬에서. 목록은 메타만 들고 있어서 본문은 여기서 처음 읽는다
      // (스냅샷 하나가 수 MB 라 패널 여는 것만으로 다 읽을 수는 없다).
      const snap = hit.local
        ? (await getVersion(projectId, id))?.snapshot ?? null
        : await fetchProjectVersionSnapshot(id)
      if (snap) setVersions(prev => prev.map(v => v.id === id ? { ...v, snapshot: snap } : v))
      else if (!hit.local) alert('서버에서 이 버전을 찾지 못했습니다.')
      return snap
    } catch (err) {
      alert('이 버전을 불러오지 못했습니다: ' + String(err))
      return null
    } finally {
      setBusyId(null)
    }
  }, [versions, projectId])

  // 두 개 선택되면 diff 계산 (derived state via useMemo로 변환했으면 좋겠지만
  // useEffect로 두는 게 컴포넌트 의도와 맞아서 disable 처리)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const [aId, bId] = compareIds
    if (!aId || !bId) { setDiff(null); return }
    const a = versions.find(v => v.id === aId)
    const b = versions.find(v => v.id === bId)
    // 서버 전용 버전은 스냅샷이 아직 없을 수 있다 — toggleCompare 가 받아오는
    // 중이고, 들어오면 versions 가 바뀌어 이 effect 가 다시 돈다.
    if (!a?.snapshot || !b?.snapshot) { setDiff(null); return }
    setDiff(diffSnapshots(a.snapshot, b.snapshot))
  }, [compareIds, versions])
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleCompare = (id: string) => {
    setCompareIds(([a, b]) => {
      if (a === id) return [b, undefined]
      if (b === id) return [a, undefined]
      if (!a) return [id, b]
      if (!b) return [a, id]
      // 둘 다 선택돼있으면 b를 새 걸로 교체
      return [a, id]
    })
    void ensureSnapshot(id)
  }

  const handleRestore = async (v: MergedVersion) => {
    if (!editor) return
    if (!confirm(`'${v.label ?? fmtTime(v.timestamp)}' 버전으로 복원할까요?\n현재 작업은 (자동 저장된 경우) 이전 버전에 남아있어.`)) return
    const snapshot = await ensureSnapshot(v.id)
    if (!snapshot) return
    try {
      editor.store.loadSnapshot(snapshot as TLStoreSnapshot)
      onRestored?.()
      onClose()
    } catch (err) {
      alert('복원 실패: ' + String(err))
    }
  }

  const handleDelete = async (v: MergedVersion) => {
    if (!confirm(`이 버전을 삭제할까요?`)) return
    if (v.local) await deleteVersion(projectId, v.id)
    // 서버에서도 지워야 한다 — 로컬만 지우면 다음에 패널을 열 때
    // 서버 목록에서 그대로 다시 나타난다.
    if (v.remote) {
      try {
        await deleteProjectVersion(v.id)
      } catch (err) {
        alert('서버에서 삭제하지 못했습니다: ' + String(err))
      }
    }
    await refresh()
  }

  const startRename = (v: MergedVersion) => {
    setEditingId(v.id)
    setEditLabel(v.label ?? '')
  }

  const commitRename = async (v: MergedVersion) => {
    const label = editLabel.trim() || null
    setEditingId(null)
    if (v.local) await renameVersion(projectId, v.id, editLabel)
    if (v.remote) {
      try {
        await renameProjectVersion(v.id, label)
      } catch (err) {
        alert('서버에 이름을 저장하지 못했습니다: ' + String(err))
      }
    }
    await refresh()
  }

  return (
    <div className="vh-overlay" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }} onClick={onClose}>
      <div className="vh-modal" style={{
        background: '#fff', borderRadius: 12, padding: 20, minWidth: 480, maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, flex: 1 }}>📜 버전 히스토리</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {remoteError && (
          <div style={{
            marginBottom: 12, padding: '8px 10px', borderRadius: 6,
            background: '#fdecea', color: '#a1281e', fontSize: 12,
          }}>
            서버 버전을 불러오지 못했습니다 — 이 기기에 저장된 것만 보입니다.
          </div>
        )}

        {loading ? (
          <p style={{ color: '#888', textAlign: 'center', padding: 32 }}>불러오는 중…</p>
        ) : versions.length === 0 ? (
          <p style={{ color: '#888', textAlign: 'center', padding: 32 }}>
            아직 저장된 버전이 없어. <br />
            도면을 고치면 5분마다 자동으로 저장돼.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, overflowY: 'auto', flex: 1 }}>
            {versions.map(v => {
              const isSelected = compareIds[0] === v.id || compareIds[1] === v.id
              const badge = originBadge(v)
              return (
              <li key={v.id} style={{
                padding: 12, borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 8,
                background: isSelected ? '#fff8d8' : undefined,
                opacity: busyId === v.id ? 0.5 : undefined,
              }}>
                <input type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleCompare(v.id)}
                  title="비교 선택 (최대 2개)"
                  style={{ cursor: 'pointer' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === v.id ? (
                    <input
                      value={editLabel}
                      onChange={e => setEditLabel(e.target.value)}
                      onBlur={() => void commitRename(v)}
                      onKeyDown={e => { if (e.key === 'Enter') void commitRename(v) }}
                      autoFocus
                      style={{ width: '100%', padding: 4, fontSize: 14 }}
                    />
                  ) : (
                    <div onDoubleClick={() => startRename(v)} style={{ cursor: 'text' }}>
                      <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{v.label ?? fmtTime(v.timestamp)}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 10,
                          color: badge.color, background: badge.bg, whiteSpace: 'nowrap',
                        }}>{badge.text}</span>
                      </div>
                      {v.label && (
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{fmtTime(v.timestamp)}</div>
                      )}
                    </div>
                  )}
                </div>
                <button onClick={() => void handleRestore(v)} disabled={busyId === v.id} style={btnStyle}>복원</button>
                <button onClick={() => void handleDelete(v)} disabled={busyId === v.id} style={{ ...btnStyle, color: '#c33' }}>삭제</button>
              </li>
              )
            })}
          </ul>
        )}
        {diff && (
          <div style={{ marginTop: 12, padding: 12, background: '#fff8d8', borderRadius: 6, fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>📊 비교 결과 ({diff.totalChanges}개 변경)</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ color: '#2d8a2d' }}>+ 추가 {diff.added.length}개</span>
              <span style={{ color: '#c33' }}>− 삭제 {diff.removed.length}개</span>
              <span style={{ color: '#1a73e8' }}>✎ 변경 {diff.modified.length}개</span>
            </div>
            {diff.totalChanges > 0 && diff.totalChanges < 20 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 16, color: '#666' }}>
                {diff.added.map(d => <li key={'a-'+d.id} style={{ color: '#2d8a2d' }}>+ {d.type}</li>)}
                {diff.removed.map(d => <li key={'r-'+d.id} style={{ color: '#c33' }}>− {d.type}</li>)}
                {diff.modified.map(d => <li key={'m-'+d.id} style={{ color: '#1a73e8' }}>✎ {d.type}</li>)}
              </ul>
            )}
          </div>
        )}
        <p style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
          이 기기 30개 + 서버 30개. 더블클릭=이름 편집. 체크박스 2개=버전 비교.
        </p>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px', border: '1px solid #ccc', borderRadius: 6,
  background: '#f5f5f5', cursor: 'pointer', fontSize: 12,
}
