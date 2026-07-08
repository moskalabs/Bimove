// 온라인/오프라인 감지 + Supabase 안전 호출 래퍼
import { supabase } from './supabase'

let _online = navigator.onLine
const listeners = new Set<(online: boolean) => void>()

window.addEventListener('online', () => { _online = true; listeners.forEach(fn => fn(true)) })
window.addEventListener('offline', () => { _online = false; listeners.forEach(fn => fn(false)) })

export function isOnline(): boolean { return _online }

export function onStatusChange(fn: (online: boolean) => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * Supabase 호출을 안전하게 래핑. 오프라인이거나 에러 시 null 반환.
 * onError 콜백으로 토스트 알림 연결.
 */
export async function safeFetch<T>(
  fn: () => Promise<{ data: T | null; error: unknown }>,
  onError?: (msg: string) => void,
): Promise<T | null> {
  if (!_online) {
    onError?.('오프라인 상태입니다. 로컬 데이터를 사용합니다.')
    return null
  }
  try {
    const { data, error } = await fn()
    if (error) {
      const msg = (error as { message?: string })?.message ?? '서버 오류'
      console.warn('[supabase]', msg)
      onError?.(`동기화 실패: ${msg}`)
      return null
    }
    return data
  } catch (err) {
    console.warn('[supabase]', err)
    onError?.('서버 연결에 실패했습니다.')
    return null
  }
}

/** fire-and-forget 방식. 실패해도 OK (로컬에 이미 저장된 경우) */
export async function safeSync(
  fn: () => Promise<unknown>,
  onError?: (msg: string) => void,
): Promise<boolean> {
  if (!_online) return false
  try {
    await fn()
    return true
  } catch (err) {
    console.warn('[supabase-sync]', err)
    onError?.('동기화에 실패했습니다. 나중에 다시 시도합니다.')
    return false
  }
}
