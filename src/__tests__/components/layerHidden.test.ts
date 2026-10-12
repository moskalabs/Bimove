/**
 * 꺼짐/동결 레이어 회귀 테스트
 *
 * 증상: AutoCAD 에서 꺼둔 레이어의 도형이 Bimove 에선 그대로 보였다.
 * 평면도 위에 거대한 회색 원들이 덮여 있던 게 그 모습이다.
 *
 * 원인: 레이어 테이블을 읽을 때 `Math.abs(parseInt(gc62))` 로 색만 뽑고
 * **부호를 버렸다**. DXF 는 레이어 끄기를 gc 62 의 음수로, 동결을 gc 70 의
 * bit 0 으로 표현한다. 둘 다 안 보던 상태라 원본에서 숨겨둔 도형이 전부
 * 켜진 채로 쏟아졌다.
 */
import { describe, it, expect } from 'vitest'
import { extractLayersLightweight } from '../../components/CadPreview'
import { aciToHex } from '../../lib/dxf-shared'

/** Pad group code to 3 chars (standard DXF convention) */
const g = (c: number) => String(c).padStart(3)

/** LAYER 테이블 엔트리. `aci` 음수 = 꺼짐, `flags` bit 0 = 동결. */
function layerEntry(name: string, aci: number, flags = 0): string {
  return `${g(0)}\nLAYER\n${g(2)}\n${name}\n${g(70)}\n${flags}\n${g(62)}\n${aci}\n${g(6)}\nCONTINUOUS\n`
}

/** 레이어마다 선 한 개씩 — 엔티티가 0개인 레이어는 목록에서 빠진다. */
function entityLine(layer: string, y: number): string {
  return `${g(0)}\nLINE\n${g(8)}\n${layer}\n` +
    `${g(10)}\n0\n${g(20)}\n${y}\n${g(30)}\n0\n${g(11)}\n100\n${g(21)}\n${y}\n${g(31)}\n0\n`
}

/**
 * 켜진 레이어 1개 + 꺼진 레이어 1개 + 동결된 레이어 1개.
 *
 * 이름에 구조 키워드(벽/기둥 등)를 쓰지 않는다 — likelyStructural 이 걸리면
 * 기본 선택 규칙이 달라져서 여기서 보려는 걸 가린다.
 */
const DXF =
  `${g(0)}\nSECTION\n${g(2)}\nHEADER\n${g(9)}\n$INSUNITS\n${g(70)}\n4\n${g(0)}\nENDSEC\n` +
  `${g(0)}\nSECTION\n${g(2)}\nTABLES\n` +
  layerEntry('보임', 7) +
  layerEntry('꺼진것', -3) +
  layerEntry('얼린것', 5, 1) +
  `${g(0)}\nENDSEC\n` +
  `${g(0)}\nSECTION\n${g(2)}\nENTITIES\n` +
  entityLine('보임', 0) +
  entityLine('꺼진것', 10) +
  entityLine('얼린것', 20) +
  `${g(0)}\nENDSEC\n` +
  `${g(0)}\nEOF\n`

const byName = (name: string) => extractLayersLightweight(DXF).find(l => l.name === name)

describe('꺼짐/동결 레이어', () => {
  it('세 레이어 모두 목록에는 남는다 (직접 켤 수 있어야 한다)', () => {
    const names = extractLayersLightweight(DXF).map(l => l.name).sort()
    expect(names).toEqual(['꺼진것', '보임', '얼린것'])
  })

  it('gc 62 가 음수면 꺼짐으로 표시한다', () => {
    expect(byName('꺼진것')?.hidden).toBe('꺼짐')
  })

  it('gc 70 bit 0 이 서 있으면 동결로 표시한다', () => {
    expect(byName('얼린것')?.hidden).toBe('동결')
  })

  it('보이는 레이어엔 표시가 없다', () => {
    expect(byName('보임')?.hidden).toBeUndefined()
  })

  it('꺼진 레이어도 색은 절대값으로 읽는다', () => {
    // 부호는 표시 여부일 뿐이다 — 색까지 날리면 켰을 때 엉뚱한 색이 된다.
    expect(byName('꺼진것')?.color).toBe(aciToHex(3))
  })
})
