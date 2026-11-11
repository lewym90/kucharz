import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, BookOpen, Refrigerator, CalendarDays, ShoppingCart, Shuffle } from 'lucide-react'
import { useIndex, useDemoted } from '../components/hooks'
import { RecipeCard, Section, catImg } from '../components/RecipeCard'
import { CATS } from '../lib/types'
import { db } from '../lib/db'

const todayStr = () => new Date().toISOString().slice(0, 10)
export default function Home() {
  const ix = useIndex()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const demoted = useDemoted()
  const hist = useLiveQuery(() => db.hist.orderBy('at').reverse().limit(8).toArray(), [])
  const plan = useLiveQuery(() => db.plan.where('date').equals(todayStr()).toArray(), [])
  const byId = useMemo(() => new Map((ix ?? []).map(r => [r.id, r])), [ix])
  const quick = useMemo(() => (ix ?? []).filter(r => r.min <= 15 && r.cat !== 'napoj' && r.cat !== 'sos').slice(0, 400), [ix])
  const quickPick = useMemo(() => [...quick].sort(() => Math.random() - 0.5).slice(0, 8), [quick])
  const sigPick = useMemo(() => [...(ix ?? []).filter(r => r.tags.includes('signature') && !demoted.has(r.id))].sort(() => Math.random() - 0.5).slice(0, 8), [ix, demoted])
  const surprise = () => {
    const pool = (ix ?? []).filter(r => ['obiad', 'kolacja', 'makaron', 'zupa'].includes(r.cat))
    if (pool.length) nav('/przepis/' + encodeURIComponent(pool[Math.floor(Math.random() * pool.length)].id))
  }
  return (
    <div className="page">
      <header className="hero" style={{ backgroundImage: `linear-gradient(180deg,rgba(11,11,12,.15),rgba(11,11,12,.92)),url(${import.meta.env.BASE_URL}img/hero-steak.webp)` }}>
        <div className="brand"><img src={import.meta.env.BASE_URL + 'img/logo.webp'} alt="" /><span>Książka Kucharska</span></div>
        <h1>Co dziś gotujemy?</h1>
        <form onSubmit={e => { e.preventDefault(); nav('/odkrywaj?q=' + encodeURIComponent(q)) }} className="searchbar">
          <Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj dania lub składnika…" />
        </form>
      </header>
      <div className="shortcuts">
        <Link to="/odkrywaj"><BookOpen size={22} /><span>Przepisy</span></Link>
        <Link to="/lodowka"><Refrigerator size={22} /><span>Moja lodówka</span></Link>
        <Link to="/plan"><CalendarDays size={22} /><span>Planer</span></Link>
        <Link to="/zakupy"><ShoppingCart size={22} /><span>Zakupy</span></Link>
      </div>
      {plan && plan.length > 0 && (
        <Section title="Twój plan na dziś">
          <div className="list">{plan.map(p => { const r = byId.get(p.rid); return r ? <Link key={p.key} className="row" to={'/przepis/' + encodeURIComponent(r.id)}><b>{p.slot}</b><span>{r.title}</span></Link> : null })}</div>
        </Section>
      )}
      {hist && hist.length > 0 && (
        <Section title="Kontynuuj">
          <div className="hscroll">{hist.map(h => byId.get(h.id)).filter(Boolean).map(r => <div key={r!.id} className="hitem"><RecipeCard r={r!} demoted={demoted.has(r!.id)} /></div>)}</div>
        </Section>
      )}
      <Section title="Na szybko (do 15 min)" more={<button className="link" onClick={surprise}><Shuffle size={14} /> Zaskocz mnie</button>}>
        <div className="hscroll">{quickPick.map(r => <div key={r.id} className="hitem"><RecipeCard r={r} demoted={demoted.has(r.id)} /></div>)}</div>
      </Section>
      <Section title="Signature – autorskie nowości" more={<Link className="link" to="/odkrywaj?sig=1">Wszystkie</Link>}>
        <div className="hscroll">{sigPick.map(r => <div key={r.id} className="hitem"><RecipeCard r={r} /></div>)}</div>
      </Section>
      <Section title="Kategorie">
        <div className="cats">{CATS.map(c => (
          <Link key={c.id} to={'/odkrywaj?cat=' + c.id} className="cat" style={{ backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.75)),url(${catImg(c.id)})` }}><span>{c.label}</span></Link>
        ))}</div>
      </Section>
      {!ix && <p className="muted center">Ładowanie przepisów…</p>}
    </div>
  )
}
