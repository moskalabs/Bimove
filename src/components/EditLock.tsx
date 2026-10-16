import type { ReactNode } from 'react'
import { useReadonly } from '../context/ReadonlyContext'

/**
 * 읽기 전용이면 안쪽 입력을 통째로 잠근다.
 *
 * `fieldset[disabled]` 은 안에 있는 input·select·textarea·button 을 **브라우저가
 * 직접** 막는다. 클래스 이름을 짚어 CSS 로 가리는 것보다 안전하다 — 새 입력이
 * 생겨도 따로 챙길 게 없다.
 *
 * 패널의 접기/펼치기와 항목 고르기는 button 이 아니라 `div onClick` 이라 그대로
 * 산다. 글자 선택·복사도 막히지 않는다 (그래서 `inert` 대신 fieldset 이다 —
 * inert 는 안쪽 글자를 집지도 못하게 한다).
 */
export function EditLock({ children }: { children: ReactNode }) {
  const readonly = useReadonly()
  if (!readonly) return <>{children}</>
  return <fieldset className="edit-lock" disabled>{children}</fieldset>
}
