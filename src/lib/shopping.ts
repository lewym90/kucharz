import type { Recipe } from './types'
import { db, ShopItem } from './db'

const DEPT: [string, RegExp][] = [
  ['Warzywa i owoce', /pomidor|ogórek|ogorek|cebul|czosnek|marchew|ziemniak|papryk|cukini|bakłaż|szpinak|sałat|rukol|brokuł|kalafior|seler|por\b|burak|dynia|jabłk|gruszk|banan|cytryn|limonk|pomarańcz|truskaw|malin|jagod|borówk|mango|awokado|ananas|kapust|jarmuż|pieczark|grzyb|natka|koperek|szczypiorek|bazyli|mięta|kolendr|rzodkiew|dymk|szalot|imbir|chili|morel|brzoskw|śliwk|winogron|melon|arbuz|fasolk|groszek|kukurydz|batat|rabarbar|figi|granat|wiśni|ćwikł|pietruszk|rozmaryn|tymianek|szałwi/i],
  ['Nabiał i jajka', /jajk|jajo|żółtk|mleko|śmietan|masło|ser\b|sera|serek|parmezan|mozzarell|feta|ricotta|mascarpone|jogurt|maślank|kefir|twaróg|cheddar|gorgonzol|pecorino|halloumi/i],
  ['Mięso i wędliny', /kurczak|indyk|kacz|wołowin|wieprzow|schab|boczek|szynk|kiełbas|chorizo|salami|mięso|cielęc|jagnię|polędwic|żeberk|karkówk|łopatk|stek|prosciutto|wędlin/i],
  ['Ryby i owoce morza', /łosoś|dorsz|tuńczyk|śledź|krewetk|anchois|makrel|pstrąg|ryb|małż|kalmar|sardyn/i],
  ['Pieczywo i produkty sypkie', /chleb|bułk|bagiet|tortill|pita|mąk|makaron|spaghetti|ryż|kasza|kasz|płatki|kuskus|bulgur|ciasto|herbatnik|panko|bułka tarta|komosa|soczewic|ciecierzyc|fasol|nasion|orzech|migdał|sezam|mak\b|rodzynk|suszon/i],
  ['Przyprawy i sosy', /sól|pieprz|papryka (słodka|wędzona|ostra)|kmin|kurkuma|cynamon|oregano|curry|garam|sos |ocet|olej|oliwa|musztard|ketchup|majonez|miód|cukier|proszek|soda|wanili|kakao|czekolad|pasta|koncentrat|bulion|drożdż|żelatyn|skrobia|syrop/i],
  ['Napoje i inne', /woda|sok|wino|piwo|rum|wódka|likier|herbata|kawa|lód|lodu/i],
]
export const DEPTS = [...DEPT.map(d => d[0]), 'Inne']
export function dept(name: string): string {
  for (const [d, re] of DEPT) if (re.test(name)) return d
  return 'Inne'
}
export async function addRecipeToShopping(r: Recipe, serv: number) {
  const f = serv / r.serv
  const all = await db.shop.toArray()
  for (const i of r.ing) {
    if (i.u === 'do smaku' || i.u === 'do podania' && !i.q) { /* przyprawy dodajemy bez ilości */ }
    const q = i.q != null ? i.q * f : null
    const key = i.k + '|' + (i.u ?? '')
    const ex = all.find(x => x.key === key)
    if (ex) { await db.shop.update(key, { qty: ex.qty != null && q != null ? ex.qty + q : ex.qty, src: ex.src.includes(r.title) ? ex.src : ex.src + '; ' + r.title }) }
    else await db.shop.put({ key, name: i.n.split(',')[0].replace(/\(.*?\)/g, '').trim(), qty: q, unit: i.u, dept: dept(i.n), done: false, src: r.title })
  }
}
