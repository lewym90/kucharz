import { useSyncExternalStore } from 'react'
import { db, getSetting, setSetting } from './db'
import { serverBase } from './mine'

// Synchronizacja między wybranymi urządzeniami (jedno hasło = jedna wspólna kuchnia).
// Zasady bezpieczeństwa danych:
//  • pierwsze połączenie tylko DOKŁADA – lokalne wpisy idą na serwer z najniższym priorytetem, więc nic istniejącego nie nadpiszą,
//  • wpis znika na innych urządzeniach tylko wtedy, gdy ktoś go usunął (nagrobek), a nie dlatego, że gdzieś go brakuje,
//  • przy edycji tego samego wpisu w dwóch miejscach wygrywa późniejsza zmiana; serwer trzyma dzienne kopie (30 dni).
type Cfg = { token: string; device: string; name: string; since: number; first: boolean; at?: number }
type Rec = { t: string; k: string; v: any; u: number }
const TABLES: [string, string][] = [['mine', 'id'], ['favs', 'id'], ['ratings', 'id'], ['plan', 'key'], ['shop', 'key'], ['pantry', 'k'], ['colls', 'id'], ['photos', 'id'], ['thumbs', 'id']]
const BIG = new Set(['photos', 'thumbs']) // duże: wykrywanie zmian po kluczach i znacznikach z „haczyków”, bez czytania wszystkich zdjęć

export type SyncState = { on: boolean; busy: boolean; err: string; at?: number; name?: string; progress?: string }
let state: SyncState = { on: false, busy: false, err: '' }
const subs = new Set<() => void>()
const set = (p: Partial<SyncState>) => { state = { ...state, ...p }; subs.forEach(f => f()) }
export const useSync = () => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => state)

let cfg: Cfg | null = null
const ready = getSetting<Cfg | null>('sync', null).then(c => { cfg = c; set({ on: !!c, at: c?.at, name: c?.name }) })
const save = () => setSetting('sync', cfg)

// ── wykrywanie zmian zdjęć i szybkie wyzwalanie synchronizacji po zmianie ──
let applying = false
const dirtyBig = new Set<string>(JSON.parse(localStorage.getItem('syncDirty') ?? '[]'))
const keepDirty = () => { try { localStorage.setItem('syncDirty', JSON.stringify([...dirtyBig])) } catch { /* */ } }
let soon = 0
const schedule = (ms = 3000) => { if (!cfg) return; clearTimeout(soon); soon = window.setTimeout(() => { syncNow() }, ms) }
for (const [t] of TABLES) {
  const tb = (db as any)[t]
  const mark = (key: any) => { if (applying) return; if (BIG.has(t)) { dirtyBig.add(t + '|' + key); keepDirty() } schedule() }
  tb.hook('creating', function (pk: any, obj: any) { mark(pk ?? obj?.id) })
  tb.hook('updating', function (_m: any, pk: any) { mark(pk) })
  tb.hook('deleting', function (pk: any) { mark(pk) })
}

const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) } return (h >>> 0).toString(36) + ':' + s.length }
const hashOf = (t: string, v: any) => BIG.has(t) ? 'L' + String(v?.data ?? '').length + ':' + String(v?.data ?? '').slice(-48) : fnv(JSON.stringify(v))

async function api(path: string, body?: any): Promise<any> {
  const base = await serverBase()
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cfg ? { 'X-Sync-Token': cfg.token } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000),
  })
  const j = await res.json().catch(() => null)
  if (res.status === 404 && !j?.code) throw Object.assign(new Error('Serwer nie zna jeszcze synchronizacji – trzeba go zaktualizować.'), { code: 'old' })
  if (!res.ok || !j?.ok) throw Object.assign(new Error(j?.error ?? 'Błąd serwera (' + res.status + ').'), { code: j?.code })
  return j
}

export const guessName = () => {
  const u = navigator.userAgent
  return /iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /iPhone/.test(u) ? 'iPhone' : /Android.*Mobile/.test(u) ? 'Telefon Android' : /Android/.test(u) ? 'Tablet Android' : /Windows/.test(u) ? 'Laptop Windows' : /Mac/.test(u) ? 'Mac' : 'Urządzenie'
}

/** Łączy to urządzenie z synchronizacją. create=true tworzy nową (tylko na pierwszym urządzeniu). */
export async function joinSync(password: string, name: string, create: boolean) {
  await ready
  const j = await api('/sync/join', { password, device: name, create })
  await db.syncmeta.clear()
  dirtyBig.clear(); keepDirty()
  cfg = { token: j.token, device: j.device, name, since: 0, first: true }
  await save(); set({ on: true, err: '', name })
  await syncNow()
  return j
}

/** Odłącza TO urządzenie. Dane na urządzeniu zostają, tylko przestają się synchronizować. */
export async function leaveSync() {
  try { if (cfg) await api('/sync/leave', {}) } catch { /* i tak odłączamy lokalnie */ }
  cfg = null; await save(); await db.syncmeta.clear(); set({ on: false, busy: false, err: '', at: undefined })
}
export const listDevices = async () => (await api('/sync/devices')).devices as { id: string; name: string; seen: number; created: number; me: boolean }[]
export const revokeDevice = async (id: string) => (await api('/sync/revoke', { device: id })).devices

let running: Promise<void> | null = null
export function syncNow(): Promise<void> {
  if (!running) running = cycle().finally(() => { running = null })
  return running
}

async function cycle() {
  await ready
  if (!cfg || !navigator.onLine) return
  set({ busy: true })
  try {
    const meta = new Map((await db.syncmeta.toArray()).map(m => [m.k, m.h]))
    const now = Date.now()
    // 1) co zmieniło się tutaj od ostatniej synchronizacji
    const local = new Map<string, Rec>()
    for (const [t, pk] of TABLES) {
      const tb = (db as any)[t]
      if (BIG.has(t)) {
        const keys: string[] = await tb.toCollection().primaryKeys()
        const have = new Set(keys)
        for (const k of keys) if (!meta.has(t + '|' + k) || dirtyBig.has(t + '|' + k)) local.set(t + '|' + k, { t, k, v: undefined, u: cfg.first ? 1 : now })
        for (const mk of meta.keys()) if (mk.startsWith(t + '|') && !have.has(mk.slice(t.length + 1))) local.set(mk, { t, k: mk.slice(t.length + 1), v: null, u: now })
      } else {
        const rows: any[] = await tb.toArray()
        const have = new Set<string>()
        for (const r of rows) {
          const k = String(r[pk]); have.add(k)
          if (meta.get(t + '|' + k) !== hashOf(t, r)) local.set(t + '|' + k, { t, k, v: r, u: cfg.first ? 1 : now })
        }
        for (const mk of meta.keys()) if (mk.startsWith(t + '|') && !have.has(mk.slice(t.length + 1))) local.set(mk, { t, k: mk.slice(t.length + 1), v: null, u: now })
      }
    }
    // 2) pobranie zmian z innych urządzeń
    const apply = async (r: Rec) => {
      const tb = (db as any)[r.t]; if (!tb) return
      const mk = r.t + '|' + r.k
      const mine = local.get(mk)
      if (mine && mine.u > r.u) return // tutaj jest nowsza zmiana – zostanie wysłana
      applying = true
      try {
        if (r.v === null) { await tb.delete(r.k); await db.syncmeta.delete(mk) }
        else { await tb.put(r.v); await db.syncmeta.put({ k: mk, h: hashOf(r.t, r.v) }) }
      } finally { applying = false }
      local.delete(mk); dirtyBig.delete(mk)
    }
    let pulled = 0
    for (;;) {
      const j = await api('/sync/pull?since=' + cfg.since)
      for (const r of j.records as Rec[]) await apply(r)
      pulled += j.records.length
      if (j.records.length) set({ progress: `Pobieram zmiany: ${pulled}` })
      cfg.since = j.last; await save()
      if (!j.more) break
    }
    // 3) wysłanie zmian z tego urządzenia (paczkami do ok. 4 MB)
    const todo = [...local.values()]
    let sent = 0, batch: Rec[] = [], size = 0
    const flush = async () => {
      if (!batch.length) return
      const j = await api('/sync/push', { records: batch })
      for (const r of j.newer ?? []) await apply(r) // na serwerze była nowsza wersja – przyjmujemy ją
      const newerKeys = new Set((j.newer ?? []).map((r: Rec) => r.t + '|' + r.k))
      for (const r of batch) {
        const mk = r.t + '|' + r.k
        if (newerKeys.has(mk)) continue
        if (r.v === null) await db.syncmeta.delete(mk); else await db.syncmeta.put({ k: mk, h: hashOf(r.t, r.v) })
        dirtyBig.delete(mk)
      }
      keepDirty()
      sent += batch.length; batch = []; size = 0
      set({ progress: todo.length > 30 ? `Wysyłam: ${sent} z ${todo.length}` : undefined })
    }
    for (const r of todo) {
      if (r.v === undefined) { r.v = await (db as any)[r.t].get(r.k) ?? null; if (r.v === null) continue }
      batch.push(r); size += r.v ? JSON.stringify(r.v).length : 50
      if (size > 4_000_000 || batch.length >= 800) await flush()
    }
    await flush()
    cfg.first = false; cfg.at = Date.now(); await save()
    set({ busy: false, err: '', at: cfg.at, progress: undefined })
  } catch (e: any) {
    if (e?.code === 'auth') { cfg = null; await save(); set({ on: false, busy: false, err: e.message, progress: undefined }); return }
    set({ busy: false, err: e?.message || 'Nie udało się zsynchronizować.', progress: undefined })
  }
}

/** Uruchamiane z App: synchronizacja przy starcie, po powrocie do aplikacji i co 30 s. */
export function startAutoSync() {
  const tick = () => { if (document.visibilityState === 'visible') syncNow() }
  setTimeout(tick, 1500)
  setInterval(tick, 30000)
  document.addEventListener('visibilitychange', tick)
  addEventListener('online', tick)
}
