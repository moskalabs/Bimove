/**
 * 가져올 파일 크기 상한.
 *
 * 세 경로가 전부 크기를 보지 않고 파일을 통째로 읽고 있었다. 너무 큰 걸 던지면
 * 브라우저가 OOM 으로 탭을 죽인다 — 에러도 없고 try/catch 에도 안 걸린다.
 *
 * 그래서 여기서 보는 건 "경계에서 정확히 가르나" 와 "거절할 때 뭘 하라고
 * 알려주나" 다. 메시지가 그냥 "실패" 면 사용자는 같은 파일을 또 던진다.
 */
import { describe, it, expect } from 'vitest'
import {
  checkCadSize, checkConvertedDxfSize, checkPdfSize, checkImageSize,
  formatMB, MAX_DWG_BYTES, MAX_DXF_BYTES, MAX_PDF_BYTES, MAX_IMAGE_BYTES,
} from '../../lib/importLimits'

const MB = 1024 * 1024

describe('checkCadSize', () => {
  it('한의 실제 도면은 통과한다 (10.8MB DWG / 37.5MB DXF)', () => {
    // 상한을 올려 잡은 이유가 이것이다. 쓰던 파일이 막히면 고장이다.
    expect(checkCadSize('26.08.07_리닝.dwg', 10.8 * MB)).toBeNull()
    expect(checkCadSize('도면.dxf', 37.5 * MB)).toBeNull()
  })

  it('DWG 와 DXF 의 상한이 다르다 — 같은 크기라도 DWG 가 훨씬 무겁다', () => {
    const between = (MAX_DWG_BYTES + MAX_DXF_BYTES) / 2
    expect(checkCadSize('a.dwg', between)).not.toBeNull()
    expect(checkCadSize('a.dxf', between)).toBeNull()
  })

  it('경계는 "이하 통과"다', () => {
    expect(checkCadSize('a.dwg', MAX_DWG_BYTES)).toBeNull()
    expect(checkCadSize('a.dwg', MAX_DWG_BYTES + 1)).not.toBeNull()
    expect(checkCadSize('a.dxf', MAX_DXF_BYTES)).toBeNull()
    expect(checkCadSize('a.dxf', MAX_DXF_BYTES + 1)).not.toBeNull()
  })

  it('확장자 대소문자를 가리지 않는다', () => {
    // 윈도우에서 .DWG 로 저장된 파일이 흔하다. 여기서 놓치면 DWG 가
    // DXF 상한으로 통과해서 막으려던 지점을 그냥 지난다.
    const over = MAX_DWG_BYTES + MB
    expect(checkCadSize('A.DWG', over)).not.toBeNull()
    expect(checkCadSize('A.Dwg', over)).not.toBeNull()
  })

  it('거절할 때 크기·상한·할 일을 다 말한다', () => {
    const msg = checkCadSize('big.dwg', 123 * MB)!
    expect(msg).toContain('123.0MB')
    expect(msg).toContain(formatMB(MAX_DWG_BYTES))
    expect(msg).toContain('레이어')      // 무엇을 하라는 안내
  })
})

describe('checkConvertedDxfSize', () => {
  it('변환 결과가 DXF 상한을 넘으면 거절한다', () => {
    // DWG→DXF 는 3~4배로 부푼다. 파일 크기만으로는 못 막는 자리다.
    expect(checkConvertedDxfSize(MAX_DXF_BYTES)).toBeNull()
    expect(checkConvertedDxfSize(MAX_DXF_BYTES + 1)).not.toBeNull()
  })

  it('한의 도면이 만드는 37.5MB DXF 는 통과한다', () => {
    expect(checkConvertedDxfSize(37.5 * MB)).toBeNull()
  })

  it('DWG 상한을 통과한 파일도 여기서 걸릴 수 있다', () => {
    // 이 조합이 성립해야 이 검사가 의미가 있다 — 상한에 걸친 DWG 가 평범한
    // 팽창률로 변환됐을 때 DXF 상한을 넘어야, 통과한 파일이 변환 뒤 걸리는
    // 길이 열린다. 비율은 한의 실제 도면에서 잰 값이다 (10.8MB → 37.5MB).
    const OBSERVED_RATIO = 37.5 / 10.8
    expect(checkConvertedDxfSize(MAX_DWG_BYTES * OBSERVED_RATIO)).not.toBeNull()
  })
})

describe('checkPdfSize / checkImageSize', () => {
  it('경계에서 가른다', () => {
    expect(checkPdfSize(MAX_PDF_BYTES)).toBeNull()
    expect(checkPdfSize(MAX_PDF_BYTES + 1)).not.toBeNull()
    expect(checkImageSize(MAX_IMAGE_BYTES)).toBeNull()
    expect(checkImageSize(MAX_IMAGE_BYTES + 1)).not.toBeNull()
  })

  it('이미지 상한이 가장 낮다 — 스냅샷에 영구 저장되기 때문', () => {
    expect(MAX_IMAGE_BYTES).toBeLessThan(MAX_PDF_BYTES)
    expect(MAX_IMAGE_BYTES).toBeLessThan(MAX_DWG_BYTES)
  })

  it('이미지 거절 메시지는 "함께 저장된다" 를 말한다', () => {
    // 왜 20MB 사진이 막히는지 모르면 사용자는 버그로 받아들인다.
    expect(checkImageSize(20 * MB)).toContain('저장')
  })
})

describe('formatMB', () => {
  it('소수 한 자리', () => {
    expect(formatMB(0)).toBe('0.0MB')
    expect(formatMB(MB)).toBe('1.0MB')
    expect(formatMB(1.5 * MB)).toBe('1.5MB')
    expect(formatMB(MAX_DXF_BYTES)).toBe('150.0MB')
  })
})

describe('빈 파일', () => {
  it('0 바이트는 크기로는 막지 않는다 (내용 검사가 따로 있다)', () => {
    // DWG 변환은 dxfBytes.length < 100 으로, DXF 는 SECTION/ENTITIES 유무로
    // 따로 걸러진다. 여기서 또 막으면 메시지가 엉뚱해진다.
    expect(checkCadSize('a.dwg', 0)).toBeNull()
    expect(checkImageSize(0)).toBeNull()
  })
})
