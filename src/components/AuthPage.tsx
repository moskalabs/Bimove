// 로그인/회원가입/비밀번호 찾기 페이지
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

/** 비밀번호 강도 검증 (8자 이상, 영문+숫자+특수문자 포함) */
function validatePassword(pw: string): string | null {
  if (pw.length < 8) return '비밀번호는 8자 이상이어야 합니다'
  if (!/[A-Za-z]/.test(pw)) return '영문자를 포함해주세요'
  if (!/[0-9]/.test(pw)) return '숫자를 포함해주세요'
  if (!/[^A-Za-z0-9]/.test(pw)) return '특수문자를 포함해주세요 (!@#$%...)'
  return null
}

type AuthMode = 'login' | 'signup' | 'reset'

export function AuthPage() {
  const { signIn, signUp, resetPassword } = useAuth()
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // URL에 type=recovery가 있으면 비밀번호 재설정 콜백 (Supabase가 세션을 자동 복원)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('type') === 'recovery') {
      // Supabase가 세션을 복원하면 onAuthStateChange가 처리
      // URL 정리
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)

    if (mode === 'reset') {
      if (!email.trim()) { setError('이메일을 입력해주세요'); return }
      setLoading(true)
      const err = await resetPassword(email.trim())
      setLoading(false)
      if (err) { setError(err); return }
      setInfo('비밀번호 재설정 링크를 이메일로 보냈습니다. 메일함을 확인해주세요.')
      return
    }

    if (!email.trim() || !password.trim()) {
      setError('이메일과 비밀번호를 입력해주세요')
      return
    }

    if (mode === 'signup') {
      const pwErr = validatePassword(password)
      if (pwErr) { setError(pwErr); return }
    } else if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다')
      return
    }

    setLoading(true)

    const err = mode === 'login'
      ? await signIn(email, password)
      : await signUp(email, password, displayName || undefined)

    if (err) {
      setError(err)
      setLoading(false)
    } else if (mode === 'signup') {
      setInfo('가입 완료! 이메일 인증 링크를 확인해주세요.')
      setLoading(false)
    }
  }

  const switchMode = (m: AuthMode) => {
    setMode(m)
    setError(null)
    setInfo(null)
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

        {mode === 'reset' ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 16 }}>
              비밀번호 찾기
            </div>
            <form onSubmit={handleSubmit}>
              <input
                type="email"
                placeholder="가입한 이메일"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null) }}
                style={inputStyle}
                autoFocus
              />
              {error && <div style={errorStyle}>{error}</div>}
              {info && <div style={infoStyle}>{info}</div>}
              <button type="submit" disabled={loading} style={btnStyle(loading)}>
                {loading ? '전송 중...' : '재설정 링크 보내기'}
              </button>
            </form>
            <button
              onClick={() => switchMode('login')}
              style={linkBtnStyle}
            >
              ← 로그인으로 돌아가기
            </button>
          </>
        ) : (
          <>
            {/* tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1.5px solid #eee' }}>
              {(['login', 'signup'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
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
                placeholder={mode === 'signup' ? '비밀번호 (8자 이상, 영문+숫자+특수문자)' : '비밀번호'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null) }}
                style={inputStyle}
              />

              {error && <div style={errorStyle}>{error}</div>}
              {info && <div style={infoStyle}>{info}</div>}

              <button type="submit" disabled={loading} style={btnStyle(loading)}>
                {loading
                  ? '처리 중...'
                  : mode === 'login' ? '로그인' : '가입하기'}
              </button>
            </form>

            {mode === 'login' && (
              <button
                onClick={() => switchMode('reset')}
                style={linkBtnStyle}
              >
                비밀번호를 잊으셨나요?
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 8,
  border: '1.5px solid #e0e0e0', fontSize: 13, marginBottom: 12,
  outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
}

const errorStyle: React.CSSProperties = {
  fontSize: 12, color: '#ef4444', background: '#fef2f2',
  padding: '8px 12px', borderRadius: 8, marginBottom: 12,
}

const infoStyle: React.CSSProperties = {
  fontSize: 12, color: '#2563eb', background: '#eff6ff',
  padding: '8px 12px', borderRadius: 8, marginBottom: 12,
}

function btnStyle(loading: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '12px 0', borderRadius: 10,
    border: 'none', background: '#3b82f6', color: '#fff',
    fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s',
  }
}

const linkBtnStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 12, padding: '8px 0',
  border: 'none', background: 'none', color: '#3b82f6',
  fontSize: 12, cursor: 'pointer', textAlign: 'center',
}
