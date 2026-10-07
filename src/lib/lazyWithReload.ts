import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/** 같은 탭에서 리로드를 반복하지 않도록 두는 쿨다운. */
const RELOAD_KEY = 'chunk-reload-at'
const RELOAD_COOLDOWN_MS = 10_000

function lastReloadAt(): number {
  try { return Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) } catch { return 0 }
}

function markReload(): void {
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* private mode 등 — 무시 */ }
}

/**
 * 배포가 갈리는 순간 열려 있던 탭을 살리는 lazy().
 *
 * 빌드마다 청크 파일명 해시가 바뀐다. 예전 index.js 를 들고 있는 탭이 그 시점에
 * 지연 로딩을 걸면, 가리키는 청크가 서버에 이미 없다. Vercel 은 없는 경로에
 * index.html 을 돌려주므로 브라우저가 "Expected a JavaScript module but got
 * text/html" 로 거부하고, 화면은 그대로 멈춘다 — 실제로 CAD 임포트 도중에
 * CadPreview 를 가져오다 터졌다.
 *
 * 청크를 못 가져오면 새 index.html 을 받도록 리로드한다. 단 **한 번만** —
 * 진짜로 청크가 깨진 배포라면 무한 새로고침이 되기 때문이다. 쿨다운 안에 또
 * 실패하면 에러를 그대로 올려서 ErrorBoundary 가 받게 둔다.
 */
export function lazyWithReload<T extends ComponentType<never>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((err: unknown) => {
      if (Date.now() - lastReloadAt() <= RELOAD_COOLDOWN_MS) throw err
      markReload()
      window.location.reload()
      // 리로드가 실제로 일어날 때까지 Suspense 를 붙잡아 둔다.
      // 여기서 resolve 하면 깨진 채로 한 프레임이 그려진다.
      return new Promise<{ default: T }>(() => {})
    }),
  )
}
