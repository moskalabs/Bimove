import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { ProfileModal } from './ProfileModal'
import {
  fetchProjects, createProject as createProjectDB,
  deleteProject as deleteProjectDB, renameProject as renameProjectDB,
  saveProjectSnapshot,
} from '../lib/supabaseSync'
import { readShareFromHash, clearShareHash } from '../lib/shareLink'

type Project = {
  id: string
  name: string
  thumbnail: string | null
  created_at: string
  updated_at: string
}

type NavSection = 'recent' | 'favorites' | 'all' | 'team'

function formatDate(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/* ── Icons (inline SVG) ── */
const Icons = {
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
}

/* ── Sidebar ── */
function DashboardSidebar({
  active, onNav, email, onSettings, onSignOut,
}: {
  active: NavSection
  onNav: (s: NavSection) => void
  email: string
  onSettings: () => void
  onSignOut: () => void
}) {
  const items: { key: NavSection; label: string; icon: React.ReactNode }[] = [
    { key: 'recent', label: '최근 프로젝트', icon: Icons.clock },
    { key: 'favorites', label: '즐겨찾기', icon: Icons.star },
    { key: 'all', label: '전체 프로젝트', icon: Icons.grid },
    { key: 'team', label: '팀', icon: Icons.users },
  ]

  return (
    <aside className="dash-sidebar">
      <div className="dash-sidebar-logo">bimova</div>
      <nav className="dash-sidebar-nav">
        {items.map(it => (
          <button
            key={it.key}
            className={`dash-nav-item${active === it.key ? ' active' : ''}`}
            onClick={() => onNav(it.key)}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </nav>
      <div className="dash-sidebar-footer">
        <div className="dash-user-email">{email}</div>
        <div className="dash-footer-btns">
          <button className="dash-footer-btn" onClick={onSettings}>설정</button>
          <button className="dash-footer-btn" onClick={onSignOut}>로그아웃</button>
        </div>
      </div>
    </aside>
  )
}

/* ── New Project Modal ── */
function NewProjectModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState(false)
  const [template, setTemplate] = useState<'blank' | 'import'>('blank')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const confirm = () => {
    if (!name.trim()) { setError(true); inputRef.current?.focus(); return }
    onCreate(name.trim())
    onClose()
  }

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={e => e.stopPropagation()}>
        <div className="dash-modal-title">새 프로젝트</div>

        <div className="dash-modal-label">프로젝트 이름</div>
        <input
          ref={inputRef}
          className={`dash-modal-input${error ? ' error' : ''}`}
          value={name}
          onChange={e => { setName(e.target.value); if (error) setError(false) }}
          onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onClose() }}
          placeholder="예: 강남 카페 인테리어"
        />
        {error && <div className="dash-modal-error">프로젝트 이름을 입력해주세요</div>}

        <div className="dash-modal-templates">
          <button
            className={`dash-template-card${template === 'blank' ? ' selected' : ''}`}
            onClick={() => setTemplate('blank')}
          >
            <span className="dash-template-icon">📐</span>
            <span className="dash-template-label">빈 프로젝트</span>
            <span className="dash-template-desc">처음부터 새로 시작</span>
          </button>
          <button
            className={`dash-template-card${template === 'import' ? ' selected' : ''}`}
            onClick={() => setTemplate('import')}
          >
            <span className="dash-template-icon">📁</span>
            <span className="dash-template-label">DWG 불러오기</span>
            <span className="dash-template-desc">기존 도면에서 시작</span>
          </button>
        </div>

        <div className="dash-modal-actions">
          <button className="dash-modal-btn secondary" onClick={onClose}>취소</button>
          <button className="dash-modal-btn primary" onClick={confirm}>만들기</button>
        </div>
      </div>
    </div>
  )
}

/* ── Project Card ── */
function ProjectCard({ project, onOpen, onDelete, onRename }: {
  project: Project
  onOpen: () => void
  onDelete: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const inputRef = useRef<HTMLInputElement>(null)

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
    <div className="dash-card" onClick={onOpen}>
      <div className="dash-card-thumb">
        {project.thumbnail
          ? <img src={project.thumbnail} alt="" />
          : <span className="dash-card-thumb-empty">🏗️</span>
        }
      </div>
      <div className="dash-card-info">
        <div className="dash-card-name">
          {editing ? (
            <input
              ref={inputRef}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
              onBlur={commitEdit}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span onDoubleClick={startEdit} title="더블클릭으로 이름 변경">
              {project.name}
            </span>
          )}
        </div>
        <div className="dash-card-date">수정 {formatDate(project.updated_at)}</div>
      </div>
      <button
        className="dash-card-delete"
        onClick={e => { e.stopPropagation(); onDelete() }}
        title="삭제"
      >✕</button>
    </div>
  )
}

/* ── Main Page ── */
export function ProjectsPage({ onOpen }: { onOpen: (id: string, name?: string) => void }) {
  const { user, signOut } = useAuth()
  const { toast } = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showProfile, setShowProfile] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [navSection, setNavSection] = useState<NavSection>('all')

  const loadProjects = async () => {
    if (!user) return
    try {
      const data = await fetchProjects(user.id)
      setProjects(data)
    } catch (err) {
      console.warn('[projects] fetch failed', err)
      toast('프로젝트 목록을 불러오지 못했습니다.', 'error')
      setProjects([])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadProjects()
    // handle share link import
    void (async () => {
      if (!user) return
      if (!window.location.hash.startsWith('#share=')) return
      const shared = await readShareFromHash()
      if (!shared) {
        toast('공유 링크를 열 수 없습니다. 링크가 손상되었을 수 있습니다.', 'error')
        clearShareHash()
        return
      }
      try {
        const p = await createProjectDB(user.id, shared.name + ' (공유받음)')
        if (p) {
          await saveProjectSnapshot(p.id, shared.snapshot)
          clearShareHash()
          await loadProjects()
          toast(`"${shared.name}" 프로젝트를 공유받았습니다.`, 'success')
          onOpen(p.id, p.name)
        }
      } catch {
        toast('공유 프로젝트를 저장하지 못했습니다.', 'error')
        clearShareHash()
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const handleCreate = async (name: string) => {
    if (!user) return
    try {
      const p = await createProjectDB(user.id, name)
      if (p) {
        toast(`"${name}" 프로젝트가 생성되었습니다.`, 'success')
        await loadProjects()
        onOpen(p.id, p.name)
      }
    } catch {
      toast('프로젝트 생성에 실패했습니다.', 'error')
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 프로젝트를 삭제할까요?`)) return
    await deleteProjectDB(id)
    await loadProjects()
  }

  const handleRename = async (id: string, name: string) => {
    await renameProjectDB(id, name)
    await loadProjects()
  }

  // Filter projects by nav section
  const filteredProjects = (() => {
    switch (navSection) {
      case 'recent': {
        const sorted = [...projects].sort((a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
        return sorted.slice(0, 6)
      }
      case 'favorites':
        return [] // TODO: implement favorites
      case 'team':
        return [] // TODO: implement team
      case 'all':
      default:
        return projects
    }
  })()

  // Recent projects for the header section (top 3)
  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 3)

  const sectionTitle = (() => {
    switch (navSection) {
      case 'recent': return '최근 프로젝트'
      case 'favorites': return '즐겨찾기'
      case 'team': return '팀 프로젝트'
      case 'all':
      default: return '전체 프로젝트'
    }
  })()

  return (
    <div className="dashboard">
      <DashboardSidebar
        active={navSection}
        onNav={setNavSection}
        email={user?.email ?? ''}
        onSettings={() => setShowProfile(true)}
        onSignOut={signOut}
      />

      <main className="dash-main">
        {/* Header */}
        <div className="dash-header">
          <div className="dash-header-title">
            {loading ? '로딩 중...' : `${projects.length}개의 프로젝트`}
          </div>
          <div className="dash-header-actions">
            <button className="dash-btn-primary" onClick={() => setShowNewModal(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              새 프로젝트
            </button>
            <button className="dash-btn-icon" onClick={() => setShowProfile(true)} title="설정">
              {Icons.settings}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="dash-loading">
            <div className="dash-spinner" />
            프로젝트 불러오는 중...
          </div>
        ) : projects.length === 0 ? (
          <div className="dash-empty">
            <div className="dash-empty-icon">📐</div>
            <div className="dash-empty-text">아직 프로젝트가 없어요</div>
            <div className="dash-empty-sub">새 프로젝트를 만들어 시작해보세요</div>
          </div>
        ) : (
          <>
            {/* Recent section (only on 'all' view) */}
            {navSection === 'all' && recentProjects.length > 0 && (
              <section className="dash-section">
                <div className="dash-section-title">최근 프로젝트</div>
                <div className="dash-grid">
                  {recentProjects.map(p => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      onOpen={() => onOpen(p.id, p.name)}
                      onDelete={() => handleDelete(p.id, p.name)}
                      onRename={name => handleRename(p.id, name)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Main section */}
            <section className="dash-section">
              <div className="dash-section-title">
                {navSection === 'all' ? '전체 프로젝트' : sectionTitle}
              </div>
              {filteredProjects.length === 0 ? (
                <div className="dash-empty">
                  <div className="dash-empty-icon">
                    {navSection === 'favorites' ? '⭐' : '👥'}
                  </div>
                  <div className="dash-empty-text">
                    {navSection === 'favorites' ? '즐겨찾기한 프로젝트가 없어요' : '팀 프로젝트가 없어요'}
                  </div>
                  <div className="dash-empty-sub">곧 지원될 예정이에요</div>
                </div>
              ) : (
                <div className="dash-grid">
                  {filteredProjects.map(p => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      onOpen={() => onOpen(p.id, p.name)}
                      onDelete={() => handleDelete(p.id, p.name)}
                      onRename={name => handleRename(p.id, name)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {showNewModal && (
        <NewProjectModal
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreate}
        />
      )}

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  )
}
