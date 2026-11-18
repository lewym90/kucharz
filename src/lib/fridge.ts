import type { IndexItem } from './types'
export type Match = { r: IndexItem; used: number }

/** Tylko przepisy, na które masz KOMPLET składników (sól, pieprz, woda, olej, oliwa, cukier, „do smaku” i „do podania” się nie liczą). */
export function cookable(ix: IndexItem[], have: Set<string>, cat = ''): Match[] {
  const out: Match[] = []
  for (const r of ix) {
    if (cat && r.cat !== cat) continue
    if (!r.req.length || !r.req.every(k => have.has(k))) continue
    out.push({ r, used: r.req.length })
  }
  // najpierw dania, które zużyją najwięcej z tego, co masz, potem krótszy czas
  out.sort((a, b) => b.used - a.used || a.r.min - b.r.min)
  return out
}
