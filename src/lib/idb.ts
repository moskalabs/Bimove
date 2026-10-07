// IndexedDB 래퍼.
//
// localStorage 는 origin 당 5MB 로 못 박혀 있고 **동기** API 다. 수 MB 짜리
// CAD 스냅샷을 거기 넣으면 용량도 못 버티지만, 쓰는 동안 메인 스레드가 통째로
// 멈춘다. IndexedDB 는 디스크 여유의 상당 부분까지 쓸 수 있고 비동기다.
//
// 설계 원칙 두 가지:
//
//  1. **실패를 삼키지 않는다.** 쓰기는 성공 여부를 boolean 으로 돌려준다
//     (scopedStorage.scopedSet 과 같은 규약). 조용히 실패하면 호출부가
//     "저장됐다" 와 구분을 못 한다.
//  2. **IndexedDB 가 없거나 막혀도 앱이 죽지 않는다.** 사파리 사생활 보호
//     모드처럼 할당량이 0 인 환경이 실제로 있다. 그런 데서는 쓰기가 false 를
//     돌려주고, 호출부가 localStorage 로 돌아가면 된다.

import { scopedKey } from './scopedStorage'

const DB_NAME = 'bimova'

/** 스키마 버전. 스토어를 추가하면 올린다 (STORES 도 같이). */
const DB_VERSION = 2

/** 이 DB 가 가진 오브젝트 스토어 전부. onupgradeneeded 가 없는 것만 만든다.
 *
 *  versions  — 버전 히스토리 (메타 목록 + 스냅샷 본문)
 *  snapshots — 프로젝트 현재 도면 (projectId 하나당 레코드 하나) */
const STORES = ['versions', 'snapshots'] as const
export type IdbStore = (typeof STORES)[number]

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!idbAvailable()) { reject(new Error('IndexedDB 없음')); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
    }

    // 다른 탭이 옛 버전으로 DB 를 잡고 있으면 업그레이드가 여기서 **그냥 멈춘다**.
    // 에러도 안 나고 영원히 대기한다 — 알려주지 않으면 "저장이 안 되는데
    // 이유를 모르겠는" 상태가 된다. 한은 탭을 여러 개 띄우는 편이라 실제로 밟는다.
    req.onblocked = () => {
      console.warn('[idb] 다른 탭이 옛 버전 DB 를 잡고 있어 업그레이드가 대기 중이다. 다른 탭을 닫아주세요.')
    }

    req.onerror = () => reject(req.error ?? new Error('IndexedDB 열기 실패'))
    req.onsuccess = () => {
      const db = req.result
      // 다른 탭이 업그레이드를 시도하면 이쪽이 쥐고 있는 핸들을 놓아준다.
      // 안 놓으면 그 탭이 위의 onblocked 에 걸려 멈춘다.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
        console.warn('[idb] 다른 탭이 DB 를 업그레이드한다 — 이 탭의 연결을 닫았다')
      }
      resolve(db)
    }
  })
  // 실패한 Promise 를 캐시에 남겨두면 영원히 같은 에러만 돌려준다.
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

/** 트랜잭션 하나를 열어 fn 을 돌리고 **커밋까지** 기다린다.
 *
 *  oncomplete 를 기다리는 게 핵심이다. request.onsuccess 는 커밋 전에도
 *  불리기 때문에, 거기서 끝내면 디스크에 안 들어간 걸 "저장됐다"고 보고한다. */
function withStore<T>(
  store: IdbStore,
  mode: IDBTransactionMode,
  fn: (os: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const req = fn(tx.objectStore(store))
    let result: T
    req.onsuccess = () => { result = req.result as T }
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(tx.error ?? req.error ?? new Error('트랜잭션 중단'))
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('트랜잭션 실패'))
  }))
}

/** 값 읽기. 없거나 실패하면 undefined. */
export async function idbGet<T>(store: IdbStore, key: string): Promise<T | undefined> {
  try {
    return await withStore<T | undefined>(store, 'readonly', os => os.get(scopedKey(key)))
  } catch (err) {
    console.warn('[idb] 읽기 실패', store, key, err)
    return undefined
  }
}

/** 값 쓰기. 성공하면 true.
 *
 *  JSON 문자열이 아니라 객체를 그대로 넘겨도 된다 — structured clone 이라
 *  직렬화 왕복이 없다. 다만 함수/Symbol/DOM 노드는 못 넣는다 (DataCloneError). */
export async function idbSet(store: IdbStore, key: string, value: unknown): Promise<boolean> {
  try {
    await withStore(store, 'readwrite', os => os.put(value, scopedKey(key)))
    return true
  } catch (err) {
    console.warn('[idb] 쓰기 실패 (용량 초과?)', store, key, err)
    return false
  }
}

/** 값 삭제. 없는 키를 지워도 성공으로 친다. */
export async function idbDelete(store: IdbStore, key: string): Promise<boolean> {
  try {
    await withStore(store, 'readwrite', os => os.delete(scopedKey(key)))
    return true
  } catch (err) {
    console.warn('[idb] 삭제 실패', store, key, err)
    return false
  }
}

/** 스토어의 모든 키 (유저 스코프 접두사가 붙은 그대로). */
export async function idbKeys(store: IdbStore): Promise<string[]> {
  try {
    const keys = await withStore<IDBValidKey[]>(store, 'readonly', os => os.getAllKeys())
    return (keys ?? []).map(String)
  } catch (err) {
    console.warn('[idb] 키 목록 실패', store, err)
    return []
  }
}

/**
 * 브라우저에 "이 저장소는 지우지 마" 를 요청한다.
 *
 * 사파리 ITP 는 7일 안 쓴 IndexedDB 를 지운다. 크롬도 디스크가 부족하면
 * 정리 대상에 넣는다. 이 요청이 받아들여지면 그 대상에서 빠진다.
 * 거절돼도 (사파리는 잘 안 준다) 치명적이지 않다 — 원본은 서버에 있다.
 *
 * 한 번만 부르면 된다. 결과는 로그로만 남긴다.
 */
let persistRequested = false
export async function requestPersistentStorage(): Promise<boolean> {
  if (persistRequested) return false
  persistRequested = true
  try {
    if (!navigator.storage?.persist) return false
    const granted = await navigator.storage.persist()
    console.log(`[idb] 영구 저장소 ${granted ? '승인됨' : '거절됨 (브라우저가 공간 부족 시 지울 수 있음)'}`)
    return granted
  } catch {
    return false
  }
}

/** 테스트용 — 캐시된 연결을 **닫고** 버린다.
 *
 *  닫는 게 중요하다. 핸들을 열어둔 채로 deleteDatabase 를 부르면 onblocked
 *  에 걸려 영원히 기다린다 (실제 브라우저에서 다른 탭이 잡고 있을 때와 같다). */
export async function _resetIdbForTest() {
  const open = dbPromise
  dbPromise = null
  persistRequested = false
  try { (await open)?.close() } catch { /* 열리지도 않았다 */ }
}
