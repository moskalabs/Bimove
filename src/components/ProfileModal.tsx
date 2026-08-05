// 프로필 설정 모달 — 이름 변경, 비밀번호 변경
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, updatePassword, updateDisplayName, signOut } = useAuth()
  const [tab, setTab] = useState<'profile' | 'password'>('profile')

  // profile
  const currentName = (user?.user_metadata?.display_name as string) ?? user?.email?.split('@')[0] ?? ''
  const [displayName, setDisplayName] = useState(currentName)
  const [profileMsg, setProfileMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  // password
  const [newPw, setNewPw] = useState('')
  const [newPwConfirm, setNewPwConfirm] = useState('')
  const [pwMsg, setPwMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)
  const [pwLoading, setPwLoading] = useState(false)

  const handleProfileSave = async () => {
    if (!displayName.trim()) { setProfileMsg({ text: '이름을 입력해주세요', type: 'err' }); return }
    setProfileLoading(true)
    setProfileMsg(null)
    const err = await updateDisplayName(displayName.trim())
    setProfileLoading(false)
    if (err) { setProfileMsg({ text: err, type: 'err' }); return }
    setProfileMsg({ text: '이름이 변경되었습니다.', type: 'ok' })
  }

  const handlePasswordChange = async () => {
    setPwMsg(null)
    if (newPw.length < 8) { setPwMsg({ text: '8자 이상 입력해주세요', type: 'err' }); return }
    if (!/[A-Za-z]/.test(newPw)) { setPwMsg({ text: '영문자를 포함해주세요', type: 'err' }); return }
    if (!/[0-9]/.test(newPw)) { setPwMsg({ text: '숫자를 포함해주세요', type: 'err' }); return }
    if (!/[^A-Za-z0-9]/.test(newPw)) { setPwMsg({ text: '특수문자를 포함해주세요', type: 'err' }); return }
    if (newPw !== newPwConfirm) { setPwMsg({ text: '비밀번호가 일치하지 않습니다', type: 'err' }); return }

    setPwLoading(true)
    const err = await updatePassword(newPw)
    setPwLoading(false)
    if (err) { setPwMsg({ text: err, type: 'err' }); return }
    setPwMsg({ text: '비밀번호가 변경되었습니다.', type: 'ok' })
    setNewPw('')
    setNewPwConfirm('')
  }

  return (
    <div
      className="profile-overlay"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.4)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="profile-modal" style={{
        width: 400, background: '#fff', borderRadius: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)', padding: '28px 32px',
      }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>설정</div>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        {/* 탭 */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1.5px solid #eee' }}>
          {([['profile', '프로필'], ['password', '비밀번호 변경']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1, padding: '8px 0', border: 'none', background: 'none',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                color: tab === key ? '#3b82f6' : '#aaa',
                borderBottom: tab === key ? '2px solid #3b82f6' : '2px solid transparent',
                marginBottom: -1.5,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'profile' && (
          <div>
            <label style={labelStyle}>이메일</label>
            <input value={user?.email ?? ''} disabled style={{ ...inputStyle, background: '#f5f5f5', color: '#999' }} />

            <label style={labelStyle}>이름</label>
            <input
              value={displayName}
              onChange={e => { setDisplayName(e.target.value); setProfileMsg(null) }}
              style={inputStyle}
              placeholder="표시 이름"
            />

            {profileMsg && (
              <div style={profileMsg.type === 'ok' ? infoStyle : errorStyle}>{profileMsg.text}</div>
            )}

            <button onClick={handleProfileSave} disabled={profileLoading} style={actionBtnStyle(profileLoading)}>
              {profileLoading ? '저장 중...' : '이름 저장'}
            </button>

            <div style={{ borderTop: '1px solid #eee', marginTop: 20, paddingTop: 16 }}>
              <button onClick={signOut} style={logoutBtnStyle}>
                로그아웃
              </button>
            </div>
          </div>
        )}

        {tab === 'password' && (
          <div>
            <label style={labelStyle}>새 비밀번호</label>
            <input
              type="password"
              value={newPw}
              onChange={e => { setNewPw(e.target.value); setPwMsg(null) }}
              style={inputStyle}
              placeholder="8자 이상, 영문+숫자+특수문자"
            />

            <label style={labelStyle}>비밀번호 확인</label>
            <input
              type="password"
              value={newPwConfirm}
              onChange={e => { setNewPwConfirm(e.target.value); setPwMsg(null) }}
              style={inputStyle}
              placeholder="비밀번호 재입력"
            />

            {pwMsg && (
              <div style={pwMsg.type === 'ok' ? infoStyle : errorStyle}>{pwMsg.text}</div>
            )}

            <button onClick={handlePasswordChange} disabled={pwLoading} style={actionBtnStyle(pwLoading)}>
              {pwLoading ? '변경 중...' : '비밀번호 변경'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1.5px solid #e0e0e0', fontSize: 13, marginBottom: 12,
  outline: 'none', boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 4,
}

const errorStyle: React.CSSProperties = {
  fontSize: 12, color: '#ef4444', background: '#fef2f2',
  padding: '8px 12px', borderRadius: 8, marginBottom: 12,
}

const infoStyle: React.CSSProperties = {
  fontSize: 12, color: '#2563eb', background: '#eff6ff',
  padding: '8px 12px', borderRadius: 8, marginBottom: 12,
}

function actionBtnStyle(loading: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '10px 0', borderRadius: 10,
    border: 'none', background: '#3b82f6', color: '#fff',
    fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.7 : 1,
  }
}

const logoutBtnStyle: React.CSSProperties = {
  width: '100%', padding: '10px 0', borderRadius: 10,
  border: '1px solid #e0e0e0', background: '#fff', color: '#ef4444',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

const closeBtnStyle: React.CSSProperties = {
  border: 'none', background: 'none', fontSize: 16, color: '#aaa',
  cursor: 'pointer', padding: '4px 8px',
}
