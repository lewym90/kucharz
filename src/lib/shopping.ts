import type { Recipe } from './types'
import { db } from './db'
import { isStaple } from './keys'

// Kolejność ma znaczenie: przyprawy typu „papryka słodka” sprawdzamy przed warzywami, „masło orzechowe” przed nabiałem.
const DEPT: [string, RegExp][] = [
  ['Przyprawy i sosy', /papryka (słodka|wędzona|ostra|mielona)|pieprz|chili w płatkach|płatki chili|masło orzechowe|mleko kokosowe|czosnek granulowany|imbir mielony/i],
  ['Warzywa i owoce', /pomidor|ogórek|ogorek|cebul|czosnek|marchew|ziemniak|papryk|cukini|bakłaż|szpinak|sałat|rukol|brokuł|kalafior|seler|por\b|burak|dynia|jabłk|gruszk|banan|cytryn|limonk|pomarańcz|truskaw|malin|jagod|borówk|mango|awokado|ananas|kapust|jarmuż|pieczark|grzyb|natka|koperek|szczypiorek|bazyli|mięta|kolendr|rzodkiew|dymk|szalot|imbir|chili|morel|brzoskw|śliwk|winogron|melon|arbuz|fasolk|groszek|kukurydz|batat|rabarbar|figi|granat|wiśni|ćwikł|pietruszk|rozmaryn|tymianek|szałwi/i],
  ['Nabiał i jajka', /jajk|jajo|jaja|żółtk|białk|mleko|śmietan|masło|ser\b|sera|serek|parmezan|mozzarell|feta|ricotta|mascarpone|jogurt|maślank|kefir|twaróg|cheddar|gorgonzol|pecorino|halloumi/i],
  ['Mięso i wędliny', /kurczak|indyk|kacz|wołowin|wieprzow|schab|boczek|szynk|kiełbas|chorizo|salami|mięso|cielęc|jagnię|polędwic|żeberk|karkówk|łopatk|stek|prosciutto|wędlin/i],
  ['Ryby i owoce morza', /łosoś|dorsz|tuńczyk|śledź|krewetk|anchois|makrel|pstrąg|ryb|małż|kalmar|sardyn/i],
  ['Pieczywo i produkty sypkie', /chleb|bułk|bagiet|tortill|pita|mąk|makaron|spaghetti|ryż|kasza|kasz|płatki|kuskus|bulgur|ciasto|herbatnik|panko|bułka tarta|komosa|soczewic|ciecierzyc|fasol|nasion|orzech|migdał|sezam|mak\b|rodzynk|suszon/i],
  ['Przyprawy i sosy', /sól|kmin|kurkuma|cynamon|oregano|curry|garam|sos |ocet|olej|oliwa|musztard|ketchup|majonez|miód|cukier|proszek|soda|wanili|kakao|czekolad|pasta|koncentrat|bulion|drożdż|żelatyn|skrobia|syrop/i],
  ['Napoje i inne', /woda|sok|wino|piwo|rum|wódka|likier|herbata|kawa|lód|lodu/i],
]
export const DEPTS = [...new Set(DEPT.map(d => d[0])), 'Inne']
export function dept(name: string): string {
  for (const [d, re] of DEPT) if (re.test(name)) return d
  return 'Inne'
}
// g i kg (oraz ml i l) to ta sama pozycja na liście – sumujemy w gramach / mililitrach
const BASE: Record<string, [string, number]> = { kg: ['g', 1000], g: ['g', 1], l: ['ml', 1000], ml: ['ml', 1] }
export async function addRecipeToShopping(r: Recipe, serv: number) {
  const f = serv / r.serv
  const all = await db.shop.toArray()
  for (const i of r.ing) {
    // „do smaku” i dodatki „do podania” bez ilości (sól, pieprz…) nie trafiają na listę
    if (i.u === 'do smaku' || (i.u === 'do podania' && i.q == null) || (i.q == null && isStaple(i.k))) continue
    let q = i.q != null ? i.q * f : null
    let unit = i.u
    if (unit && BASE[unit] && q != null) { q *= BASE[unit][1]; unit = BASE[unit][0] }
    const key = i.k + '|' + (unit ?? '')
    const ex = all.find(x => x.key === key)
    if (ex) {
      const upd = { qty: ex.qty != null && q != null ? ex.qty + q : ex.qty ?? q, done: false, src: ex.src.split('; ').includes(r.title) ? ex.src : ex.src + '; ' + r.title }
      await db.shop.update(key, upd); Object.assign(ex, upd)
    } else {
      const row = { key, name: i.n.split(',')[0].replace(/\(.*?\)/g, '').trim(), qty: q, unit, dept: dept(i.n), done: false, src: r.title }
      await db.shop.put(row); all.push(row)
    }
  }
}
