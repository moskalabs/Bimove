import { createContext, useContext } from 'react'

export const ProjectContext = createContext<string | null>(null)
export const useProjectId = () => useContext(ProjectContext)
