import { useEffect, useMemo, useState } from 'react'
import type { IndexItem } from '../lib/types'
import { loadIndex } from '../lib/data'
import { db } from '../lib/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { toIndex } from '../lib/mine'

export function useIndex(): IndexItem[] | null {
  const [ix, setIx] = useState<IndexItem[] | null>(null)
  useEffect(() => { loadIndex().then(setIx) }, [])
  const mine = useLiveQuery(() => db.mine.toArray(), [])
  return useMemo(() => (ix ? [...(mine ?? []).map(toIndex), ...ix] : null), [ix, mine])
}
/** Moje przepisy: bez kanału (ch = undefined) albo tylko z danego kanału. */
export function useMine(ch?: string): IndexItem[] {
  const mine = useLiveQuery(() => db.mine.orderBy('at').reverse().toArray(), [])
  return useMemo(() => (mine ?? []).filter(m => (ch ? m.ch === ch : !m.ch)).map(toIndex), [mine, ch])
}
export function useChannels() {
  const colls = useLiveQuery(() => db.colls.toArray(), []) ?? []
  const mine = useLiveQuery(() => db.mine.toArray(), []) ?? []
  return useMemo(() => {
    const n: Record<string, number> = {}
    for (const m of mine) if (m.ch) n[m.ch] = (n[m.ch] ?? 0) + 1
    return colls.filter(c => c.id.startsWith('ch:')).map(c => ({ key: c.id.slice(3), name: c.name, url: c.url ?? '', count: n[c.id.slice(3)] ?? 0, at: c.at ?? 0 }))
      .sort((a, b) => a.at - b.at)
  }, [colls, mine])
}
export function useDemoted(): Set<string> {
  const r = useLiveQuery(() => db.settings.get('demoted'), [])
  return new Set<string>((r?.v as string[]) ?? [])
}
