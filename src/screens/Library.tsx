import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { fold } from '../lib/keys'
import { isMine } from '../lib/mine'
import { Search, SlidersHorizontal } from 'lucide-react'
import { useIndex, useDemoted } from '../components/hooks'
import { RecipeCard } from '../components/RecipeCard'
import { CATS, DIFF } from '../lib/types'
import { loadSearch } from '../lib/data'
import { FILTERS } from '../lib/filters'

const TIMES = [10, 20, 30, 45, 60, 999]
const DIETS: [string, string][] = [['wegetariańskie', 'Wege'], ['wegańskie', 'Wegańskie'], ['bezglutenowe', 'Bez glutenu']]
const PAGE = 40

// Cały stan filtrów żyje w adresie (#/odkrywaj?cat=obiad&sub=drob…), więc powrót z przepisu przywraca dokładnie ten sam widok.
export default function Library() {
  const ix = useIndex()
  const loc = useLocation()
  const [sp, setSp] = useSearchParams()
  const demoted = useDemoted()
  const cat = sp.get('cat') ?? ''
  const sub = sp.get('sub') ?? ''
  const quick = sp.get('max') !== null
  const maxMin = Number(sp.get('max')) || 999
  const maxDiff = Number(sp.get('diff')) || 4
  const diets = (sp.get('diet') ?? '').split(',').filter(Boolean)
  const sig = sp.get('sig') === '1'
  const sort = sp.get('sort') ?? 'rel'
  const urlQ = sp.get('q') ?? ''
  const [q, setQ] = useState(urlQ)
  useEffect(() => { setQ(urlQ) }, [urlQ])
  const [open, setOpen] = useState(false)

  // „Pokaż więcej” i miejsce przewinięcia pamiętane osobno dla każdego widoku (na czas sesji)
  const memKey = 'lib:' + loc.search
  const mem = useMemo(() => { try { return JSON.parse(sessionStorage.getItem(memKey) ?? 'null') as { n: number; y: number } | null } catch { return null } }, [memKey])
  const [limit, setLimit] = useState(mem?.n ?? PAGE)
  const restored = useRef('')
  useEffect(() => { setLimit(mem?.n ?? PAGE) }, [mem])

  const set = (patch: Record<string, string | null>, replace = true) => setSp(p => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') n.delete(k); else n.set(k, v) }
    return n
  }, { replace })

  const [hits, setHits] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (!urlQ.trim()) { setHits(null); return }
    let alive = true
    loadSearch().then(ms => { if (alive) setHits(new Set(ms.search(urlQ).map(h => String(h.id)))) })
    return () => { alive = false }
  }, [urlQ])
  const texts = useMemo(() => new Map((ix ?? []).map(r => [r.id, fold(r.title + ' ' + r.ingtext + ' ' + r.sum)])), [ix])
  const base = useMemo(() => (ix ?? []).filter(r => r.cat === cat), [ix, cat])
  const subs = cat ? FILTERS[cat] ?? [] : []
  const subDef = subs.find(x => x.id === sub)
  const list = useMemo(() => {
    if (!ix) return []
    let l = ix.filter(r => (!cat || r.cat === cat) && r.min <= maxMin && !(quick && maxMin <= 15 && ['napoj', 'sos', 'drink'].includes(r.cat)) && r.diff <= maxDiff && (!sig || (r.tags.includes('signature') && !demoted.has(r.id))) && diets.every(d => r.tags.includes(d)))
    if (subDef) l = l.filter(r => subDef.test(r, texts.get(r.id) ?? ''))
    if (hits) { const qt = fold(urlQ).split(/\s+/).filter(Boolean); l = l.filter(r => hits.has(r.id) || (isMine(r.id) && qt.every(t => fold(r.title + ' ' + r.ingtext + ' ' + r.sum + ' ' + r.cuisine).includes(t)))) }
    if (sort === 'time') l = [...l].sort((a, b) => a.min - b.min)
    else if (sort === 'diff') l = [...l].sort((a, b) => a.diff - b.diff)
    else if (sort === 'ing') l = [...l].sort((a, b) => a.ni - b.ni)
    else if (sort === 'az') l = [...l].sort((a, b) => a.title.localeCompare(b.title, 'pl'))
    return l
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ix, texts, subDef, cat, quick, maxMin, maxDiff, sp.get('diet'), sig, sort, hits, demoted, urlQ])

  // zapis i przywrócenie przewinięcia
  useEffect(() => {
    let t = 0
    const save = () => { clearTimeout(t); t = window.setTimeout(() => { try { sessionStorage.setItem(memKey, JSON.stringify({ n: limit, y: Math.round(scrollY) })) } catch { /* */ } }, 120) }
    save(); addEventListener('scroll', save, { passive: true })
    return () => { removeEventListener('scroll', save); clearTimeout(t) }
  }, [memKey, limit])
  useLayoutEffect(() => {
    if (!ix || restored.current === memKey) return
    restored.current = memKey
    if (mem?.y) requestAnimationFrame(() => scrollTo(0, mem.y))
  }, [ix, memKey, mem, list.length])

  const toggleDiet = (d: string) => set({ diet: (diets.includes(d) ? diets.filter(x => x !== d) : [...diets, d]).join(',') })
  const onSearch = (v: string) => { setQ(v); set({ q: v }) }
  return (
    <div className="page">
      <h1 className="ptitle">{cat ? CATS.find(c => c.id === cat)?.label : 'Odkrywaj'}</h1>
      <div className="searchbar"><Search size={18} />
        <input value={q} onChange={e => onSearch(e.target.value)} placeholder="Danie, składnik, kuchnia…" />
        <button className="iconbtn" onClick={() => setOpen(o => !o)} aria-label="Filtry"><SlidersHorizontal size={18} /></button>
      </div>
      {!cat ? (
        <div className="chips">
          {CATS.map(c => <button key={c.id} onClick={() => set({ cat: c.id, sub: null }, false)}>{c.label}</button>)}
        </div>
      ) : (
        <div className="chips">
          <button className="back" onClick={() => set({ cat: null, sub: null }, false)}>‹ Wszystkie kategorie</button>
          <button className={!sub ? 'on' : ''} onClick={() => set({ sub: null })}>Wszystkie</button>
          {subs.map(x => {
            const n = base.filter(r => x.test(r, texts.get(r.id) ?? '')).length
            return n ? <button key={x.id} className={sub === x.id ? 'on' : ''} onClick={() => set({ sub: sub === x.id ? null : x.id })}>{x.label} <small>{n}</small></button> : null
          })}
        </div>
      )}
      {open && (
        <div className="filters">
          <label>Czas: <b>{maxMin === 999 ? 'bez limitu' : 'do ' + maxMin + ' min'}</b>
            <div className="chips small">{TIMES.map(t => <button key={t} className={maxMin === t ? 'on' : ''} onClick={() => set({ max: t === 999 ? null : String(t) })}>{t === 999 ? '60+' : t}</button>)}</div></label>
          <label>Trudność: <b>{maxDiff === 4 ? 'dowolna' : 'do: ' + DIFF[maxDiff]}</b>
            <div className="chips small">{[1, 2, 3, 4].map(d => <button key={d} className={maxDiff === d ? 'on' : ''} onClick={() => set({ diff: d === 4 ? null : String(d) })}>{DIFF[d]}</button>)}</div></label>
          <label>Dieta
            <div className="chips small">{DIETS.map(([k, l]) => <button key={k} className={diets.includes(k) ? 'on' : ''} onClick={() => toggleDiet(k)}>{l}</button>)}
              <button className={sig ? 'on gold' : ''} onClick={() => set({ sig: sig ? null : '1' })}>★ Signature</button></div></label>
          <label>Sortuj
            <select value={sort} onChange={e => set({ sort: e.target.value === 'rel' ? null : e.target.value })}>
              <option value="rel">Trafność / kolejność</option><option value="time">Czas przygotowania</option>
              <option value="diff">Trudność</option><option value="ing">Liczba składników</option><option value="az">A–Z</option>
            </select></label>
        </div>
      )}
      <p className="muted">{ix ? `${list.length} przepisów` : 'Ładowanie…'}</p>
      <div className="grid">{list.slice(0, limit).map(r => <RecipeCard key={r.id} r={r} demoted={demoted.has(r.id)} />)}</div>
      {list.length > limit && <button className="btn ghost wide" onClick={() => setLimit(l => l + PAGE)}>Pokaż więcej</button>}
    </div>
  )
}
