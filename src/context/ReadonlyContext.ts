import { createContext, useContext } from 'react'

/**
 * 지금 화면이 읽기 전용인지. App 이 창 크기를 보고 정해 내려준다
 * (lib/readonlyMode.ts 의 판정 기준 참고).
 *
 * 기본값 false — Provider 밖에서 쓰이는 컴포넌트는 편집 가능으로 본다.
 */
export const ReadonlyContext = createContext(false)

/** 편집 UI 를 감출지 묻는 훅. */
export function useReadonly(): boolean {
  return useContext(ReadonlyContext)
}
