import { useEffect, useState } from 'react'
import type { IndexItem } from '../lib/types'
import { loadIndex } from '../lib/data'
import { db } from '../lib/db'
import { useLiveQuery } from 'dexie-react-hooks'

export function useIndex(): IndexItem[] | null {
  const [ix, setIx] = useState<IndexItem[] | null>(null)
  useEffect(() => { loadIndex().then(setIx) }, [])
  return ix
}
export function useDemoted(): Set<string> {
  const r = useLiveQuery(() => db.settings.get('demoted'), [])
  return new Set<string>((r?.v as string[]) ?? [])
}
