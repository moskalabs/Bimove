import { createContext, useContext } from 'react'

export const ProjectContext = createContext<string | null>(null)
export const useProjectId = () => useContext(ProjectContext)

/**
 * 프로젝트 이름.
 *
 * 오른쪽 패널의 "파일명" 칸이 이걸 보여주고, 도면을 가져오면 그 파일명으로
 * 바뀐다. id 와 달리 도중에 바뀌는 값이라 setter 를 같이 들고 다닌다.
 * 예전엔 RBar 가 localStorage 목록에서 직접 찾아 읽었는데, 대시보드(서버)에서
 * 연 프로젝트는 그 목록에 없어서 늘 "새 프로젝트" 로 보였다.
 */
export type ProjectNameValue = {
  name: string
  /** 화면에 즉시 반영하고, 저장은 디바운스해서 로컬+서버에 함께 쓴다. */
  setName: (name: string) => void
}

export const ProjectNameContext = createContext<ProjectNameValue>({
  name: '',
  setName: () => {},
})
export const useProjectName = () => useContext(ProjectNameContext)
