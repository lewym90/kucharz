// Port z tools/build_data.py (label_and_key): ten sam klucz składnika co w bazie, żeby „Moja lodówka” i zakupy rozpoznawały też własne przepisy.
// Wspólna konfiguracja (słowa pomijane, scalanie kluczy) jest w keymerge.json – czyta ją też generator danych.
import CFG from './keymerge.json'

const ADJ = new Set<string>(CFG.adj)
const DROP2 = new Set<string>(CFG.drop2)
const CONT = new Set<string>(CFG.cont)
const STEMX: Record<string, string> = CFG.stemx
const MERGE: Record<string, string> = CFG.merge
const STOP = new Set(['z', 'ze', 'do', 'na', 'w', 'i', 'oraz', 'lub', 'albo', 'bez', 'dla', 'po', 'od'])
const SUF = ['ami', 'ach', 'ów', 'om', 'ek', 'ka', 'ko', 'ki', 'ku', 'ie', 'ę', 'ą', 'a', 'e', 'y', 'i', 'o', 'u']
export const fold = (s: string) => s.replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
const stem = (tok: string) => {
  const t = fold(tok)
  if (STEMX[t]) return STEMX[t]
  for (const s of SUF) if (t.endsWith(s) && t.length - s.length >= 4) return t.slice(0, t.length - s.length)
  return t
}
export function labelAndKey(name: string): { label: string; key: string } {
  let n = name.toLowerCase().replace(/\(.*?\)/g, ' ').split(',')[0]
  n = n.split(/\blub\b|\balbo\b/)[0].trim()
  const toks = (n.match(/[a-ząćęłńóśźżà-ÿ]+/g) ?? []).filter(t => t.length > 1)
  let cut: string[] = []
  for (const t of toks) {
    if (STOP.has(t) && cut.length && !(CONT.has(cut[0]) && cut.length === 1 && (t === 'z' || t === 'ze' || cut[0] === 'proszek' || cut[0] === 'soda'))) break
    if (STOP.has(t) && cut.length) continue
    if (ADJ.has(t) || STOP.has(t)) continue
    cut.push(t)
  }
  cut = cut.length ? cut.slice(0, 2) : toks.slice(0, 1)
  if (cut.length === 2 && DROP2.has(cut[1])) cut = cut.slice(0, 1)
  if (!cut.length) return { label: n || name, key: fold(name) }
  const key = cut.map(stem).join(' ')
  return { label: cut.join(' '), key: MERGE[key] ?? key }
}
export const isStaple = (key: string) => ['sol', 'pieprz', 'woda', 'olej', 'oliwa', 'oliw', 'cukier'].includes(key.split(' ')[0]) || ['kost lodu', 'lod kruszon', 'lod'].includes(key)
