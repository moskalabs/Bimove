export const isDesktop = (): boolean =>
  typeof window !== 'undefined' &&
  !!(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(cmd, args)
}

/** 연 파일. `path` 는 **보여주기용**이다 — 다시 넘기지 않는다. */
export type OpenedFile = { path: string; content: string }

/**
 * 도면 파일을 고르고 **그 자리에서 읽는다.** 취소하면 null.
 *
 * 경로를 받아 읽는 커맨드(`read_text_file`)가 있었는데 없앴다. 그러면 임의
 * 경로가 IPC 를 넘어서, 렌더러에 스크립트가 주입되면 사용자 PC 의 아무 파일이나
 * 읽을 수 있다 (src-tauri/src/lib.rs 주석 참고). 이제 **고르는 것도 읽는 것도
 * Rust 쪽**이고 여기서는 경로를 주지 않는다.
 */
export async function openProjectFile(): Promise<OpenedFile | null> {
  return invoke('open_project_file')
}

/** 저장할 자리를 고르고 **그 자리에 쓴다.** 취소하면 null (쓴 경로를 돌려준다). */
export async function saveProjectFile(
  defaultName: string, content: string,
): Promise<string | null> {
  return invoke('save_project_file', { defaultName, content })
}
