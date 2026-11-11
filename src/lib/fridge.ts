import type { IndexItem } from './types'
export type Match = { r: IndexItem; have: number; total: number; pct: number; missing: string[] }
export type FridgeOpts = { have: Set<string>; maxMin: number; maxDiff: number; maxMissing: number; exclude: Set<string>; useOpt: boolean }

export function matchRecipes(ix: IndexItem[], o: FridgeOpts): Match[] {
  const out: Match[] = []
  for (const r of ix) {
    if (r.min > o.maxMin || r.diff > o.maxDiff) continue
    if (r.req.some(k => o.exclude.has(k))) continue
    const total = r.req.length
    if (total === 0) continue
    const missing = r.req.filter(k => !o.have.has(k))
    const have = total - missing.length
    if (have === 0 || missing.length > o.maxMissing) continue
    out.push({ r, have, total, pct: Math.round((have / total) * 100), missing })
  }
  out.sort((a, b) => b.pct - a.pct || a.missing.length - b.missing.length || a.r.min - b.r.min)
  return out
}
