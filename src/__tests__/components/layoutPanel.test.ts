import { describe, it, expect } from 'vitest'
import { prepareSvgForThumb } from '../../components/panels/LayoutPanel'

describe('prepareSvgForThumb', () => {
  it('거대한 DXF SVG 치수를 100%로 축소', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="188529" height="124628"><path d="M0 0L100 100"/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).toContain('width="100%"')
    expect(result).toContain('height="100%"')
    expect(result).not.toContain('width="188529"')
    expect(result).not.toContain('height="124628"')
  })

  it('viewBox가 없으면 원본 치수로 viewBox 추가', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="188529" height="124628"><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).toContain('viewBox="0 0 188529 124628"')
  })

  it('이미 viewBox가 있으면 그대로 유지', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800" viewBox="10 20 500 400"><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).toContain('viewBox="10 20 500 400"')
    expect(result).toContain('width="100%"')
  })

  it('preserveAspectRatio 추가', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).toContain('preserveAspectRatio="xMidYMid meet"')
  })

  it('이미 preserveAspectRatio가 있으면 중복 추가 안 함', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300" preserveAspectRatio="xMinYMin"><rect/></svg>'
    const result = prepareSvgForThumb(input)

    // 기존 것 유지, 새로 추가 안 함
    expect(result).toContain('preserveAspectRatio="xMinYMin"')
    expect(result).not.toContain('xMidYMid meet')
  })

  it('foreignObject 제거', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect/><foreignObject x="0" y="0" width="100" height="100"><div>hello</div></foreignObject><circle/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).not.toContain('foreignObject')
    expect(result).not.toContain('hello')
    expect(result).toContain('<rect/>')
    expect(result).toContain('<circle/>')
  })

  it('복수 foreignObject 전부 제거', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><foreignObject><div>a</div></foreignObject><rect/><foreignObject><div>b</div></foreignObject></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).not.toContain('foreignObject')
    expect(result).toContain('<rect/>')
  })

  it('@font-face 제거하되 CSS 클래스는 유지', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><style>@font-face { font-family: "Test"; src: url(test.woff); } .cls { fill: red; }</style><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).not.toContain('@font-face')
    // CSS 클래스는 유지 (셰이프 렌더링에 필요)
    expect(result).toContain('.cls { fill: red; }')
    expect(result).toContain('<rect/>')
  })

  it('@import 제거하되 CSS 클래스는 유지', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><style>@import url("fonts.css"); .a{fill:red}</style><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).not.toContain('@import')
    expect(result).toContain('.a{fill:red}')
    expect(result).toContain('<rect/>')
  })

  it('width/height가 없으면 원본 그대로 반환', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).toBe(input)
  })

  it('소수점 치수도 정상 처리', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="1234.56" height="789.01"><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).toContain('viewBox="0 0 1234.56 789.01"')
    expect(result).toContain('width="100%"')
    expect(result).toContain('height="100%"')
  })

  it('width가 0이면 원본 그대로 반환', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="300"><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).toBe(input)
  })

  it('복수 @font-face 전부 제거', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><style>@font-face { font-family: "A"; src: url(a.woff); } @font-face { font-family: "B"; src: url(b.woff); } .x{color:red}</style><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).not.toContain('@font-face')
    expect(result).toContain('.x{color:red}')
  })

  it('내부 요소의 width/height는 건드리지 않음', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="200" height="100"/></svg>'
    const result = prepareSvgForThumb(input)

    // svg의 width만 100%로 변경, rect의 width는 유지
    expect(result).toContain('width="100%"')
    // rect의 width="200"은 그대로 (replace는 첫 매칭만)
    expect(result).toContain('width="200"')
  })

  it('실제 tldraw getSvgString 출력 형태 처리', () => {
    // tldraw이 실제로 생성하는 형태 시뮬레이션
    const input = `<svg xmlns="http://www.w3.org/2000/svg" width="188529.5" height="124628.3"><defs><style>@font-face { font-family: "tldraw"; src: url(data:font/woff2;base64,abc); }</style></defs><g transform="translate(16,16)"><path d="M100 200 L300 400" fill="none" stroke="#333" stroke-width="0.5"/></g><foreignObject x="0" y="0" width="100" height="50"><div xmlns="http://www.w3.org/1999/xhtml">label</div></foreignObject></svg>`
    const result = prepareSvgForThumb(input)

    // 치수 축소
    expect(result).toContain('width="100%"')
    expect(result).toContain('height="100%"')
    // viewBox 추가
    expect(result).toContain('viewBox="0 0 188529.5 124628.3"')
    // preserveAspectRatio 추가
    expect(result).toContain('preserveAspectRatio="xMidYMid meet"')
    // foreignObject 제거
    expect(result).not.toContain('foreignObject')
    expect(result).not.toContain('label')
    // @font-face만 제거, style 태그는 유지
    expect(result).not.toContain('@font-face')
    expect(result).toContain('<style')
    // 실제 도형 데이터 유지
    expect(result).toContain('M100 200 L300 400')
    expect(result).toContain('stroke="#333"')
  })
})
