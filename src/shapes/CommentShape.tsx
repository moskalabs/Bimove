import { Circle2d, ShapeUtil, SVGContainer, T, type TLBaseShape } from 'tldraw'

export type CommentShapeProps = {
  text: string
  resolved: boolean
  author: string
}

export type CommentShape = TLBaseShape<'comment', CommentShapeProps>

const SIZE = 32

export class CommentShapeUtil extends ShapeUtil<CommentShape> {
  static override type = 'comment' as const

  static override props = {
    text: T.string,
    resolved: T.boolean,
    author: T.string,
  }

  override getDefaultProps(): CommentShapeProps {
    return { text: '', resolved: false, author: '' }
  }

  canEdit = () => false
  canResize = () => false
  isAspectRatioLocked = () => true
  hideSelectionBoundsFg = () => true

  override getGeometry() {
    return new Circle2d({ radius: SIZE / 2, isFilled: true })
  }

  indicator() {
    return <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} />
  }

  override component(shape: CommentShape) {
    const { resolved, text } = shape.props
    const fill = resolved ? '#aaa' : '#fbbf24'
    const border = resolved ? '#999' : '#d97706'
    const maxChars = 28
    const preview = text.length > maxChars ? text.slice(0, maxChars) + '…' : text

    return (
      <SVGContainer>
        {/* tail */}
        <polygon points={`${SIZE * 0.3},${SIZE} ${SIZE * 0.7},${SIZE} ${SIZE * 0.42},${SIZE + 10}`}
          fill={fill} stroke={border} strokeWidth={1} strokeLinejoin="round" />
        {/* bubble */}
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} fill={fill} stroke={border} strokeWidth={1.5} />
        {/* icon */}
        {resolved ? (
          <text x={SIZE / 2} y={SIZE / 2 + 5} textAnchor="middle" fontSize={14} fill="#fff"
            style={{ userSelect: 'none', pointerEvents: 'none' }}>✓</text>
        ) : (
          <text x={SIZE / 2} y={SIZE / 2 + 5} textAnchor="middle" fontSize={14} fill="#7c3a00"
            style={{ userSelect: 'none', pointerEvents: 'none' }}>✎</text>
        )}
        {/* text preview on hover — shown as tooltip-like label below */}
        {preview && (
          <text x={SIZE / 2} y={SIZE + 24} textAnchor="middle" fontSize={11} fill="#333"
            style={{ userSelect: 'none', pointerEvents: 'none', fontFamily: 'sans-serif' }}>
            {preview}
          </text>
        )}
      </SVGContainer>
    )
  }

}
