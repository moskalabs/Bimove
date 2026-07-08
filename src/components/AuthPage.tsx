// 로그인/회원가입 페이지
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password.trim()) {
      setError('이메일과 비밀번호를 입력해주세요')
      return
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다')
      return
    }
    setLoading(true)
    setError(null)

    const err = mode === 'login'
      ? await signIn(email, password)
      : await signUp(email, password, displayName || undefined)

    if (err) {
      setError(err)
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #f0f4ff 0%, #e8f0fe 100%)',
    }}>
      <div style={{
        width: 360, background: '#fff', borderRadius: 16,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)', padding: '36px 32px',
      }}>
        {/* logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#111', letterSpacing: -0.5 }}>
            bimove
          </div>
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
            BIM 에디터
          </div>
        </div>

        {/* tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1.5px solid #eee' }}>
          {(['login', 'signup'] as const).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null) }}
              style={{
                flex: 1, padding: '10px 0', border: 'none', background: 'none',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                color: mode === m ? '#3b82f6' : '#aaa',
                borderBottom: mode === m ? '2px solid #3b82f6' : '2px solid transparent',
                marginBottom: -1.5, transition: 'all 0.15s',
              }}
            >
              {m === 'login' ? '로그인' : '회원가입'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="이름 (선택)"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              style={inputStyle}
            />
          )}
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(null) }}
            style={inputStyle}
            autoFocus
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(null) }}
            style={inputStyle}
          />

          {error && (
            <div style={{
              fontSize: 12, color: '#ef4444', background: '#fef2f2',
              padding: '8px 12px', borderRadius: 8, marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 10,
              border: 'none', background: '#3b82f6', color: '#fff',
              fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s',
            }}
          >
            {loading
              ? '처리 중...'
              : mode === 'login' ? '로그인' : '가입하기'}
          </button>
        </form>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 8,
  border: '1.5px solid #e0e0e0', fontSize: 13, marginBottom: 12,
  outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
}
