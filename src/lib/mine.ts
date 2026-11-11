import type { Ing, IndexItem, Recipe } from './types'
import { isStaple, labelAndKey } from './keys'
import { db, getSetting } from './db'

export const DEFAULT_IMPORT_URL = 'https://188-68-247-201.sslip.io/kucharz-import'
export const MINE_PREFIX = 'mine:'
export const isMine = (id: string) => id.startsWith(MINE_PREFIX)

export type Draft = {
  title: string; summary: string; cat: string; min: number; diff: number; serv: number; cuisine: string
  tags: string[]; ing: { n: string; q: number | null; u: string | null }[]; steps: string[]; tip: string | null; src: string
}

export function toRecipe(d: Draft, id?: string): Recipe {
  const ing: Ing[] = d.ing.filter(i => i.n.trim()).map(i => ({ n: i.n.trim(), q: i.q, u: i.u, k: labelAndKey(i.n).key }))
  return {
    id: id ?? MINE_PREFIX + Date.now().toString(36), title: d.title.trim() || 'Bez tytułu', cat: d.cat || 'obiad',
    min: Math.max(1, d.min || 30), rest: 0, diff: Math.min(4, Math.max(1, d.diff || 2)), serv: Math.max(1, d.serv || 2),
    cuisine: d.cuisine, tags: d.tags, sum: d.summary, ing, steps: d.steps.filter(s => s.trim()), tip: d.tip || null,
    src: d.src || 'Własny przepis', lic: 'moje',
  }
}
export function toIndex(r: Recipe): IndexItem {
  const req = [...new Set(r.ing.filter(i => !isStaple(i.k) && i.u !== 'do smaku' && i.u !== 'do podania').map(i => i.k))].sort()
  const opt = [...new Set(r.ing.filter(i => !isStaple(i.k) && i.u === 'do podania').map(i => i.k))].sort()
  return {
    id: r.id, title: r.title, cat: r.cat, min: r.min, rest: r.rest, diff: r.diff, serv: r.serv, cuisine: r.cuisine,
    tags: r.tags, sum: r.sum, req, opt, ni: r.ing.length, ingtext: r.ing.map(i => i.n).join(' '),
  }
}
export function toDraft(r: Recipe): Draft {
  return { title: r.title, summary: r.sum, cat: r.cat, min: r.min, diff: r.diff, serv: r.serv, cuisine: r.cuisine, tags: r.tags,
    ing: r.ing.map(i => ({ n: i.n, q: i.q, u: i.u })), steps: r.steps, tip: r.tip, src: r.src }
}
export const emptyDraft = (): Draft => ({ title: '', summary: '', cat: 'obiad', min: 30, diff: 2, serv: 2, cuisine: '', tags: [], ing: [], steps: [], tip: null, src: '' })

// ── odpowiedź serwera → szkic ──
export function fromServer(r: any): Draft {
  return {
    title: r.title ?? '', summary: r.summary ?? '', cat: r.category ?? 'obiad', min: r.minutes ?? 30, diff: r.difficulty ?? 2, serv: r.servings ?? 2,
    cuisine: r.cuisine ?? '', tags: r.tags ?? [], ing: (r.ingredients ?? []).map((i: any) => ({ n: i.name, q: i.qty ?? null, u: i.unit ?? null })),
    steps: r.steps ?? [], tip: r.tip ?? null, src: r.source ?? '',
  }
}

export async function importFrom(input: { url?: string; text?: string }): Promise<{ draft: Draft; how: string }> {
  const base = (await getSetting<string>('importUrl', DEFAULT_IMPORT_URL)).replace(/\/+$/, '')
  let res: Response
  try {
    res = await fetch(base + '/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(170000) })
  } catch (e: any) {
    if (input.text) { const d = parseText(input.text); if (d) return { draft: d, how: 'offline' } }
    throw new Error(e?.name === 'TimeoutError' ? 'Import trwał za długo. Spróbuj ponownie albo wklej opis posta.' : 'Brak połączenia z serwerem importu. Sprawdź internet albo adres serwera w Profilu.')
  }
  let j: any = null
  try { j = await res.json() } catch { /* ignore */ }
  if (!res.ok || !j?.ok) {
    if (input.text && (j?.code === 'internal' || res.status >= 500)) { const d = parseText(input.text); if (d) return { draft: d, how: 'offline' } }
    throw new Error(j?.error ?? 'Import się nie udał (' + res.status + ').')
  }
  return { draft: fromServer(j.recipe), how: j.how ?? '' }
}

export async function pingServer(): Promise<{ ok: boolean; gemini?: boolean; msg: string }> {
  const base = (await getSetting<string>('importUrl', DEFAULT_IMPORT_URL)).replace(/\/+$/, '')
  try {
    const r = await fetch(base + '/health', { signal: AbortSignal.timeout(8000) })
    const j = await r.json()
    if (!j.ok) return { ok: false, msg: 'Serwer odpowiada, ale zgłasza błąd.' }
    return { ok: true, gemini: !!j.gemini, msg: j.gemini ? 'Serwer działa. Filmy i napisy na ekranie są obsługiwane.' : 'Serwer działa, ale bez klucza Gemini (tylko strony i tekst).' }
  } catch { return { ok: false, msg: 'Nie mogę połączyć się z serwerem importu.' } }
}

// ── składniki: jedna linia → pozycja (qty, jednostka, nazwa) ──
const UNIT_MAP: Record<string, string> = {
  g: 'g', gr: 'g', gram: 'g', gramy: 'g', gramów: 'g', kg: 'kg', ml: 'ml', l: 'l', litr: 'l', litry: 'l', litra: 'l',
  łyżka: 'łyżka', łyżki: 'łyżka', łyżek: 'łyżka', tbsp: 'łyżka', łyżeczka: 'łyżeczka', łyżeczki: 'łyżeczka', łyżeczek: 'łyżeczka', tsp: 'łyżeczka',
  szklanka: 'szklanka', szklanki: 'szklanka', szklanek: 'szklanka', cup: 'szklanka', cups: 'szklanka',
  szczypta: 'szczypta', szczypty: 'szczypta', szczypt: 'szczypta', 'szt': 'szt.', 'szt.': 'szt.', sztuka: 'szt.', sztuki: 'szt.', sztuk: 'szt.',
  ząbek: 'ząbek', ząbki: 'ząbek', ząbków: 'ząbek', plaster: 'plaster', plastry: 'plaster', plasterki: 'plaster', plasterków: 'plaster',
  kromka: 'kromka', kromki: 'kromka', kromek: 'kromka', puszka: 'puszka', puszki: 'puszka', puszek: 'puszka', pęczek: 'pęczek', pęczki: 'pęczek',
  garść: 'garść', garście: 'garść', garści: 'garść', opakowanie: 'opakowanie', opakowania: 'opakowanie', kawałek: 'kawałek', kawałki: 'kawałek',
  główka: 'główka', główki: 'główka', gałązka: 'gałązka', gałązki: 'gałązka', łodyga: 'łodyga', łodygi: 'łodyga', dag: 'dag', dkg: 'dag',
}
const FRAC: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 }
function num(tok: string): number | null {
  const t = tok.trim().replace(',', '.')
  if (FRAC[t] != null) return FRAC[t]
  let m = t.match(/^(\d+)\s*([½¼¾⅓⅔⅛])$/); if (m) return +m[1] + FRAC[m[2]]
  m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/); if (m) return +m[1] + +m[2] / +m[3]
  m = t.match(/^(\d+)\/(\d+)$/); if (m) return +m[1] / +m[2]
  m = t.match(/^(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?$/); return m ? parseFloat(m[1]) : null
}
export function parseIngLine(line: string): { n: string; q: number | null; u: string | null } | null {
  let s = line.trim().replace(/^[\s\-•*·▪►✔✅👉➡️🔸🔹▫●○]+/, '').replace(/^\d+[.)]\s+(?=\d)/, '').replace(/\s+/g, ' ').replace(/^[ \-•*·]+|[ \-•*·]+$/g, '')
  if (!s) return null
  const m = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])\s*(.*)$/)
  if (!m) {
    const pm = s.match(/^(szczypt\w+|odrobin\w+)\s+(.*)$/i)
    if (pm) return /^szczypt/i.test(pm[1]) ? { n: pm[2], q: 1, u: 'szczypta' } : { n: pm[2], q: null, u: 'do smaku' }
    return { n: s, q: null, u: /do smaku/i.test(s) ? 'do smaku' : null }
  }
  let q = num(m[1]); let rest = m[2]; let u: string | null = null
  const um = rest.match(/^([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż.]+)\b\.?\s*(.*)$/)
  if (um && UNIT_MAP[um[1].toLowerCase()]) { u = UNIT_MAP[um[1].toLowerCase()]; rest = um[2].replace(/^(z|ze)\s+/i, '') }
  if (u === 'dag' && q != null) { q *= 10; u = 'g' }
  else if (u === 'szklanka' && q != null) { q *= 250; u = 'ml' }
  if (u == null && q != null) u = 'szt.'
  return { n: rest.replace(/^[ ,.]+|[ ,.]+$/g, '') || s, q, u }
}
export function ingToLine(i: { n: string; q: number | null; u: string | null }): string {
  if (i.q == null) return i.u === 'do smaku' ? `${i.n} (do smaku)` : i.n
  const q = String(Math.round(i.q * 100) / 100).replace('.', ',')
  return `${q} ${i.u === 'szt.' || !i.u ? '' : i.u + ' '}${i.n}`.replace(/\s+/g, ' ').trim()
}
export function lineToIng(line: string) {
  const l = line.replace(/\s*\(do smaku\)\s*$/i, ' do smaku').trim()
  return parseIngLine(l)
}

// ── tryb offline: tekst → szkic (reguły, bez AI) ──
const HEAD_ING = /^\s*(?:#+\s*)?(sk[łl]adniki|ingredients?|potrzebujesz|na \d+ porcj\w+)\b.*?:?\s*$/i
const HEAD_STEP = /^\s*(?:#+\s*)?(przygotowanie|spos[óo]b (?:przygotowania|wykonania)|wykonanie|kroki|instrukcja|instructions?|directions?|method|steps?|jak zrobi[ćc])\b.*?:?\s*$/i
export function parseText(text: string): Draft | null {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.trimEnd()).filter(l => l.trim())
  const ing: string[] = [], steps: string[] = [], other: string[] = []
  let mode: 'i' | 's' | null = null
  for (const l of lines) {
    if (HEAD_ING.test(l)) { mode = 'i'; continue }
    if (HEAD_STEP.test(l)) { mode = 's'; continue }
    ;(mode === 'i' ? ing : mode === 's' ? steps : other).push(l)
  }
  let ingL = ing, stepL = steps, oth = other
  if (!ingL.length && !stepL.length) {
    const like = other.filter(l => /^\s*(?:[-•*·▪►✔✅👉🔸🔹●○]\s*)?(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔⅛])\s*[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż.]+/.test(l) && l.length < 90)
    if (like.length >= 3) { ingL = like; stepL = other.filter(l => !like.includes(l) && l.length > 30); oth = other.filter(l => !like.includes(l) && !stepL.includes(l)) }
  }
  const items = ingL.map(parseIngLine).filter(Boolean) as { n: string; q: number | null; u: string | null }[]
  const st = stepL.map(l => l.replace(/^\s*(?:krok\s*)?\d+\s*[.):-]\s*/i, '').replace(/^[\s\-•*·▪►✔✅👉🔸🔹●○]+/, '').trim())
    .filter(l => l && !/^\d+\s*(?:porcj\w*|osób|min\w*)\b[^.]{0,20}$/i.test(l))
  if (items.length < 2 || st.length < 1) return null
  const metaTxt = [...oth, ...stepL.filter(l => l.length < 40)].join('\n')
  const mm = metaTxt.match(/(\d+)\s*(?:min|minut)/i)
  const sv = metaTxt.match(/(?:porcj\w*|osób|os\.)\D{0,3}(\d+)|(\d+)\s*(?:porcj|osób)/i)
  const d = emptyDraft()
  d.title = (oth[0] ?? 'Przepis z tekstu').replace(/^[ #*-]+|[ #*-]+$/g, '').slice(0, 120)
  d.summary = oth.slice(1, 3).join(' ').slice(0, 240)
  d.ing = items; d.steps = st; d.min = mm ? +mm[1] : 30; d.serv = sv ? +(sv[1] || sv[2]) : 2
  return d
}
export async function saveMine(d: Draft, id?: string): Promise<string> {
  const r = toRecipe(d, id)
  await db.mine.put({ ...r, at: Date.now() })
  return r.id
}
