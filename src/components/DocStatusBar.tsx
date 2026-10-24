// "이 도면, 지금 어디까지 됐나" 한 줄.
//
// 폰에서 보고 싶은 게 편집이 아니라 현황이라서 만든 것이다 (docStatus.ts
// 머리말). 값은 전부 저장본에서 나오고 에디터를 쓰지 않는다.
//
// **빈 칸을 숨기지 않는다.** "공간 0개" 와 "공간 칸이 없다" 는 다른 말이다 —
// 앞은 아직 안 그렸다는 뜻이고 뒤는 못 읽었다는 뜻인데, 숨기면 구분이 안
// 간다. 다만 **장이 하나뿐이면 장 칸은 뺀다** (늘 "1/1" 이라 읽을 게 없다).

import type { DocStatus } from '../lib/docStatus'

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'open' | 'done' }) {
  return (
    <div className={`docstat-cell${tone ? ` ${tone}` : ''}`}>
      <span className="docstat-value">{value}</span>
      <span className="docstat-label">{label}</span>
    </div>
  )
}

export function DocStatusBar({ status }: { status: DocStatus }) {
  const s = status
  // ── 차례가 중요하다 ──
  //
  // 폰(360px)에는 예닐곱 칸밖에 안 들어가고 나머지는 밀어야 보인다. 처음에
  // 도형 개수를 앞에 뒀더니 **'열린 코멘트' 가 화면 밖으로 밀려났다** —
  // 하필 "어디까지 했나" 에 가장 곧게 답하는 값이다. 남은 일 → 진행률 →
  // 규모 → 그려진 양 순으로 놓는다. 밀려나도 되는 것만 뒤에 있다.
  return (
    <div className="docstat">
      {/* 코멘트는 **둘로 갈라서** 보여준다. 합쳐 "11개" 라고 하면 남은 일이
          있는지를 알 수가 없다 — 그게 이 줄에서 가장 묻고 싶은 것이다. */}
      <Cell label="열린 코멘트" value={`${s.commentsOpen}`} tone={s.commentsOpen > 0 ? 'open' : undefined} />
      {s.commentsResolved > 0 && (
        <Cell label="해결" value={`${s.commentsResolved}`} tone="done" />
      )}
      {s.finishingZones > 0 && (
        <Cell label="마감재" value={`${s.finishedZones}/${s.finishingZones}`} />
      )}
      <Cell label="공간" value={`${s.zoneCount}`} />
      {/* 면적은 숫자가 길어지므로 소수 한 자리까지만. 정확한 값은 물량
          화면에 있다 — 여기는 "대충 얼마나" 를 답하는 자리다. */}
      <Cell label="바닥 m²" value={s.floorAreaM2.toFixed(1)} />
      <Cell label="벽" value={`${s.wallCount}`} />
      <Cell label="문·창" value={`${s.openingCount}`} />
      <Cell label="치수" value={`${s.dimCount}`} />
      {s.boqCount > 0 && <Cell label="물량표" value={`${s.boqCount}`} />}
      {s.pageCount > 1 && <Cell label="장" value={`${s.pageCount}`} />}
    </div>
  )
}
