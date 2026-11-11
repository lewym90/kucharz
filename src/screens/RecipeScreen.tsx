import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Heart, Clock, Gauge, Users, Minus, Plus, ShoppingCart, CalendarPlus, Star, Play, Lightbulb, Pencil, Trash2, ExternalLink } from 'lucide-react'
import type { Recipe } from '../lib/types'
import { DIFF, catLabel } from '../lib/types'
import { loadRecipe } from '../lib/data'
import { db, setSetting } from '../lib/db'
import { fmtIng, fmtMin } from '../lib/format'
import { addRecipeToShopping } from '../lib/shopping'
import { useDemoted } from '../components/hooks'
import { isMine } from '../lib/mine'

const SLOTS = ['Śniadanie', 'II śniadanie', 'Obiad', 'Podwieczorek', 'Kolacja']
export default function RecipeScreen() {
  const { id: rawId } = useParams()
  const id = decodeURIComponent(rawId ?? '')
  const nav = useNavigate()
  const [r, setR] = useState<Recipe | null | undefined>(undefined)
  const [serv, setServ] = useState(2)
  const [msg, setMsg] = useState('')
  const [planOpen, setPlanOpen] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [slot, setSlot] = useState('Obiad')
  const fav = useLiveQuery(() => db.favs.get(id), [id])
  const rating = useLiveQuery(() => db.ratings.get(id), [id])
  const demoted = useDemoted()
  useEffect(() => { loadRecipe(id).then(x => { setR(x ?? null); if (x) { setServ(x.serv); db.hist.put({ id, at: Date.now() }) } }) }, [id])
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2200) }
  if (r === undefined) return <div className="page"><p className="muted center">Ładowanie…</p></div>
  if (r === null) return <div className="page"><button className="iconbtn" onClick={() => nav(-1)}><ArrowLeft /></button><p>Nie znaleziono przepisu.</p></div>
  const f = serv / r.serv
  const sig = r.tags.includes('signature') && !demoted.has(r.id)
  const setRating = (stars: number) => db.ratings.put({ id, stars, note: rating?.note ?? '', cooked: rating?.cooked ?? true, at: Date.now() })
  const toggleSig = async () => { const s = new Set(demoted); s.has(id) ? s.delete(id) : s.add(id); await setSetting('demoted', [...s]) }
  return (
    <div className="page recipe">
      <div className="rhead">
        <div className="rtop">
          <button className="iconbtn glass" onClick={() => nav(-1)} aria-label="Wróć"><ArrowLeft size={20} /></button>
          <button className={'iconbtn glass' + (fav ? ' on' : '')} onClick={() => fav ? db.favs.delete(id) : db.favs.put({ id, at: Date.now() })} aria-label="Ulubione"><Heart size={20} fill={fav ? 'currentColor' : 'none'} /></button>
        </div>
        <div className="rtitle">
          {sig && <span className="sig big"><Star size={12} fill="currentColor" /> Signature</span>}
          <h1>{r.title}</h1>
          <div className="meta big">
            <span><Clock size={15} /> {fmtMin(r.min)}</span>
            {r.rest > 0 && <span>+ {fmtMin(r.rest)} odpoczynku</span>}
            <span><Gauge size={15} /> {DIFF[r.diff]}</span>
            <span>{catLabel(r.cat)}{r.cuisine ? ' · ' + r.cuisine : ''}</span>
          </div>
        </div>
      </div>
      <p className="lead">{r.sum}</p>
      <div className="tags">{r.tags.filter(t => t !== 'signature').map(t => <span key={t}>{t}</span>)}</div>
      {isMine(id) && (
        <div className="actions">
          <Link className="btn ghost" to={`/edytuj/${encodeURIComponent(id)}`}><Pencil size={16} /> Edytuj</Link>
          <button className="btn ghost" onClick={async () => { if (confirm('Usunąć ten przepis z „Moich przepisów”?')) { await db.mine.delete(id); await db.favs.delete(id); nav('/ulubione', { replace: true }) } }}><Trash2 size={16} /> Usuń</button>
        </div>
      )}
      {isMine(id) && /^https?:\/\//.test(r.src) && <p className="muted small"><a className="srclink" href={r.src} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Źródło przepisu</a></p>}
      <Link className="btn gold wide" to={`/cook/${encodeURIComponent(id)}?s=${serv}`}><Play size={18} /> Gotuj krok po kroku</Link>
      <div className="actions">
        <button className="btn ghost" onClick={async () => { await addRecipeToShopping(r, serv); flash('Dodano do listy zakupów') }}><ShoppingCart size={16} /> Do zakupów</button>
        <button className="btn ghost" onClick={() => setPlanOpen(o => !o)}><CalendarPlus size={16} /> Do planu</button>
      </div>
      {planOpen && (
        <div className="filters">
          <label>Dzień<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Posiłek<select value={slot} onChange={e => setSlot(e.target.value)}>{SLOTS.map(s => <option key={s}>{s}</option>)}</select></label>
          <button className="btn gold" onClick={async () => { await db.plan.put({ key: `${date}|${slot}|${id}`, date, slot, rid: id, serv }); setPlanOpen(false); flash('Dodano do planu') }}>Zapisz w planie</button>
        </div>
      )}
      {msg && <div className="toast">{msg}</div>}
      <section className="section">
        <div className="section-h"><h2>Składniki</h2>
          <div className="stepper"><Users size={16} /><button onClick={() => setServ(s => Math.max(1, s - 1))} aria-label="Mniej porcji"><Minus size={16} /></button><b>{serv}</b><button onClick={() => setServ(s => s + 1)} aria-label="Więcej porcji"><Plus size={16} /></button></div>
        </div>
        <ul className="ings">{r.ing.map((i, ix) => (
          <li key={ix}><label><input type="checkbox" /><span className="in">{i.n}</span><span className="iq">{i.u === 'do smaku' || i.u === 'do podania' ? i.u : fmtIng(i.q, i.u, f)}</span></label></li>
        ))}</ul>
      </section>
      <section className="section">
        <div className="section-h"><h2>Przygotowanie</h2></div>
        <ol className="steps">{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {r.tip && <div className="tip"><Lightbulb size={18} /><p>{r.tip}</p></div>}
      </section>
      <section className="section">
        <div className="section-h"><h2>Twoja ocena</h2></div>
        <div className="stars">{[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => setRating(n)} aria-label={`${n} gwiazdek`}><Star size={28} fill={(rating?.stars ?? 0) >= n ? 'currentColor' : 'none'} /></button>)}</div>
        <label className="chk"><input type="checkbox" checked={rating?.cooked ?? false} onChange={e => db.ratings.put({ id, stars: rating?.stars ?? 0, note: rating?.note ?? '', cooked: e.target.checked, at: Date.now() })} /> Ugotowane</label>
        <textarea className="note" placeholder="Twoje notatki: co zmienić, jak smakowało…" defaultValue={rating?.note ?? ''} key={rating?.at ?? 0}
          onBlur={e => db.ratings.put({ id, stars: rating?.stars ?? 0, note: e.target.value, cooked: rating?.cooked ?? false, at: Date.now() })} />
        {!isMine(id) && r.tags.includes('signature') && <button className="link" onClick={toggleSig}>{demoted.has(id) ? 'Przywróć odznakę Signature' : 'Ten przepis nie zasługuje na Signature – zdejmij odznakę'}</button>}
        <p className="muted small">{isMine(id) ? 'Przepis dodany przez Ciebie. Zapisany w tym telefonie i w kopii zapasowej z Profilu.' : 'Przepis własny aplikacji, nietestowany w kuchni – Twoja ocena pomoże wyłonić najlepsze.'}</p>
      </section>
    </div>
  )
}
