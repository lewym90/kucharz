import { useSyncExternalStore } from 'react'
import { liveQuery } from 'dexie'
import { db } from './db'

export type PhotoPair = { full: string; thumb: string }

function draw(src: CanvasImageSource, w: number, h: number, max: number, q: number): string {
  const k = Math.min(1, max / Math.max(w, h))
  const cw = Math.round(w * k), ch = Math.round(h * k)
  const c = document.createElement('canvas'); c.width = cw; c.height = ch
  c.getContext('2d')!.drawImage(src, 0, 0, cw, ch)
  return c.toDataURL('image/jpeg', q)
}

/** Zdjęcie z aparatu/galerii → pomniejszona kopia (1100 px) + miniatura (260 px). */
export async function processPhoto(file: File): Promise<PhotoPair> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Nie mogę odczytać tego zdjęcia.')); i.src = url
    })
    const w = img.naturalWidth, h = img.naturalHeight
    return { full: draw(img, w, h, 1100, 0.8), thumb: draw(img, w, h, 260, 0.75) }
  } finally { URL.revokeObjectURL(url) }
}

export async function putPhoto(id: string, p: PhotoPair) {
  await db.transaction('rw', db.photos, db.thumbs, async () => {
    await db.photos.put({ id, data: p.full }); await db.thumbs.put({ id, data: p.thumb })
  })
}
export async function delPhoto(id: string) {
  await db.transaction('rw', db.photos, db.thumbs, async () => { await db.photos.delete(id); await db.thumbs.delete(id) })
}

// wspólny, jeden nasłuch miniatur dla wszystkich kart na liście
let thumbs = new Map<string, string>()
const subs = new Set<() => void>()
let started = false
function start() {
  if (started) return; started = true
  liveQuery(() => db.thumbs.toArray()).subscribe({ next: rows => { thumbs = new Map(rows.map(r => [r.id, r.data])); subs.forEach(f => f()) }, error: () => {} })
}
export function useThumb(id: string): string | undefined {
  start()
  const m = useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => thumbs)
  return m.get(id)
}
