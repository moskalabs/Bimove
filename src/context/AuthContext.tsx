// Supabase Auth 상태 관리
import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { setCurrentUserId } from '../lib/scopedStorage'

type AuthState = {
  user: User | null
  session: Session | null
  loading: boolean
  sessionExpired: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string, displayName?: string) => Promise<string | null>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<string | null>
  updatePassword: (newPassword: string) => Promise<string | null>
  updateDisplayName: (name: string) => Promise<string | null>
  dismissSessionExpired: () => void
}

const AuthContext = createContext<AuthState>({
  user: null, session: null, loading: true, sessionExpired: false,
  signIn: async () => null,
  signUp: async () => null,
  signOut: async () => {},
  resetPassword: async () => null,
  updatePassword: async () => null,
  updateDisplayName: async () => null,
  dismissSessionExpired: () => {},
})

export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)
  /** 직전 사용자 id. 콜백이 state 를 붙들지 않게 ref 로 둔다. */
  const lastUserIdRef = useRef<string | null>(null)
  /** 사용자가 직접 로그아웃하는 중인지 — 그건 '만료' 가 아니다. */
  const signingOutRef = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      lastUserIdRef.current = s?.user?.id ?? null
      setCurrentUserId(s?.user?.id ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // **ref 로 본다.** 이 콜백은 deps [] 인 effect 안에서 한 번만 만들어지므로
      // state 를 읽으면 첫 렌더의 null 을 영원히 붙들고 있다. 그래서 "전에
      // 로그인 상태였나" 가 늘 false 였고 — 세션 만료가 **한 번도 안 잡혔다.**
      const prevUserId = lastUserIdRef.current
      const nextUserId = s?.user?.id ?? null
      lastUserIdRef.current = nextUserId

      // 세션이 끊긴 건지(만료) 사용자가 나간 건지 가른다.
      const expired =
        !!prevUserId && !s &&
        (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') &&
        !signingOutRef.current

      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)

      // 만료일 때는 **사용자 스코프를 놓지 않는다.** 여기서 null 로 돌리면
      // 저장 키가 `u:<id>:…` 에서 글로벌로 바뀌어, 배너를 띄운 채 이어서 한
      // 작업이 엉뚱한 자리에 저장된다 (다시 로그인하면 사라진 것처럼 보인다).
      if (!expired) setCurrentUserId(nextUserId)

      if (expired) setSessionExpired(true)
    })

    // 이제 이 effect 는 state 를 읽지 않는다 (ref 로 본다) — 그래서
    // exhaustive-deps 억제가 필요 없다. 다시 state 를 읽기 시작하면 lint 가
    // 바로 잡아준다.
    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error) setSessionExpired(false)
    return error ? error.message : null
  }

  const signUp = async (email: string, password: string, displayName?: string): Promise<string | null> => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName ?? email.split('@')[0] } },
    })
    return error ? error.message : null
  }

  const signOut = async () => {
    // 스스로 나가는 건 '만료' 가 아니다. 플래그로 알려주고, 끝나면 되돌린다.
    signingOutRef.current = true
    setSessionExpired(false)
    try {
      await supabase.auth.signOut()
    } finally {
      signingOutRef.current = false
      setCurrentUserId(null)
    }
  }

  const resetPassword = async (email: string): Promise<string | null> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/?type=recovery',
    })
    return error ? error.message : null
  }

  const updatePassword = async (newPassword: string): Promise<string | null> => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    return error ? error.message : null
  }

  const updateDisplayName = async (name: string): Promise<string | null> => {
    const { error } = await supabase.auth.updateUser({
      data: { display_name: name },
    })
    if (!error) {
      // 로컬 user 객체도 갱신
      const { data } = await supabase.auth.getUser()
      if (data.user) setUser(data.user)
    }
    return error ? error.message : null
  }

  const dismissSessionExpired = useCallback(() => setSessionExpired(false), [])

  return (
    <AuthContext.Provider value={{
      user, session, loading, sessionExpired,
      signIn, signUp, signOut,
      resetPassword, updatePassword, updateDisplayName,
      dismissSessionExpired,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
