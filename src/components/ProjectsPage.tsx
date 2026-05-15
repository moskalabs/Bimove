import { useState, useEffect, useRef } from 'react'
import type { Project } from '../lib/projectStore'
import { getProjects, createProject, deleteProject, renameProject, migrateOldData } from '../lib/projectStore'

function formatDate(ts: number) {
  const d = new Date(ts)
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function NewProjectCard({ onCreate }: { onCreate: (name: string) => void }) {
  const [active, setActive] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const open = () => { setActive(true); setTimeout(() => inputRef.current?.focus(), 50) }
  const confirm = () => {
    if (name.trim()) { onCreate(name); setName(''); setActive(false); setError(false) }
    else { setError(true); inputRef.current?.focus() }
  }
  const cancel = () => { setName(''); setActive(false); setError(false) }

  if (!active) return (
    <button onClick={open} style={cardStyle(true)}>
      <span style={{ fontSize: 32, color: '#bbb', lineHeight: 1 }}>+</span>
      <span style={{ color: '#888', fontSize: 13, marginTop: 8 }}>새 프로젝트</span>
    </button>
  )

  return (
    <div style={cardStyle(false)}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🏠</div>
      <input
        ref={inputRef}
        value={name}
        onChange={e => { setName(e.target.value); if (error) setError(false) }}
        onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') cancel() }}
        placeholder="프로젝트 이름"
        style={{
          width: '100%', border: 'none',
          borderBottom: `2px solid ${error ? '#ef4444' : '#3b82f6'}`,
          outline: 'none', fontSize: 14, fontWeight: 600, textAlign: 'center',
          background: 'transparent', padding: '2px 0',
        }}
      />
      {error && (
        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>이름을 입력해주세요</div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button onClick={confirm} style={miniBtn('#3b82f6', '#fff')}>만들기</button>
        <button onClick={cancel} style={miniBtn('#f0f0f0', '#555')}>취소</button>
      </div>
    </div>
  )
}

function ProjectCard({ project, onOpen, onDelete, onRename }: {
  project: Project
  onOpen: () => void
  onDelete: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const [hovered, setHovered] = useState(false)

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditName(project.name)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 50)
  }

  const commitEdit = () => {
    if (editName.trim()) onRename(editName)
    setEditing(false)
  }

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...cardStyle(false),
        cursor: 'pointer',
        boxShadow: hovered ? '0 4px 20px rgba(0,0,0,0.12)' : '0 1px 4px rgba(0,0,0,0.07)',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'all 0.15s ease',
        position: 'relative',
      }}
    >
      {/* thumbnail */}
      <div style={{
        width: '100%', height: 90, borderRadius: 8, background: '#f5f5f5',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 10, overflow: 'hidden',
      }}>
        {project.thumbnail
          ? <img src={project.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <span style={{ fontSize: 28, opacity: 0.4 }}>🏗️</span>
        }
      </div>

      {editing ? (
        <input
          ref={inputRef}
          value={editName}
          onChange={e => setEditName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
          onBlur={commitEdit}
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', border: 'none', borderBottom: '2px solid #3b82f6',
            outline: 'none', fontSize: 13, fontWeight: 600, textAlign: 'center',
            background: 'transparent', padding: '2px 0',
          }}
        />
      ) : (
        <div
          onDoubleClick={startEdit}
          title="더블클릭으로 이름 변경"
          style={{ fontSize: 13, fontWeight: 600, color: '#222', textAlign: 'center', wordBreak: 'break-all' }}
        >
          {project.name}
        </div>
      )}

      <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
        수정 {formatDate(project.updatedAt)}
      </div>

      {/* delete button */}
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        style={{
          position: 'absolute', top: 8, right: 8,
          background: hovered ? '#fee2e2' : 'transparent',
          border: 'none', borderRadius: 6, width: 26, height: 26,
          cursor: 'pointer', fontSize: 13, color: '#ef4444',
          opacity: hovered ? 1 : 0, transition: 'opacity 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="삭제"
      >✕</button>
    </div>
  )
}

function cardStyle(dashed: boolean): React.CSSProperties {
  return {
    width: 160,
    minHeight: 180,
    borderRadius: 12,
    border: dashed ? '2px dashed #ddd' : '1.5px solid #e8e8e8',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '14px 12px',
    cursor: dashed ? 'pointer' : 'default',
  }
}

function miniBtn(bg: string, color: string): React.CSSProperties {
  return {
    flex: 1, padding: '5px 0', borderRadius: 6, border: 'none',
    background: bg, color, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  }
}

export function ProjectsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    migrateOldData()
    setProjects(getProjects())
  }, [])

  const refresh = () => setProjects(getProjects())

  const handleCreate = (name: string) => {
    const p = createProject(name)
    refresh()
    onOpen(p.id)
  }

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`"${name}" 프로젝트를 삭제할까요?`)) return
    deleteProject(id)
    refresh()
  }

  const handleRename = (id: string, name: string) => {
    renameProject(id, name)
    refresh()
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f8f8f8',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* header */}
      <div style={{
        padding: '32px 40px 24px',
        borderBottom: '1px solid #e8e8e8',
        background: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#111', letterSpacing: -0.5 }}>bimove</span>
          <span style={{ fontSize: 12, background: '#f0f0f0', color: '#888', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
            프로젝트
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#999' }}>
          {projects.length > 0 ? `${projects.length}개의 프로젝트` : '아직 프로젝트가 없어요'}
        </p>
      </div>

      {/* grid */}
      <div style={{
        padding: '32px 40px',
        display: 'flex', flexWrap: 'wrap', gap: 16,
        alignContent: 'flex-start',
      }}>
        <NewProjectCard onCreate={handleCreate} />
        {projects.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            onOpen={() => onOpen(p.id)}
            onDelete={() => handleDelete(p.id, p.name)}
            onRename={name => handleRename(p.id, name)}
          />
        ))}
      </div>
    </div>
  )
}
