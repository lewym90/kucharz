import { useSyncExternalStore } from 'react'
import { db, getSetting, setSetting } from './db'
import { fromServer, serverBase, toRecipe } from './mine'
import { processPhoto, putPhoto } from './photos'

// Pobieranie wszystkich przepisów z kanału (YouTube, TikTok). Serwer robi to w tle bez AI;
// aplikacja co kilka sekund dopytuje o postęp i od razu zapisuje gotowe przepisy (ze zdjęciami) w telefonie.
export type ChannelJob = {
  id: string; url: string; name: string; key: string; state: 'running' | 'done' | 'error'; phase: string
  total: number; checked: number; found: number; later: number; later_done: number; error: string
}
type Saved = { id: string; url: string; saved: number; added: number; fixed?: number; repair?: boolean; job?: ChannelJob; dismissed?: boolean }
/** wersja parsera na serwerze, od której przepisy z kanałów są poprawne (bez makro zamiast składników) */
export const PARSER_V = 9

let current: Saved | null = null
const subs = new Set<() => void>()
const emit = () => { current = current ? { ...current } : null; subs.forEach(f => f()) }
export const useChannelJob = () => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => current)
getSetting<Saved | null>('channelJob', null).then(v => { current = v; emit() })
const persist = () => setSetting('channelJob', current)

export const isChannelUrl = (u: string) => {
  const s = u.trim()
  return /youtube\.com\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)(\/(videos|shorts|streams|featured))?\/?(\?.*)?$/i.test(s)
    || (/youtube\.com\/playlist\?/i.test(s) && /list=/.test(s))
    || /tiktok\.com\/@[^/?#]+\/?(\?.*)?$/i.test(s)
    || /instagram\.com\/(?!p\/|reel\/|reels\/|tv\/|stories\/|explore\/)[\w.]+\/?(\?.*)?$/i.test(s)
}

const SOCIAL = /(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.com|fb\.watch)/i
/** Link do strony głównej albo działu serwisu z przepisami (nie do jednego przepisu). */
export const isSiteUrl = (u: string) => {
  try { const p = new URL(u.trim()); return !SOCIAL.test(p.hostname) && (p.pathname === '/' || p.pathname === '' || /\/(przepisy|kategori\w*|category|recipes?|dzial|tag)\/?[^/]*\/?$/i.test(p.pathname)) } catch { return false }
}
export const isFacebookProfile = (u: string) => /facebook\.com\/(?!share|watch|reel|groups\/[^/]+\/(posts|permalink)|[^/]+\/(posts|videos|photos)\/|story\.php|permalink\.php|photo)[\w.-]+\/?(\?.*)?$/i.test(u.trim())
export const isSocialSource = (url: string) => SOCIAL.test(url)

export async function startChannel(url: string, repair = false): Promise<void> {
  const base = await serverBase()
  let res: Response
  try {
    res = await fetch(base + '/channel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }), signal: AbortSignal.timeout(30000) })
  } catch { throw new Error('Brak połączenia z serwerem.') }
  if (res.status === 404) throw new Error('Serwer nie zna jeszcze tej funkcji – trzeba go zaktualizować.')
  const j = await res.json().catch(() => null)
  if (!res.ok || !j?.ok) throw new Error(j?.error ?? 'Nie udało się zacząć pobierania (' + res.status + ').')
  current = { id: j.job.id, url: url.trim(), saved: 0, added: 0, fixed: 0, repair, job: j.job }
  await persist(); emit()
  syncChannel()
}

export async function dismissChannel() { current = null; await persist(); emit() }

let busy = false
export async function syncChannel(): Promise<void> {
  if (busy || !current || current.dismissed) return
  const done = current.job && current.job.state !== 'running' && current.saved >= current.job.found
  if (done) return
  busy = true
  try {
    const base = await serverBase()
    const st = await fetch(`${base}/channel/${current.id}`, { signal: AbortSignal.timeout(15000) })
    const sj = await st.json().catch(() => null)
    if (st.status === 404) { current.job = { ...(current.job as ChannelJob), state: 'error', error: sj?.error ?? 'Serwer nie ma już tego zadania.' }; await persist(); emit(); return }
    if (!sj?.ok) return
    const job: ChannelJob = sj.job
    current.job = job; emit()
    if (job.key) await db.colls.put({ id: 'ch:' + job.key, name: job.name || job.key, url: current.url, rids: [], at: (await db.colls.get('ch:' + job.key))?.at ?? Date.now() })
    while (current.saved < job.found) {
      const rr = await fetch(`${base}/channel/${current.id}/recipes?from=${current.saved}&n=10`, { signal: AbortSignal.timeout(30000) })
      const rj = await rr.json().catch(() => null)
      if (!rj?.ok || !rj.recipes?.length) break
      for (const r of rj.recipes) {
        const id = 'mine:' + (job.key || 'kanal').slice(0, 24) + '-' + (r.vid || current.saved)
        const old = await db.mine.get(id)
        if (old && current.repair && !old.edited) {
          // naprawa: nowa wersja składników i kroków; zdjęcie, ocena, ulubione i plan zostają (są zapisane osobno)
          const d = fromServer(r)
          await db.mine.put({ ...toRecipe(d, id), at: old.at, ch: job.key })
          if (d.image && !(await db.thumbs.get(id))) {
            try { const b = await (await fetch(d.image)).blob(); await putPhoto(id, await processPhoto(new File([b], 'danie', { type: b.type || 'image/jpeg' }))) } catch { /* bez zdjęcia */ }
          }
          current.fixed = (current.fixed ?? 0) + 1
        } else if (!old) {
          const d = fromServer(r)
          const rec = toRecipe(d, id)
          await db.mine.put({ ...rec, at: Date.now(), ch: job.key })
          if (d.image) {
            try { const b = await (await fetch(d.image)).blob(); await putPhoto(id, await processPhoto(new File([b], 'danie', { type: b.type || 'image/jpeg' }))) } catch { /* bez zdjęcia */ }
          }
          current.added++
        }
        current.saved++
      }
      await persist(); emit()
    }
    if (job.state === 'done' && current.saved >= job.found && current.repair && job.key) await db.colls.update('ch:' + job.key, { fixV: PARSER_V })
    await persist(); emit()
  } catch { /* brak sieci – spróbujemy za chwilę */ }
  finally { busy = false }
}

// ── naprawa przepisów pobranych starszą wersją (makro zamiast składników) ──
const BAD_ING = /kcal|kalori|makro|warto[śs]\w* od[żz]ywcz|w[ęe]glowodan|^\W*[BTW]\s*[:=]\s*\d|^(min|t[łl]uszcz\w*)$/i
export function looksBroken(m: { ing: { n: string; q: number | null; u: string | null }[]; steps: string[] }) {
  return m.ing.some(i => BAD_ING.test(i.n) || (/^bia[łl]k/i.test(i.n) && i.u === 'g') || (i.q == null && /\d+\s*(g|ml|kg|l)\b\s*(\(.*\))?$/i.test(i.n)))
    || m.ing.length < 3 || m.steps.some(s => /:\s*$/.test(s) || /\bkcal\b|w tym odcinku|w dzisiejszym odcinku|zapraszam|subskryb/i.test(s))
}
let repairTried = false
/** Raz po aktualizacji parsera: pobiera kanał ponownie i poprawia przepisy (tylko nieedytowane), dokłada brakujące. */
export async function autoRepair() {
  if (repairTried) return
  if (current && !current.dismissed && current.job?.state === 'running') return
  repairTried = true
  try {
    const chans = (await db.colls.toArray()).filter(c => c.id.startsWith('ch:') && (c.fixV ?? 0) < PARSER_V && c.url)
    if (!chans.length) return
    const mine = await db.mine.toArray()
    const h = await (await fetch((await serverBase()) + '/health', { signal: AbortSignal.timeout(10000) })).json()
    if (!(h?.v >= PARSER_V)) { repairTried = false; return } // serwer jeszcze nie zaktualizowany – spróbujemy przy następnym otwarciu
    // po każdej poprawie parsera każdy kanał jest raz przeglądany od nowa: dochodzą przepisy, których starsza wersja
    // nie rozpoznała, a zepsute są poprawiane (nadpisywane tylko nieedytowane). Najpierw kanały z zepsutymi przepisami.
    chans.sort((a, b) => Number(!mine.some(m => m.ch === b.id.slice(3) && looksBroken(m))) - Number(!mine.some(m => m.ch === a.id.slice(3) && looksBroken(m))))
    await startChannel(chans[0].url!, true) // jeden kanał naraz; kolejny przy następnym otwarciu aplikacji
  } catch { repairTried = false }
}

/** Usuwa kanał: wszystkie jego przepisy, zdjęcia, oceny i wpisy w planie. */
export async function deleteChannel(key: string) {
  const ids = (await db.mine.filter(m => m.ch === key).toArray()).map(m => m.id)
  await db.transaction('rw', [db.mine, db.photos, db.thumbs, db.favs, db.ratings, db.hist, db.plan, db.colls], async () => {
    await db.mine.bulkDelete(ids); await db.photos.bulkDelete(ids); await db.thumbs.bulkDelete(ids)
    await db.favs.bulkDelete(ids); await db.ratings.bulkDelete(ids); await db.hist.bulkDelete(ids)
    await db.plan.filter(p => ids.includes(p.rid)).delete(); await db.colls.delete('ch:' + key)
  })
}

export function phaseText(j?: ChannelJob): string {
  if (!j) return 'Łączę z serwerem…'
  if (j.state === 'error') return j.error || 'Coś poszło nie tak.'
  if (j.phase === 'lista' || j.phase === 'start') return 'Pobieram listę filmów…'
  if (j.phase === 'opisy') return `Sprawdzam opisy filmów: ${j.checked} z ${j.total}`
  if (j.phase === 'strony') return `Sprawdzam strony z przepisami: ${j.checked} z ${j.total}`
  if (j.phase === 'komentarze') return `Sprawdzam komentarze autora: ${Math.min(j.later_done, j.later)} z ${j.later}`
  return 'Gotowe'
}
export function phasePct(j?: ChannelJob): number {
  if (!j) return 2
  if (j.state !== 'running') return 100
  if (j.phase === 'opisy') return 5 + Math.round(80 * j.checked / Math.max(1, j.total))
  if (j.phase === 'strony') return 5 + Math.round(94 * j.checked / Math.max(1, j.total))
  if (j.phase === 'komentarze') return 85 + Math.round(15 * Math.min(j.later_done, j.later) / Math.max(1, j.later))
  return 3
}
