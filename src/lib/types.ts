export type Ing = { n: string; q: number | null; u: string | null; k: string }
export type Recipe = {
  id: string; title: string; cat: string; min: number; rest: number; diff: number; serv: number
  cuisine: string; tags: string[]; sum: string; ing: Ing[]; steps: string[]; tip: string | null
  src: string; lic: string
}
export type IndexItem = {
  id: string; title: string; cat: string; min: number; rest: number; diff: number; serv: number
  cuisine: string; tags: string[]; sum: string; req: string[]; opt: string[]; ni: number; ingtext: string
}
export type CatalogItem = { k: string; l: string; c: number; s: number }
export const CATS: { id: string; label: string }[] = [
  { id: 'sniadanie', label: 'Śniadania' }, { id: 'obiad', label: 'Obiady' }, { id: 'zupa', label: 'Zupy' },
  { id: 'makaron', label: 'Makarony' }, { id: 'kolacja', label: 'Kolacje' }, { id: 'salatka', label: 'Sałatki' },
  { id: 'przekaska', label: 'Przekąski' }, { id: 'ciasto', label: 'Ciasta' }, { id: 'deser', label: 'Desery' },
  { id: 'napoj', label: 'Napoje' }, { id: 'drink', label: 'Drinki' }, { id: 'sos', label: 'Sosy' },
]
export const catLabel = (id: string) => CATS.find(c => c.id === id)?.label ?? id
export const DIFF = ['', 'Bardzo łatwe', 'Łatwe', 'Średnie', 'Trudne']
