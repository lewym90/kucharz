import MiniSearch from 'minisearch'
import type { CatalogItem, IndexItem, Recipe } from './types'

const base = import.meta.env.BASE_URL + 'data/'
let indexP: Promise<IndexItem[]> | null = null
let catalogP: Promise<CatalogItem[]> | null = null
let searchP: Promise<MiniSearch<IndexItem>> | null = null
const packs = new Map<string, Promise<Recipe[]>>()

export const loadIndex = () => (indexP ??= fetch(base + 'index.json').then(r => r.json()))
export const loadCatalog = () => (catalogP ??= fetch(base + 'ingredients.json').then(r => r.json()))
export const loadPack = (cat: string) => {
  if (!packs.has(cat)) packs.set(cat, fetch(base + cat + '.json').then(r => r.json()))
  return packs.get(cat)!
}
export async function loadRecipe(id: string, cat?: string): Promise<Recipe | undefined> {
  if (!cat) { const ix = await loadIndex(); cat = ix.find((r: IndexItem) => r.id === id)?.cat }
  if (!cat) return undefined
  return (await loadPack(cat)).find((r: Recipe) => r.id === id)
}
export const loadSearch = () => (searchP ??= loadIndex().then(ix => {
  const ms = new MiniSearch<IndexItem>({
    fields: ['title', 'ingtext', 'cuisine', 'sum'],
    storeFields: [],
    searchOptions: { boost: { title: 4, ingtext: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
    processTerm: t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l'),
  })
  ms.addAll(ix); return ms
}))
