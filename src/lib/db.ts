import Dexie, { Table } from 'dexie'
import type { Recipe } from './types'

export type Fav = { id: string; at: number }
export type Rating = { id: string; stars: number; note: string; cooked: boolean; at: number }
export type PlanItem = { key: string; date: string; slot: string; rid: string; serv: number }
export type ShopItem = { key: string; name: string; qty: number | null; unit: string | null; dept: string; done: boolean; src: string }
export type Pantry = { k: string; label: string; at: number }
export type Hist = { id: string; at: number }
export type Setting = { k: string; v: any }
export type Mine = Recipe & { at: number }
export type PhotoRow = { id: string; data: string }
export type Collection = { id: string; name: string; rids: string[] }

class KDB extends Dexie {
  favs!: Table<Fav, string>
  ratings!: Table<Rating, string>
  plan!: Table<PlanItem, string>
  shop!: Table<ShopItem, string>
  pantry!: Table<Pantry, string>
  hist!: Table<Hist, string>
  settings!: Table<Setting, string>
  colls!: Table<Collection, string>
  mine!: Table<Mine, string>
  photos!: Table<PhotoRow, string>
  thumbs!: Table<PhotoRow, string>
  constructor() {
    super('ksiazka-kucharska')
    this.version(1).stores({
      favs: 'id,at', ratings: 'id,at', plan: 'key,date', shop: 'key,dept,done', pantry: 'k', hist: 'id,at', settings: 'k', colls: 'id',
    })
    this.version(2).stores({ mine: 'id,at' })
    this.version(3).stores({ photos: 'id', thumbs: 'id' })
  }
}
export const db = new KDB()

export async function getSetting<T>(k: string, def: T): Promise<T> {
  const r = await db.settings.get(k); return r ? (r.v as T) : def
}
export const setSetting = (k: string, v: any) => db.settings.put({ k, v })

const TABLES = ['favs', 'ratings', 'plan', 'shop', 'pantry', 'hist', 'settings', 'colls', 'mine', 'photos', 'thumbs'] as const
export async function exportBackup(): Promise<string> {
  const out: any = { app: 'ksiazka-kucharska', version: 1, at: new Date().toISOString() }
  for (const t of TABLES) out[t] = await (db as any)[t].toArray()
  return JSON.stringify(out)
}
export async function importBackup(json: string) {
  const d = JSON.parse(json)
  if (d.app !== 'ksiazka-kucharska') throw new Error('To nie jest kopia zapasowa Książki Kucharskiej.')
  await db.transaction('rw', TABLES.map(t => (db as any)[t]), async () => {
    for (const t of TABLES) { await (db as any)[t].clear(); if (Array.isArray(d[t])) await (db as any)[t].bulkPut(d[t]) }
  })
}
