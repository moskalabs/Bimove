export function formatArea(areaMm2: number, unit: string): string {
  if (unit === 'mm') return `${Math.round(areaMm2).toLocaleString()} mm²`
  if (unit === 'cm') return `${(areaMm2 / 100).toFixed(1)} cm²`
  return `${(areaMm2 / 1_000_000).toFixed(2)} m²`
}
