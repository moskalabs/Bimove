import '@testing-library/jest-dom'
// jsdom 에는 IndexedDB 가 없다. 메모리 가짜로 때우지 않고 진짜 구현을 돌린다 —
// 정작 틀리기 쉬운 부분(트랜잭션 커밋 타이밍)을 가짜는 못 잡는다.
import 'fake-indexeddb/auto'
import { beforeEach } from 'vitest'
import { _resetIdbForTest } from '../lib/idb'

// localStorage mock
const localStorageStore: Record<string, string> = {}

const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value },
  removeItem: (key: string) => { delete localStorageStore[key] },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]) },
  get length() { return Object.keys(localStorageStore).length },
  key: (i: number) => Object.keys(localStorageStore)[i] ?? null,
}

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

beforeEach(async () => {
  localStorageMock.clear()
  // fake-indexeddb 는 테스트 사이에 DB 가 그대로 남는다 — 통째로 지운다.
  // 먼저 연결을 닫아야 한다. 안 닫으면 deleteDatabase 가 onblocked 다.
  await _resetIdbForTest()
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase('bimova')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => {
      console.warn('[test] IndexedDB 삭제가 막혔다 — 앞 테스트가 연결을 쥐고 있다')
      resolve()
    }
  })
})
