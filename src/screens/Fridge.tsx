import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, Search } from 'lucide-react'
import { useIndex, useDemoted } from '../components/hooks'
import { RecipeCard } from '../components/RecipeCard'
import { loadCatalog } from '../lib/data'
import type { CatalogItem } from '../lib/types'
import { db, getSetting, setSetting } from '../lib/db'
import { matchRecipes } from '../lib/fridge'
import { DIFF } from '../lib/types'

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
export default function Fridge() {
  const ix = useIndex()
  const demoted = useDemoted()
  const [cat, setCat] = useState<CatalogItem[]>([])
  const [q, setQ] = useState('')
  const [maxMin, setMaxMin] = useState(30)
  const [maxDiff, setMaxDiff] = useState(4)
  const [maxMissing, setMaxMissing] = useState(2)
  const [limit, setLimit] = useState(30)
  const [eq, setEq] = useState('')
  const have = useLiveQuery(() => db.pantry.toArray(), []) ?? []
  const [excl, setExcl] = useState<string[]>([])
  useEffect(() => { loadCatalog().then(setCat); getSetting<string[]>('exclude', []).then(setExcl) }, [])
  const sugg = useMemo(() => {
    const f = fold(q.trim()); if (f.length < 2) return []
    const haveSet = new Set(have.map(h => h.k))
    return cat.filter(c => !c.s && !haveSet.has(c.k) && fold(c.l).includes(f)).slice(0, 8)
  }, [q, cat, have])
  const res = useMemo(() => ix ? matchRecipes(ix, { have: new Set(have.map(h => h.k)), maxMin, maxDiff, maxMissing, exclude: new Set(excl), useOpt: false }) : [], [ix, have, maxMin, maxDiff, maxMissing, excl])
  const exSugg = useMemo(() => { const f = fold(eq.trim()); if (f.length < 2) return []; return cat.filter(c => !c.s && !excl.includes(c.k) && fold(c.l).includes(f)).slice(0, 6) }, [eq, cat, excl])
  const addEx = (c: CatalogItem) => { const n = [...excl, c.k]; setExcl(n); setSetting('exclude', n); setEq('') }
  const rmEx = (k: string) => { const n = excl.filter(x => x !== k); setExcl(n); setSetting('exclude', n) }
  const add = (c: CatalogItem) => { db.pantry.put({ k: c.k, label: c.l, at: Date.now() }); setQ('') }
  const popular = useMemo(() => cat.filter(c => !c.s).slice(0, 24), [cat])
  return (
    <div className="page">
      <h1 className="ptitle">Moja lodówka</h1>
      <p className="muted">Zaznacz, co masz w domu. Sól, pieprz, woda, olej, oliwa i cukier liczą się jako zapasy podstawowe.</p>
      <div className="searchbar"><Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Dodaj składnik, np. jajka, pieczarki…" /></div>
      {sugg.length > 0 && <div className="sugg">{sugg.map(c => <button key={c.k} onClick={() => add(c)}>{c.l}</button>)}</div>}
      <div className="chips wrap">{have.map(h => <button key={h.k} className="on" onClick={() => db.pantry.delete(h.k)}>{h.label} <X size={13} /></button>)}</div>
      {have.length === 0 && <><p className="muted">Szybki wybór:</p><div className="chips wrap">{popular.map(c => <button key={c.k} onClick={() => add(c)}>{c.l}</button>)}</div></>}
      {have.length > 0 && <button className="link" onClick={() => db.pantry.clear()}>Wyczyść lodówkę</button>}
      <details className="filters"><summary>Wykluczone składniki i alergeny ({excl.length})</summary>
        <div className="searchbar"><Search size={18} /><input value={eq} onChange={e => setEq(e.target.value)} placeholder="Np. orzechy, mleko, grzyby…" /></div>
        {exSugg.length > 0 && <div className="sugg">{exSugg.map(c => <button key={c.k} onClick={() => addEx(c)}>{c.l}</button>)}</div>}
        <div className="chips wrap">{excl.map(k => <button key={k} className="on" onClick={() => rmEx(k)}>{cat.find(c => c.k === k)?.l ?? k} <X size={13} /></button>)}</div>
      </details>
      <div className="filters">
        <label>Maks. czas: <b>{maxMin} min</b><input type="range" min={10} max={120} step={5} value={maxMin} onChange={e => setMaxMin(+e.target.value)} /></label>
        <label>Brakujące składniki: <b>do {maxMissing}</b><input type="range" min={0} max={6} value={maxMissing} onChange={e => setMaxMissing(+e.target.value)} /></label>
        <label>Trudność: <b>{maxDiff === 4 ? 'dowolna' : 'do: ' + DIFF[maxDiff]}</b><input type="range" min={1} max={4} value={maxDiff} onChange={e => setMaxDiff(+e.target.value)} /></label>
      </div>
      {have.length > 0 && <p className="muted">{res.length} pasujących przepisów</p>}
      <div className="grid">{res.slice(0, limit).map(m => (
        <div key={m.r.id} className="mwrap">
          <RecipeCard r={m.r} badge={m.pct + '%'} demoted={demoted.has(m.r.id)} />
          {m.missing.length > 0 && <p className="missing">Brakuje: {m.missing.slice(0, 4).map(k => cat.find(c => c.k === k)?.l ?? k).join(', ')}{m.missing.length > 4 ? '…' : ''}</p>}
        </div>))}</div>
      {res.length > limit && <button className="btn ghost wide" onClick={() => setLimit(l => l + 30)}>Pokaż więcej</button>}
    </div>
  )
}
