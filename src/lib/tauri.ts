export const isDesktop = (): boolean =>
  typeof window !== 'undefined' &&
  !!(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(cmd, args)
}

export async function readTextFile(path: string): Promise<string> {
  return invoke('read_text_file', { path })
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  return invoke('write_text_file', { path, content })
}

export async function openFileDialog(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    multiple: false,
    filters: filters ?? [],
  })
  return typeof result === 'string' ? result : null
}

export async function saveFileDialog(defaultPath?: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath })
}
