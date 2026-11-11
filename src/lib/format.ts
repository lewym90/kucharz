const FR: [number, string][] = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']]
export function fmtQty(q: number): string {
  if (q >= 100) return String(Math.round(q / 5) * 5)
  if (q >= 10) return String(Math.round(q))
  const whole = Math.floor(q + 1e-9); const frac = q - whole
  if (frac < 0.06) return String(whole || (q > 0 ? q.toFixed(1) : 0))
  if (frac > 0.94) return String(whole + 1)
  let best = FR[0]; for (const f of FR) if (Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f
  if (Math.abs(best[0] - frac) < 0.07) return (whole ? whole + ' ' : '') + best[1]
  return q.toFixed(1).replace('.', ',')
}
// odmiana polskich jednostek: [1, 2-4, 5+]
const PL: Record<string, [string, string, string]> = {
  'łyżka': ['łyżka', 'łyżki', 'łyżek'], 'łyżeczka': ['łyżeczka', 'łyżeczki', 'łyżeczek'],
  'ząbek': ['ząbek', 'ząbki', 'ząbków'], 'kromka': ['kromka', 'kromki', 'kromek'],
  'plaster': ['plaster', 'plastry', 'plastrów'], 'liść': ['liść', 'liście', 'liści'],
  'gałązka': ['gałązka', 'gałązki', 'gałązek'], 'łodyga': ['łodyga', 'łodygi', 'łodyg'],
  'puszka': ['puszka', 'puszki', 'puszek'], 'pęczek': ['pęczek', 'pęczki', 'pęczków'],
  'garść': ['garść', 'garście', 'garści'], 'szczypta': ['szczypta', 'szczypty', 'szczypt'],
  'główka': ['główka', 'główki', 'główek'], 'kawałek': ['kawałek', 'kawałki', 'kawałków'],
  'arkusz': ['arkusz', 'arkusze', 'arkuszy'], 'opakowanie': ['opakowanie', 'opakowania', 'opakowań'],
  'gałka': ['gałka', 'gałki', 'gałek'], 'laska': ['laska', 'laski', 'lasek'], 'porcja': ['porcja', 'porcje', 'porcji'],
  'torebka': ['torebka', 'torebki', 'torebek'], 'kostka': ['kostka', 'kostki', 'kostek'],
}
export function unitLabel(u: string | null, q: number | null): string {
  if (!u) return ''
  const f = PL[u]; if (!f || q == null) return u
  if (Math.abs(q - 1) < 1e-9) return f[0]
  if (q !== Math.floor(q)) return f[1] // 1,5 łyżki; 2,5 łyżki
  const m10 = q % 10, m100 = q % 100
  if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return f[1]
  return f[2]
}
export function fmtIng(q: number | null, u: string | null, factor = 1): string {
  if (q == null) return u ?? ''
  const v = q * factor
  if (u === 'g' && v >= 1000) return `${fmtQty(v / 1000)} kg`
  if (u === 'ml' && v >= 1000) return `${fmtQty(v / 1000)} l`
  return `${fmtQty(v)} ${unitLabel(u, Math.abs(v - Math.round(v)) < 0.06 ? Math.round(v) : v)}`.trim()
}
export const fmtMin = (m: number) => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`
