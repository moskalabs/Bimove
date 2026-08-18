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

  it('style 태그 전체 제거 (CSS 오염 방지)', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><style>@font-face { font-family: "Test"; src: url(test.woff); } .cls { fill: red; }</style><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).not.toContain('<style')
    expect(result).not.toContain('@font-face')
    expect(result).not.toContain('.cls')
    expect(result).toContain('<rect/>')
  })

  it('복수 style 태그 전부 제거', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><defs><style>.a{fill:red}</style></defs><style>.b{stroke:blue}</style><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).not.toContain('<style')
    expect(result).toContain('<rect/>')
  })

  it('width/height가 없으면 원본 그대로 반환', () => {
    const input = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
    const result = prepareSvgForThumb(input)

    expect(result).toBe(input)
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
    // style 태그 전체 제거
    expect(result).not.toContain('<style')
    expect(result).not.toContain('@font-face')
    // 실제 도형 데이터 유지
    expect(result).toContain('M100 200 L300 400')
    expect(result).toContain('stroke="#333"')
  })
})
