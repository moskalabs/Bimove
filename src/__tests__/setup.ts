import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'

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

beforeEach(() => {
  localStorageMock.clear()
})
