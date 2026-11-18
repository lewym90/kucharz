import { useSyncExternalStore } from 'react'

// Minutniki liczone od godziny zakończenia (endAt), a nie „co sekundę minus jeden” – dzięki temu są dokładne
// także wtedy, gdy telefon zgasi ekran albo przejdziesz do innej aplikacji. Żyją poza ekranem gotowania
// (zapis w localStorage), więc wyjście z trybu gotowania ich nie kasuje.
export type Timer = { id: number; label: string; rid: string; total: number; endAt: number | null; left: number; done: boolean; rang: boolean }
const KEY = 'kucharz-timers'
let timers: Timer[] = load()
const subs = new Set<() => void>()
let tick = 0

function load(): Timer[] { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(timers)) } catch { /* */ } }
function emit() { timers = [...timers]; save(); subs.forEach(f => f()); schedule() }
export const leftOf = (t: Timer, now = Date.now()) => (t.done ? 0 : t.endAt ? Math.max(0, Math.ceil((t.endAt - now) / 1000)) : t.left)

function check() {
  const now = Date.now(); let changed = false
  for (const t of timers) {
    if (!t.done && t.endAt && t.endAt <= now) { t.done = true; t.endAt = null; t.left = 0; changed = true }
    if (t.done && !t.rang) { t.rang = true; changed = true; alarm() }
  }
  if (changed) emit(); else { timers = [...timers]; subs.forEach(f => f()) }
}
function schedule() {
  const running = timers.some(t => t.endAt && !t.done)
  if (running && !tick) tick = window.setInterval(check, 500)
  if (!running && tick) { clearInterval(tick); tick = 0 }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
schedule(); setTimeout(check, 300)

export function addTimer(label: string, sec: number, rid: string) {
  unlockAudio()
  timers.push({ id: Date.now() + Math.random(), label, rid, total: sec, endAt: Date.now() + sec * 1000, left: sec, done: false, rang: false }); emit()
}
export function toggleTimer(id: number) {
  unlockAudio()
  const t = timers.find(x => x.id === id); if (!t || t.done) return
  if (t.endAt) { t.left = leftOf(t); t.endAt = null } else t.endAt = Date.now() + t.left * 1000
  emit()
}
export function removeTimer(id: number) { timers = timers.filter(x => x.id !== id); stopAlarm(); emit() }
export const hasTimers = () => timers.length > 0
export function useTimers(): Timer[] {
  return useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => timers)
}

// ── dźwięk ──
// iPhone gra dźwięk tylko z elementu odblokowanego dotknięciem; audioSession „playback” omija przełącznik wyciszenia.
let audio: HTMLAudioElement | null = null
let stopT = 0
function wav(): string {
  const rate = 16000, len = rate * 2, buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true)
  for (let i = 0; i < len; i++) {
    const t = i / rate, seg = Math.floor(t / 0.25), on = seg % 2 === 0 && t < 1.5
    const f = seg % 4 === 0 ? 880 : 1175
    v.setInt16(44 + i * 2, on ? Math.sin(2 * Math.PI * f * t) * 0.45 * 32767 : 0, true)
  }
  let bin = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i])
  return 'data:audio/wav;base64,' + btoa(bin)
}
export function unlockAudio() {
  try { const s = (navigator as any).audioSession; if (s) s.type = 'playback' } catch { /* */ }
  if (audio) return
  try {
    audio = new Audio(wav()); audio.preload = 'auto'
    audio.muted = true
    audio.play().then(() => { audio!.pause(); audio!.currentTime = 0; audio!.muted = false }).catch(() => { if (audio) audio.muted = false })
  } catch { audio = null }
}
function alarm() {
  try { navigator.vibrate?.([400, 200, 400, 200, 400]) } catch { /* */ }
  if (!audio) return
  try { audio.loop = true; audio.currentTime = 0; audio.play().catch(() => {}) } catch { /* */ }
  clearTimeout(stopT); stopT = window.setTimeout(stopAlarm, 30000)
}
export function stopAlarm() { try { if (audio) { audio.pause(); audio.loop = false; audio.currentTime = 0 } } catch { /* */ } }
