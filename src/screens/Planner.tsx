import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Plus, Trash2, ShoppingCart, Search } from 'lucide-react'
import { useIndex } from '../components/hooks'
import { db } from '../lib/db'
import { loadRecipe } from '../lib/data'
import { addRecipeToShopping } from '../lib/shopping'

const SLOTS = ['Śniadanie', 'II śniadanie', 'Obiad', 'Podwieczorek', 'Kolacja']
const DAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb']
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export default function Planner() {
  const ix = useIndex()
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d })
  const [pick, setPick] = useState<{ date: string; slot: string } | null>(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const days = useMemo(() => Array.from({ length: 7 }, (_, k) => { const d = new Date(start); d.setDate(d.getDate() + k); return d }), [start])
  const from = iso(days[0]), to = iso(days[6])
  const items = useLiveQuery(() => db.plan.where('date').between(from, to, true, true).toArray(), [from, to]) ?? []
  const byId = useMemo(() => new Map((ix ?? []).map(r => [r.id, r])), [ix])
  const results = useMemo(() => {
    const f = q.trim().toLowerCase(); if (!f || !ix) return []
    return ix.filter(r => r.title.toLowerCase().includes(f)).slice(0, 12)
  }, [q, ix])
  const shift = (n: number) => setStart(s => { const d = new Date(s); d.setDate(d.getDate() + n); return d })
  const toShopping = async () => {
    for (const p of items) { const r = await loadRecipe(p.rid); if (r) await addRecipeToShopping(r, p.serv) }
    setMsg(`Dodano ${items.length} przepisów do listy zakupów`); setTimeout(() => setMsg(''), 2500)
  }
  return (
    <div className="page">
      <h1 className="ptitle">Planer</h1>
      <div className="weeknav"><button className="iconbtn" onClick={() => shift(-7)}><ChevronLeft /></button>
        <b>{days[0].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} – {days[6].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}</b>
        <button className="iconbtn" onClick={() => shift(7)}><ChevronRight /></button></div>
      {days.map(d => { const ds = iso(d); const di = items.filter(p => p.date === ds); return (
        <section key={ds} className={'day' + (ds === iso(new Date()) ? ' today' : '')}>
          <h3>{DAYS[d.getDay()]} {d.getDate()}.{String(d.getMonth() + 1).padStart(2, '0')}</h3>
          {SLOTS.map(s => { const si = di.filter(p => p.slot === s); return (
            <div key={s} className="slot"><span className="sl">{s}</span>
              <div className="sitems">{si.map(p => { const r = byId.get(p.rid); return (
                <div key={p.key} className="sitem"><Link to={'/przepis/' + encodeURIComponent(p.rid)}>{r?.title ?? p.rid}</Link><button className="iconbtn" onClick={() => db.plan.delete(p.key)}><Trash2 size={15} /></button></div>) })}
                <button className="add" onClick={() => setPick({ date: ds, slot: s })}><Plus size={14} /></button></div>
            </div>) })}
        </section>) })}
      <button className="btn gold wide" onClick={toShopping} disabled={!items.length}><ShoppingCart size={18} /> Dodaj cały tydzień do zakupów</button>
      {msg && <div className="toast">{msg}</div>}
      {pick && (
        <div className="modal" onClick={() => setPick(null)}><div className="sheet" onClick={e => e.stopPropagation()}>
          <h3>{pick.slot} · {pick.date}</h3>
          <div className="searchbar"><Search size={18} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj przepisu…" /></div>
          <div className="list">{results.map(r => <button key={r.id} className="row" onClick={async () => { await db.plan.put({ key: `${pick.date}|${pick.slot}|${r.id}`, date: pick.date, slot: pick.slot, rid: r.id, serv: r.serv }); setPick(null); setQ('') }}><span>{r.title}</span></button>)}</div>
        </div></div>
      )}
    </div>
  )
}
