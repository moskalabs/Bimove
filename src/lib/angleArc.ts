/**
 * 코너의 **각도 쐐기**.
 *
 * 한이 "각도 원 느낌으로 어느 정도인지 파악되게 가이드" 라며 Rayon 화면을
 * 보냈다. 거기 있는 건 가는 호가 아니라 **옅게 채운 부채꼴**이다. 두 벽 사이를
 * 통째로 칠하니 넓은지 좁은지가 숫자를 안 봐도 읽힌다.
 *
 * 그래서 쐐기는 **두 벽 사이**(코너의 내각)를 채운다. 숫자도 같은 각이어야
 * 한다 — 쐐기는 120° 를 칠해 놓고 "60°" 라고 적으면 둘 다 못 믿게 된다.
 * 그 숫자는 `cornerAngleDeg` 가 낸다.
 *
 * 전부 **화면(viewport) 좌표**다. page→viewport 는 확대·이동뿐이라 방향의
 * 각도는 그대로다 — page 방향 벡터를 그냥 넣어도 된다.
 */

export type AngleArc = {
  /** 채울 부채꼴 (코너 → 호 → 코너). */
  d: string
  /** 숫자를 놓을 자리 — 쐐기 한가운데 바깥쪽. */
  labelX: number
  labelY: number
}

/**
 * 쐐기를 그리는 각의 범위(도). 벗어나면 `null`.
 *
 * 너무 좁으면 점으로 뭉개지고, 180° 에 가까우면 **곧게 이어가는 것**이라
 * 반원을 칠하게 된다 — 꺾지도 않았는데 화면 절반이 파래진다.
 */
const MIN_DEG = 3
const MAX_DEG = 177

/**
 * @param cx,cy       코너
 * @param fromX,fromY 앞 벽이 **뻗어 있는 쪽** (코너에서 바깥으로)
 * @param toX,toY     지금 긋는 쪽 (코너에서 바깥으로)
 * @param radius      반지름 (화면 px)
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
  // (-π, π] 로 접는다. 접지 않으면 10° 벌어진 것이 350° 부채꼴이 된다.
  let delta = a1 - a0
  delta = ((delta % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI
  const deg = Math.abs(delta) * 180 / Math.PI
  if (deg < MIN_DEG || deg > MAX_DEG) return null

  const at = (ang: number, r: number) =>
    `${(cx + Math.cos(ang) * r).toFixed(2)} ${(cy + Math.sin(ang) * r).toFixed(2)}`
  // 늘 **짧은 쪽**으로 돈다 (large-arc-flag = 0). 내각은 180° 를 안 넘으므로
  // 그게 늘 맞다. 화면 좌표는 y 가 아래로 가서 sweep=1 이 각이 커지는 쪽이다.
  const d = `M${cx.toFixed(2)} ${cy.toFixed(2)} L${at(a0, radius)}`
    + ` A${radius} ${radius} 0 0 ${delta > 0 ? 1 : 0} ${at(a1, radius)} Z`

  const mid = a0 + delta / 2
  return {
    d,
    labelX: cx + Math.cos(mid) * (radius + 16),
    labelY: cy + Math.sin(mid) * (radius + 16),
  }
}
