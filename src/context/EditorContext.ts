import { createContext, useContext } from 'react'
import type { Editor } from 'tldraw'

export const EditorContext = createContext<Editor | null>(null)

export function useEditor() {
  return useContext(EditorContext)
}
