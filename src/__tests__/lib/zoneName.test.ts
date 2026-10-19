/**
 * 지정 중인 공간의 **기본 이름**.
 *
 * 한이 보낸 Rayon 화면에는 끄는 동안 "Zone 9 / 18.92 m²" 가 면 위에 떠 있다.
 * 이름이 있어야 "여기가 한 덩어리로 묶인다" 가 읽힌다 — 면적만 있으면 그냥
 * 숫자지 공간이 아니다.
 *
 * 우리는 완료 뒤 팝업에서 이름을 받으므로, **그리는 동안 보여준 이름과 팝업에
 * 채워지는 이름이 같아야** 한다. 양쪽이 이 함수를 같이 쓴다 — 여기가 어긋나면
 * 방금 본 "공간 3" 이 확인 누르는 순간 다른 이름이 된다.
 */
import { describe, it, expect } from 'vitest'
import { nextZoneName } from '../../lib/zoneName'

describe('nextZoneName', () => {
  it('처음엔 1번', () => {
    expect(nextZoneName([])).toBe('공간 1')
  })

  it('이어서 번호를 올린다', () => {
    expect(nextZoneName(['공간 1', '공간 2'])).toBe('공간 3')
  })

  it('가운데가 비어도 **제일 큰 번호 다음**으로 간다', () => {
    // 개수로 세면 "공간 3" 이 나와서 이미 있는 것과 겹친다.
    expect(nextZoneName(['공간 1', '공간 3'])).toBe('공간 4')
  })

  it('사람이 고쳐 쓴 이름은 번호에 안 섞는다', () => {
    expect(nextZoneName(['거실', '주방', '공간 2'])).toBe('공간 3')
    expect(nextZoneName(['거실', '주방'])).toBe('공간 1')
  })

  it('비슷하지만 다른 이름에 속지 않는다', () => {
    // "공간 2 창고" 는 사람이 쓴 이름이다. 번호로 치면 안 된다.
    expect(nextZoneName(['공간 2 창고', '공간2동'])).toBe('공간 1')
  })

  it('띄어쓰기와 앞뒤 공백은 봐준다', () => {
    expect(nextZoneName(['공간5'])).toBe('공간 6')
    expect(nextZoneName(['  공간 7  '])).toBe('공간 8')
  })

  it('빈 이름이 섞여도 터지지 않는다', () => {
    expect(nextZoneName(['', '미지정', '공간 1'])).toBe('공간 2')
  })
})
