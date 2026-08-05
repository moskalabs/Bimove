import { useEffect, useState } from 'react'
import type { Editor, TLStoreSnapshot } from 'tldraw'
import { listVersions, deleteVersion, renameVersion, type Version } from '../lib/versions'
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

export function VersionHistoryPanel({ editor, projectId, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<Version[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [compareIds, setCompareIds] = useState<[string?, string?]>([])
  const [diff, setDiff] = useState<DiffResult | null>(null)

  // 두 개 선택되면 diff 계산 (derived state via useMemo로 변환했으면 좋겠지만
  // useEffect로 두는 게 컴포넌트 의도와 맞아서 disable 처리)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const [aId, bId] = compareIds
    if (!aId || !bId) { setDiff(null); return }
    const a = versions.find(v => v.id === aId)
    const b = versions.find(v => v.id === bId)
    if (!a || !b) { setDiff(null); return }
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
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVersions(listVersions(projectId))
  }, [projectId])

  const refresh = () => setVersions(listVersions(projectId))

  const handleRestore = (v: Version) => {
    if (!editor) return
    if (!confirm(`'${v.label ?? fmtTime(v.timestamp)}' 버전으로 복원할까요?\n현재 작업은 (자동 저장된 경우) 이전 버전에 남아있어.`)) return
    try {
      editor.store.loadSnapshot(v.snapshot as TLStoreSnapshot)
      onRestored?.()
      onClose()
    } catch (err) {
      alert('복원 실패: ' + String(err))
    }
  }

  const handleDelete = (v: Version) => {
    if (!confirm(`이 버전을 삭제할까요?`)) return
    deleteVersion(projectId, v.id)
    refresh()
  }

  const startRename = (v: Version) => {
    setEditingId(v.id)
    setEditLabel(v.label ?? '')
  }

  const commitRename = (v: Version) => {
    renameVersion(projectId, v.id, editLabel)
    setEditingId(null)
    refresh()
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

        {versions.length === 0 ? (
          <p style={{ color: '#888', textAlign: 'center', padding: 32 }}>
            아직 저장된 버전이 없어. <br />
            "저장" 버튼을 누르거나 자동 저장을 기다려.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, overflowY: 'auto', flex: 1 }}>
            {versions.map(v => {
              const isSelected = compareIds[0] === v.id || compareIds[1] === v.id
              return (
              <li key={v.id} style={{
                padding: 12, borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 8,
                background: isSelected ? '#fff8d8' : undefined,
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
                      onBlur={() => commitRename(v)}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(v) }}
                      autoFocus
                      style={{ width: '100%', padding: 4, fontSize: 14 }}
                    />
                  ) : (
                    <div onDoubleClick={() => startRename(v)} style={{ cursor: 'text' }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {v.label ?? fmtTime(v.timestamp)}
                      </div>
                      {v.label && (
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{fmtTime(v.timestamp)}</div>
                      )}
                    </div>
                  )}
                </div>
                <button onClick={() => handleRestore(v)} style={btnStyle}>복원</button>
                <button onClick={() => handleDelete(v)} style={{ ...btnStyle, color: '#c33' }}>삭제</button>
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
          최대 30개 버전. 더블클릭=이름 편집. 체크박스 2개=버전 비교.
        </p>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px', border: '1px solid #ccc', borderRadius: 6,
  background: '#f5f5f5', cursor: 'pointer', fontSize: 12,
}
