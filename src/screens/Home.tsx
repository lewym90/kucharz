import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, BookOpen, Refrigerator, CalendarDays, ShoppingCart, Dices, Zap, Crown, ChevronRight, Bell, ScanLine, X, Timer, Tv } from 'lucide-react'
import { useIndex } from '../components/hooks'
import { catImg } from '../components/RecipeCard'
import { Logo, UI } from '../components/Gold'
import { CATS } from '../lib/types'
import { db } from '../lib/db'
import { todayLocal } from '../lib/format'
import { leftOf, useTimers } from '../lib/timerStore'
import { phaseText, useChannelJob } from '../lib/channel'

const TILES = [
  { to: '/odkrywaj', label: 'Przepisy', Icon: BookOpen, gold: true },
  { to: '/lodowka', label: 'Moja lodówka', Icon: Refrigerator },
  { to: '/plan', label: 'Planer', Icon: CalendarDays },
  { to: '/zakupy', label: 'Zakupy', Icon: ShoppingCart },
]
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

export default function Home() {
  const ix = useIndex()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [bell, setBell] = useState(false)
  const plan = useLiveQuery(() => db.plan.where('date').equals(todayLocal()).toArray(), [])
  const timers = useTimers()
  const job = useChannelJob()
  const jobOn = !!job && !job.dismissed && job.job?.state === 'running'
  const byId = useMemo(() => new Map((ix ?? []).map(r => [r.id, r])), [ix])
  const todays = (plan ?? []).map(p => ({ p, r: byId.get(p.rid) })).filter(x => x.r)
  const news = todays.length + timers.length + (jobOn ? 1 : 0)
  const surprise = () => {
    const pool = (ix ?? []).filter(r => ['obiad', 'kolacja', 'makaron', 'zupa'].includes(r.cat))
    if (pool.length) nav('/przepis/' + encodeURIComponent(pool[Math.floor(Math.random() * pool.length)].id))
  }
  return (
    <div className="home">
      <div className="home-hero">
        <div className="hero-dish" style={{ backgroundImage: `url(${UI('hero-dish.webp')}), url(${import.meta.env.BASE_URL}img/hero-steak.webp)` }}>
          <i className="steam s1" /><i className="steam s2" /><i className="steam s3" />
        </div>
        <div className="home-top rise">
          <Logo />
          <div className="tbtns">
            <button className="rbtn" aria-label="Dziś w kuchni" onClick={() => setBell(true)}><Bell size={22} strokeWidth={1.6} />{news > 0 && <i className="dot" />}</button>
            <Link className="rbtn" aria-label="Szukaj" to="/odkrywaj?f=1"><Search size={22} strokeWidth={1.6} /></Link>
          </div>
        </div>
        <h1 className="home-h1 rise d1"><span>Co dziś</span><em>gotujemy?</em></h1>
        <form className="gsearch rise d2" onSubmit={e => { e.preventDefault(); nav('/odkrywaj?q=' + encodeURIComponent(q)) }}>
          <Search size={22} strokeWidth={1.8} className="gs-ico" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj dania, składnika, kuchni..." enterKeyHint="search" />
          <Link to="/dodaj?tryb=zdjecia" className="gs-scan" aria-label="Dodaj przepis ze zdjęcia"><ScanLine size={20} strokeWidth={1.7} /></Link>
        </form>
      </div>

      <div className="qtiles rise d3">
        {TILES.map(({ to, label, Icon, gold }) => (
          <Link key={to} to={to} className={'qtile' + (gold ? ' gold' : '')}>
            <Icon size={34} strokeWidth={1.5} stroke={gold ? 'url(#goldDark)' : 'url(#gold)'} />
            <span>{label}</span>
          </Link>
        ))}
      </div>

      {todays.length > 0 && (
        <section className="hsec rise d4">
          <div className="hsec-h"><h2>Twój plan na dziś</h2></div>
          <div className="planrow">{todays.map(({ p, r }) => (
            <Link key={p.key} className="planchip" to={'/przepis/' + encodeURIComponent(r!.id)}><small>{p.slot}</small><b>{r!.title}</b></Link>
          ))}</div>
        </section>
      )}

      <section className="hsec rise d4">
        <div className="hsec-h"><h2>Kategorie</h2><button className="surprise" onClick={surprise}><Dices size={22} strokeWidth={1.5} stroke="url(#gold)" /> Zaskocz mnie <ChevronRight size={18} /></button></div>
        <div className="catgrid">
          <Link to="/odkrywaj?max=15" className="gcat big">
            <span className="gcat-img" style={{ backgroundImage: `url(${catImg('szybko')})` }} />
            <b className="pill15"><Zap size={13} fill="currentColor" /> do 15 min</b>
            <span className="gcat-t">Na szybko<small>do 15 minut</small></span><i className="chev"><ChevronRight size={18} /></i>
          </Link>
          <Link to="/odkrywaj?sig=1" className="gcat big">
            <span className="gcat-img" style={{ backgroundImage: `url(${catImg('signature')})` }} />
            <b className="ribbon"><Crown size={16} fill="currentColor" strokeWidth={1.5} /></b>
            <span className="gcat-t">Signature<small>autorskie nowości</small></span><i className="chev"><ChevronRight size={18} /></i>
          </Link>
          {CATS.map(c => (
            <Link key={c.id} to={'/odkrywaj?cat=' + c.id} className="gcat">
              <span className="gcat-img" style={{ backgroundImage: `url(${catImg(c.id)})` }} />
              <span className="gcat-t">{c.label}</span><i className="chev"><ChevronRight size={18} /></i>
            </Link>
          ))}
        </div>
      </section>
      {!ix && <p className="muted center">Ładowanie przepisów…</p>}

      {bell && (
        <div className="modal" onClick={() => setBell(false)}>
          <div className="sheet gsheet" onClick={e => e.stopPropagation()}>
            <div className="hsec-h"><h2>Dziś w kuchni</h2><button className="rbtn sm" aria-label="Zamknij" onClick={() => setBell(false)}><X size={18} /></button></div>
            {news === 0 && <p className="muted">Nic nowego. Zaplanuj posiłek w Planerze albo ustaw minutnik w trybie gotowania.</p>}
            {todays.map(({ p, r }) => <Link key={p.key} className="row" to={'/przepis/' + encodeURIComponent(r!.id)} onClick={() => setBell(false)}><CalendarDays size={18} stroke="url(#gold)" /><span><b>{p.slot}:</b> {r!.title}</span></Link>)}
            {timers.map(t => <Link key={t.id} className="row" to={'/cook/' + encodeURIComponent(t.rid)} onClick={() => setBell(false)}><Timer size={18} stroke="url(#gold)" /><span>{t.label}</span><b>{t.done ? 'koniec!' : mmss(leftOf(t))}</b></Link>)}
            {jobOn && <Link className="row" to={'/ulubione?tab=' + encodeURIComponent('ch:' + (job!.job?.key ?? ''))} onClick={() => setBell(false)}><Tv size={18} stroke="url(#gold)" /><span>{job!.job?.name}: {phaseText(job!.job)}</span></Link>}
          </div>
        </div>
      )}
    </div>
  )
}
