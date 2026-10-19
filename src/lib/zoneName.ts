/**
 * 지정 중인 공간의 **기본 이름**.
 *
 * 한이 보낸 Rayon 화면에는 끄는 동안 "Zone 9 / 18.92 m²" 가 면 위에 떠 있다.
 * 이름이 있어야 "여기가 한 덩어리로 묶인다" 가 읽힌다 — 면적만 있으면 그냥
 * 숫자지 공간이 아니다.
 *
 * 우리는 완료 뒤 팝업에서 이름을 받는다. 그리는 동안 보여준 이름과 팝업에
 * 채워지는 이름이 **같아야** 한다 — 다르면 방금 본 게 뭐였는지 헷갈린다.
 * 그래서 양쪽이 이 함수를 같이 쓴다.
 */

/** 이미 있는 공간 이름들로 다음 번호를 고른다. */
export function nextZoneName(existing: readonly string[]): string {
  // 사람이 고쳐 쓴 이름("거실")은 번호에 안 섞는다. "공간 N" 꼴만 센다.
  let max = 0
  for (const name of existing) {
    const m = /^공간\s*(\d+)$/.exec(name.trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `공간 ${max + 1}`
}
