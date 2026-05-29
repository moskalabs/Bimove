import type { PatternId } from './materialPresets'

/** WallShape용 SVG 패턴 인라인 정의 helper. */
export function renderPatternDef(p: PatternId | string | undefined, id: string, color: string) {
  if (!p || p === 'none') return null
  switch (p) {
    case 'concrete':
      return <defs><pattern id={id} patternUnits="userSpaceOnUse" width={10} height={10}>
        <circle cx={2} cy={2} r={0.8} fill={color} opacity={0.45} />
        <circle cx={7} cy={6} r={0.6} fill={color} opacity={0.30} />
      </pattern></defs>
    case 'brick':
      return <defs><pattern id={id} patternUnits="userSpaceOnUse" width={14} height={8}>
        <line x1={0} y1={0} x2={14} y2={0} stroke={color} strokeWidth={0.5} opacity={0.55} />
        <line x1={7} y1={0} x2={7} y2={4} stroke={color} strokeWidth={0.5} opacity={0.55} />
        <line x1={0} y1={4} x2={14} y2={4} stroke={color} strokeWidth={0.5} opacity={0.55} />
        <line x1={0} y1={4} x2={0} y2={8} stroke={color} strokeWidth={0.5} opacity={0.55} />
        <line x1={14} y1={4} x2={14} y2={8} stroke={color} strokeWidth={0.5} opacity={0.55} />
      </pattern></defs>
    case 'wood':
      return <defs><pattern id={id} patternUnits="userSpaceOnUse" width={6} height={20}>
        <path d="M0 0 Q3 5 0 10 Q-3 15 0 20" fill="none" stroke={color} strokeWidth={0.4} opacity={0.5} />
      </pattern></defs>
    case 'glass':
      return <defs><pattern id={id} patternUnits="userSpaceOnUse" width={6} height={6}>
        <line x1={0} y1={6} x2={6} y2={0} stroke={color} strokeWidth={0.4} opacity={0.5} />
      </pattern></defs>
    case 'tile':
      return <defs><pattern id={id} patternUnits="userSpaceOnUse" width={10} height={10}>
        <rect x={0} y={0} width={10} height={10} fill="none" stroke={color} strokeWidth={0.4} opacity={0.5} />
      </pattern></defs>
    default:
      return null
  }
}
