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
export function useMine(): IndexItem[] {
  const mine = useLiveQuery(() => db.mine.orderBy('at').reverse().toArray(), [])
  return useMemo(() => (mine ?? []).map(toIndex), [mine])
}
export function useDemoted(): Set<string> {
  const r = useLiveQuery(() => db.settings.get('demoted'), [])
  return new Set<string>((r?.v as string[]) ?? [])
}
