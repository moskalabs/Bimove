/**
 * 가져올 파일 크기 판정.
 *
 * 세 경로가 전부 크기를 보지 않고 파일을 통째로 읽고 있었다. 너무 큰 걸 던지면
 * 브라우저가 OOM 으로 탭을 죽인다 — 에러도 없고 try/catch 에도 안 걸린다.
 *
 * 'block'(거절) 과 'confirm'(묻고 진행) 을 가르는 게 이 모듈의 핵심이다.
 * 둘이 섞이면 둘 중 하나가 고장난다 — 열리는 도면을 막거나, 탭을 죽인다.
 */
import { describe, it, expect } from 'vitest'
import {
  checkCadSize, checkConvertedDxfSize, checkPdfSize, checkImageSize,
  formatMB, estimatedDwgPeakMB,
  SAFE_DWG_BYTES, MAX_DWG_BYTES, SAFE_DXF_BYTES, MAX_DXF_BYTES,
  MAX_PDF_BYTES, MAX_IMAGE_BYTES,
} from '../../lib/importLimits'

const MB = 1024 * 1024
const kindOf = (fileName: string, bytes: number) => checkCadSize(fileName, bytes).kind

describe('checkCadSize: DWG', () => {
  it('한의 실제 도면은 묻지도 않고 통과한다 (10.28MB)', () => {
    // 상한을 이 위로 잡은 이유가 이것이다. 쓰던 파일이 막히거나 매번 물으면
    // 그게 고장이다.
    expect(kindOf('26.08.07_리닝.dwg', 10.28 * MB)).toBe('ok')
  })

  it('안전선까지 통과, 넘으면 묻고, 최대선 넘으면 거절', () => {
    expect(kindOf('a.dwg', SAFE_DWG_BYTES)).toBe('ok')
    expect(kindOf('a.dwg', SAFE_DWG_BYTES + 1)).toBe('confirm')
    expect(kindOf('a.dwg', MAX_DWG_BYTES)).toBe('confirm')
    expect(kindOf('a.dwg', MAX_DWG_BYTES + 1)).toBe('block')
  })

  it('한이 요구한 50MB 는 거절하지 않는다 — 묻고 진행한다', () => {
    // "50MB 까지는 서비스로 제공해야 한다" 가 요구사항이다. 재보니 50MB DWG 는
    // 2GB 넘게 쓰므로 그냥 통과시킬 수는 없지만, **막지도 않는다.**
    expect(kindOf('big.dwg', 50 * MB)).toBe('confirm')
  })

  it('묻는 말에 쓸 메모리 어림값이 들어간다', () => {
    // "큽니다" 는 판단에 쓸 수 없다. 숫자가 있어야 고를 수 있다.
    const v = checkCadSize('big.dwg', 40 * MB)
    expect(v.kind).toBe('confirm')
    if (v.kind !== 'confirm') return
    expect(v.message).toContain('40.0MB')
    expect(v.message).toMatch(/1\.[0-9]GB/)      // 70 + 40×42 = 1750MB → 1.7GB
    expect(v.message).toContain('DXF')            // 대안 안내
  })

  it('확장자 대소문자를 가리지 않는다', () => {
    // 윈도우에서 .DWG 로 저장된 파일이 흔하다. 놓치면 DWG 가 훨씬 느슨한
    // DXF 기준으로 통과해서, 막으려던 지점을 그냥 지난다.
    const over = MAX_DWG_BYTES + MB
    expect(kindOf('A.DWG', over)).toBe('block')
    expect(kindOf('A.Dwg', over)).toBe('block')
  })
})

describe('checkCadSize: DXF', () => {
  it('한의 도면이 만드는 45MB DXF 는 통과한다', () => {
    expect(kindOf('a.dxf', 45.2 * MB)).toBe('ok')
  })

  it('50MB DXF 는 묻지도 않고 통과한다 — 변환 wasm 이 없어서 싸다', () => {
    expect(kindOf('a.dxf', 50 * MB)).toBe('ok')
  })

  it('안전선 / 최대선', () => {
    expect(kindOf('a.dxf', SAFE_DXF_BYTES)).toBe('ok')
    expect(kindOf('a.dxf', SAFE_DXF_BYTES + 1)).toBe('confirm')
    expect(kindOf('a.dxf', MAX_DXF_BYTES + 1)).toBe('block')
  })

  it('같은 크기라도 DWG 가 DXF 보다 엄하다', () => {
    // 변환 wasm 이 DWG 1MB 당 25.8MB 를 쓴다. 이 순서가 뒤집히면
    // 숫자를 어디선가 잘못 바꾼 것이다.
    expect(SAFE_DWG_BYTES).toBeLessThan(SAFE_DXF_BYTES)
    expect(MAX_DWG_BYTES).toBeLessThan(MAX_DXF_BYTES)
  })
})

describe('checkConvertedDxfSize', () => {
  it('한의 도면이 만드는 45.2MB DXF 는 통과한다', () => {
    expect(checkConvertedDxfSize(45.2 * MB).kind).toBe('ok')
  })

  it('DXF 최대선을 넘으면 거절한다', () => {
    expect(checkConvertedDxfSize(MAX_DXF_BYTES).kind).toBe('ok')
    expect(checkConvertedDxfSize(MAX_DXF_BYTES + 1).kind).toBe('block')
  })

  it('여기선 묻지 않는다 — 사용자는 파일 크기를 보고 이미 한 번 골랐다', () => {
    for (const n of [1, 100 * MB, MAX_DXF_BYTES, 999 * MB]) {
      expect(checkConvertedDxfSize(n).kind).not.toBe('confirm')
    }
  })

  it('평범한 팽창률이면 통과시킨다 — 사용자가 이미 확인했다', () => {
    // 실측 4.40배 (10.28MB → 45.2MB). 최대 DWG 50MB 가 그 비율로 부풀면
    // 220MB 인데, 그 사용자는 파일 크기 단계에서 "약 2.1GB 쓴다" 를 보고
    // 이미 계속하기를 골랐다. 여기서 또 막으면 그 선택을 무르는 것이다.
    expect(checkConvertedDxfSize(MAX_DWG_BYTES * 4.4).kind).toBe('ok')
  })

  it('비정상적으로 부푼 경우에 걸린다 — 이 검사의 존재 이유', () => {
    // 팽창률은 블록을 얼마나 펼치는지에 달려 예측이 안 된다. 통과한 DWG 가
    // 8배로 부풀면 사용자가 보고 고른 어림값과 완전히 다른 일이 벌어진다.
    expect(checkConvertedDxfSize(40 * MB * 8).kind).toBe('block')
  })
})

describe('estimatedDwgPeakMB', () => {
  it('실측값과 맞는다 — 10.28MB DWG 피크 502MB', () => {
    // node 에서 실제 파이프라인을 돌려 RSS 로 잰 값이다. 이 계수를 누가
    // 고치면 여기서 걸린다.
    expect(estimatedDwgPeakMB(10.28 * MB)).toBeCloseTo(502, 0)
  })

  it('클수록 커진다', () => {
    expect(estimatedDwgPeakMB(50 * MB)).toBeGreaterThan(estimatedDwgPeakMB(30 * MB))
  })

  it('50MB DWG 는 2GB 를 넘는다 — 그냥 통과시킬 수 없는 근거', () => {
    expect(estimatedDwgPeakMB(50 * MB)).toBeGreaterThan(2048)
  })
})

describe('checkPdfSize / checkImageSize', () => {
  it('경계에서 가른다 (한 단계뿐 — 묻지 않는다)', () => {
    expect(checkPdfSize(MAX_PDF_BYTES).kind).toBe('ok')
    expect(checkPdfSize(MAX_PDF_BYTES + 1).kind).toBe('block')
    expect(checkImageSize(MAX_IMAGE_BYTES).kind).toBe('ok')
    expect(checkImageSize(MAX_IMAGE_BYTES + 1).kind).toBe('block')
  })

  it('이미지 상한이 가장 낮다 — 스냅샷에 영구 저장되기 때문', () => {
    expect(MAX_IMAGE_BYTES).toBeLessThan(MAX_PDF_BYTES)
    expect(MAX_IMAGE_BYTES).toBeLessThan(MAX_DWG_BYTES)
  })

  it('이미지 거절 메시지는 "함께 저장된다" 를 말한다', () => {
    // 왜 20MB 사진이 막히는지 모르면 사용자는 버그로 받아들인다.
    const v = checkImageSize(20 * MB)
    expect(v.kind).toBe('block')
    if (v.kind === 'block') expect(v.message).toContain('저장')
  })
})

describe('거절 메시지', () => {
  it('크기·상한·할 일을 다 말한다', () => {
    const v = checkCadSize('huge.dwg', 123 * MB)
    expect(v.kind).toBe('block')
    if (v.kind !== 'block') return
    expect(v.message).toContain('123.0MB')
    expect(v.message).toContain(formatMB(MAX_DWG_BYTES))
    expect(v.message).toContain('DXF')
  })
})

describe('formatMB', () => {
  it('소수 한 자리', () => {
    expect(formatMB(0)).toBe('0.0MB')
    expect(formatMB(1.5 * MB)).toBe('1.5MB')
    expect(formatMB(MAX_DXF_BYTES)).toBe('250.0MB')
  })
})

describe('빈 파일', () => {
  it('0 바이트는 크기로는 막지 않는다 (내용 검사가 따로 있다)', () => {
    // DWG 변환은 dxfBytes.length < 100 으로, DXF 는 SECTION/ENTITIES 유무로
    // 따로 걸러진다. 여기서 또 막으면 메시지가 엉뚱해진다.
    expect(kindOf('a.dwg', 0)).toBe('ok')
    expect(checkImageSize(0).kind).toBe('ok')
  })
})
