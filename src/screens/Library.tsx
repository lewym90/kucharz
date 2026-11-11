import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, SlidersHorizontal } from 'lucide-react'
import { useIndex, useDemoted } from '../components/hooks'
import { RecipeCard } from '../components/RecipeCard'
import { CATS, DIFF } from '../lib/types'
import { loadSearch } from '../lib/data'

const TIMES = [10, 20, 30, 45, 60, 999]
const DIETS: [string, string][] = [['wegetariańskie', 'Wege'], ['wegańskie', 'Wegańskie'], ['bezglutenowe', 'Bez glutenu']]
export default function Library() {
  const ix = useIndex()
  const [sp, setSp] = useSearchParams()
  const demoted = useDemoted()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [cat, setCat] = useState(sp.get('cat') ?? '')
  const [maxMin, setMaxMin] = useState(999)
  const [maxDiff, setMaxDiff] = useState(4)
  const [diets, setDiets] = useState<string[]>([])
  const [sig, setSig] = useState(sp.get('sig') === '1')
  const [sort, setSort] = useState('rel')
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(40)
  const [hits, setHits] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (!q.trim()) { setHits(null); return }
    let alive = true
    loadSearch().then(ms => { if (alive) setHits(new Set(ms.search(q).map(h => String(h.id)))) })
    return () => { alive = false }
  }, [q])
  useEffect(() => setLimit(40), [q, cat, maxMin, maxDiff, diets, sig, sort])
  const list = useMemo(() => {
    if (!ix) return []
    let l = ix.filter(r => (!cat || r.cat === cat) && r.min <= maxMin && r.diff <= maxDiff && (!sig || (r.tags.includes('signature') && !demoted.has(r.id))) && diets.every(d => r.tags.includes(d)))
    if (hits) l = l.filter(r => hits.has(r.id))
    if (sort === 'time') l = [...l].sort((a, b) => a.min - b.min)
    else if (sort === 'diff') l = [...l].sort((a, b) => a.diff - b.diff)
    else if (sort === 'ing') l = [...l].sort((a, b) => a.ni - b.ni)
    else if (sort === 'az') l = [...l].sort((a, b) => a.title.localeCompare(b.title, 'pl'))
    return l
  }, [ix, cat, maxMin, maxDiff, diets, sig, sort, hits, demoted])
  const toggleDiet = (d: string) => setDiets(x => x.includes(d) ? x.filter(y => y !== d) : [...x, d])
  return (
    <div className="page">
      <h1 className="ptitle">Odkrywaj</h1>
      <div className="searchbar"><Search size={18} />
        <input value={q} onChange={e => { setQ(e.target.value); setSp(p => { if (e.target.value) p.set('q', e.target.value); else p.delete('q'); return p }, { replace: true }) }} placeholder="Danie, składnik, kuchnia…" />
        <button className="iconbtn" onClick={() => setOpen(o => !o)} aria-label="Filtry"><SlidersHorizontal size={18} /></button>
      </div>
      <div className="chips">
        <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>Wszystko</button>
        {CATS.map(c => <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.label}</button>)}
      </div>
      {open && (
        <div className="filters">
          <label>Czas: <b>{maxMin === 999 ? 'bez limitu' : 'do ' + maxMin + ' min'}</b>
            <div className="chips small">{TIMES.map(t => <button key={t} className={maxMin === t ? 'on' : ''} onClick={() => setMaxMin(t)}>{t === 999 ? '60+' : t}</button>)}</div></label>
          <label>Trudność: <b>{maxDiff === 4 ? 'dowolna' : 'do: ' + DIFF[maxDiff]}</b>
            <div className="chips small">{[1, 2, 3, 4].map(d => <button key={d} className={maxDiff === d ? 'on' : ''} onClick={() => setMaxDiff(d)}>{DIFF[d]}</button>)}</div></label>
          <label>Dieta
            <div className="chips small">{DIETS.map(([k, l]) => <button key={k} className={diets.includes(k) ? 'on' : ''} onClick={() => toggleDiet(k)}>{l}</button>)}
              <button className={sig ? 'on gold' : ''} onClick={() => setSig(s => !s)}>★ Signature</button></div></label>
          <label>Sortuj
            <select value={sort} onChange={e => setSort(e.target.value)}>
              <option value="rel">Trafność / kolejność</option><option value="time">Czas przygotowania</option>
              <option value="diff">Trudność</option><option value="ing">Liczba składników</option><option value="az">A–Z</option>
            </select></label>
        </div>
      )}
      <p className="muted">{ix ? `${list.length} przepisów` : 'Ładowanie…'}</p>
      <div className="grid">{list.slice(0, limit).map(r => <RecipeCard key={r.id} r={r} demoted={demoted.has(r.id)} />)}</div>
      {list.length > limit && <button className="btn ghost wide" onClick={() => setLimit(l => l + 40)}>Pokaż więcej</button>}
    </div>
  )
}
