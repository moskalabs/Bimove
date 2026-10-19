/**
 * 코너에 그리는 **각도 호**.
 *
 * 한이 "각도 부분 파란색으로 각도 원 느낌으로 어느 정도인지 파악되게 가이드"
 * 라고 했다. 숫자만 있으면 "60.0°" 가 얼마나 벌어진 건지 머리로 그려야 한다.
 * 호를 그려 주면 눈이 바로 읽는다 — CAD 가 다 하는 것이고, 각도가 작을수록
 * 호도 작아지니 숫자를 안 봐도 대충 안다.
 *
 * 같이 그리는 **점선 연장선**이 기준이다. 앞 벽이 그대로 뻗었다면 어디로
 * 갔을지를 보여주므로, 호는 "거기서 이만큼 꺾었다" 가 된다.
 *
 * 전부 **화면(viewport) 좌표**다. page→viewport 는 확대·이동뿐이라 방향의
 * 각도는 그대로다 — 그래서 page 방향 벡터를 그냥 넣어도 된다.
 */

export type AngleArc = {
  /** 호 자체 */
  d: string
  /** 앞 구간이 뻗어 온 쪽을 가리키는 **점선 다리**. 기준선이다. */
  legD: string
  /** 숫자를 놓을 자리 — 호 한가운데 바깥쪽. */
  labelX: number
  labelY: number
}

/** 이보다 덜 꺾였으면 호를 안 그린다. 그려 봐야 점으로 뭉개진다. */
const MIN_DEG = 1.5

/**
 * @param cx,cy     코너
 * @param fromX,fromY 앞 구간이 **뻗어 있는 쪽** (코너에서 바깥으로)
 * @param toX,toY   지금 긋는 쪽 (코너에서 바깥으로)
 * @param radius    호의 반지름 (화면 px)
 */
export function angleArc(
  cx: number, cy: number,
  fromX: number, fromY: number,
  toX: number, toY: number,
  radius: number,
): AngleArc | null {
  if (!(radius > 0)) return null
  if (Math.hypot(fromX, fromY) < 1e-9 || Math.hypot(toX, toY) < 1e-9) return null

  const a0 = Math.atan2(fromY, fromX)
  const a1 = Math.atan2(toY, toX)
  // (-π, π] 로 접는다. 접지 않으면 10° 꺾은 것이 350° 호로 그려진다.
  let delta = a1 - a0
  delta = ((delta % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI
  if (Math.abs(delta) * 180 / Math.PI < MIN_DEG) return null

  const at = (ang: number, r: number) => `${(cx + Math.cos(ang) * r).toFixed(2)} ${(cy + Math.sin(ang) * r).toFixed(2)}`
  // 늘 **짧은 쪽**으로 돈다 (large-arc-flag = 0). 화면 좌표는 y 가 아래로
  // 가므로 sweep-flag 1 이 각이 커지는 방향이다.
  const d = `M${at(a0, radius)} A${radius} ${radius} 0 0 ${delta > 0 ? 1 : 0} ${at(a1, radius)}`
  const legD = `M${cx.toFixed(2)} ${cy.toFixed(2)} L${at(a0, radius * 1.45)}`

  const mid = a0 + delta / 2
  return {
    d,
    legD,
    labelX: cx + Math.cos(mid) * (radius + 18),
    labelY: cy + Math.sin(mid) * (radius + 18),
  }
}
