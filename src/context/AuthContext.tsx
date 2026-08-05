// Supabase Auth 상태 관리
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      setCurrentUserId(s?.user?.id ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      const prevUser = user
      setSession(s)
      setUser(s?.user ?? null)
      setCurrentUserId(s?.user?.id ?? null)
      setLoading(false)

      // 세션 만료 감지: 이전에 로그인 상태였는데 세션이 사라진 경우
      if (event === 'SIGNED_OUT' && prevUser && !s) {
        setSessionExpired(true)
      }
      // TOKEN_REFRESHED 실패 시 세션 null
      if (event === 'TOKEN_REFRESHED' && !s && prevUser) {
        setSessionExpired(true)
      }
    })

    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setSessionExpired(false)
    await supabase.auth.signOut()
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
