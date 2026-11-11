import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, BookOpen, Refrigerator, CalendarDays, ShoppingCart, Shuffle, Zap, Star } from 'lucide-react'
import { useIndex } from '../components/hooks'
import { Section, catImg } from '../components/RecipeCard'
import { CATS } from '../lib/types'
import { db } from '../lib/db'

const todayStr = () => new Date().toISOString().slice(0, 10)
export default function Home() {
  const ix = useIndex()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const plan = useLiveQuery(() => db.plan.where('date').equals(todayStr()).toArray(), [])
  const byId = useMemo(() => new Map((ix ?? []).map(r => [r.id, r])), [ix])
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
      <Section title="Kategorie" more={<button className="link" onClick={surprise}><Shuffle size={14} /> Zaskocz mnie</button>}>
        <div className="cats">
          <Link to="/odkrywaj?max=15" className="cat special" style={{ backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.75)),url(${catImg('szybko')})` }}><b className="badge15"><Zap size={13} fill="currentColor" />15 min</b><span>Na szybko<small>do 15 minut</small></span></Link>
          <Link to="/odkrywaj?sig=1" className="cat special" style={{ backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.75)),url(${catImg('signature')})` }}><Star size={16} fill="currentColor" /><span>Signature<small>autorskie nowości</small></span></Link>
          {CATS.map(c => (
          <Link key={c.id} to={'/odkrywaj?cat=' + c.id} className="cat" style={{ backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.75)),url(${catImg(c.id)})` }}><span>{c.label}</span></Link>
        ))}</div>
      </Section>
      {!ix && <p className="muted center">Ładowanie przepisów…</p>}
    </div>
  )
}
