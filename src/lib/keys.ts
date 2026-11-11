// Port z tools/build_data.py (label_and_key): ten sam klucz składnika co w bazie, żeby „Moja lodówka” i zakupy rozpoznawały też własne przepisy.
const ADJ = new Set('świeży świeża świeże świeżo drobno posiekany posiekana posiekane posiekanej mielony mielona mielone duży duża duże mały mała małe średni średnia średnie gotowany gotowana gotowane ugotowany ugotowana ugotowane dojrzały dojrzała dojrzałe twardy miękki miękka zimny zimna zimne ciepły ciepła ciepłe gorący gorąca gorące pokrojony pokrojona pokrojone starty starta starte tarty tarta tarte w kostkę kostkę kostka plasterkach plasterki plasterkami półplasterkach półplasterki cienkie cienkich cienkie grubo drobny drobna drobne rozmiar rozmiaru dobrej jakości opalona opalony najlepiej plus około ok bardzo dobrze mocno odsączone odsączona odsączony wypestkowane wypestkowany obrane obrany umyte pokruszona pokruszone rozmrożone mrożone mrożony mrożona cienko krojone krojona krojony świeżej'.split(' '))
const CONT = new Set(['sok', 'skórka', 'skórki', 'proszek', 'soda'])
const STOP = new Set(['z', 'ze', 'do', 'na', 'w', 'i', 'oraz', 'lub', 'albo', 'bez', 'dla', 'po', 'od'])
const SUF = ['ami', 'ach', 'ów', 'om', 'ek', 'ka', 'ko', 'ki', 'ku', 'ie', 'ę', 'ą', 'a', 'e', 'y', 'i', 'o', 'u']
export const fold = (s: string) => s.replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const stem = (tok: string) => {
  const t = fold(tok)
  for (const s of SUF) if (t.endsWith(s) && t.length - s.length >= 4) return t.slice(0, t.length - s.length)
  return t
}
export function labelAndKey(name: string): { label: string; key: string } {
  let n = name.toLowerCase().replace(/\(.*?\)/g, ' ').split(',')[0]
  n = n.split(/\blub\b|\balbo\b/)[0].trim()
  const toks = n.match(/[a-ząćęłńóśźż]+/g) ?? []
  const cut: string[] = []
  for (const t of toks) {
    if (STOP.has(t) && cut.length && !(CONT.has(cut[0]) && cut.length === 1)) break
    if (STOP.has(t) && cut.length) continue
    if (ADJ.has(t) || STOP.has(t)) continue
    cut.push(t)
  }
  const c = cut.length ? cut.slice(0, 2) : toks.slice(0, 1)
  if (!c.length) return { label: n || name, key: fold(name) }
  return { label: c.join(' '), key: c.map(stem).join(' ') }
}
export const isStaple = (key: string) => ['sol', 'pieprz', 'woda', 'olej', 'oliwa', 'oliw', 'cukier'].includes(key.split(' ')[0]) || ['kost lodu', 'lod kruszon', 'lod'].includes(key)
