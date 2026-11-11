import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useIndex, useDemoted, useMine } from '../components/hooks'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { RecipeCard } from '../components/RecipeCard'
import { db } from '../lib/db'

export default function Favorites() {
  const ix = useIndex()
  const demoted = useDemoted()
  const [tab, setTab] = useState<'mine' | 'fav' | 'cooked' | 'hist'>('mine')
  const mine = useMine()
  const favs = useLiveQuery(() => db.favs.orderBy('at').reverse().toArray(), []) ?? []
  const rat = useLiveQuery(() => db.ratings.toArray(), []) ?? []
  const hist = useLiveQuery(() => db.hist.orderBy('at').reverse().limit(60).toArray(), []) ?? []
  const byId = useMemo(() => new Map((ix ?? []).map(r => [r.id, r])), [ix])
  const ids = tab === 'mine' ? mine.map(m => m.id) : tab === 'fav' ? favs.map(f => f.id) : tab === 'cooked' ? rat.filter(r => r.cooked || r.stars > 0).sort((a, b) => b.stars - a.stars).map(r => r.id) : hist.map(h => h.id)
  const rows = ids.map(id => byId.get(id)).filter(Boolean)
  return (
    <div className="page">
      <h1 className="ptitle">Moja kuchnia</h1>
      <div className="chips"><button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>Moje przepisy ({mine.length})</button>
        <button className={tab === 'fav' ? 'on' : ''} onClick={() => setTab('fav')}>Ulubione ({favs.length})</button>
        <button className={tab === 'cooked' ? 'on' : ''} onClick={() => setTab('cooked')}>Ocenione / ugotowane</button>
        <button className={tab === 'hist' ? 'on' : ''} onClick={() => setTab('hist')}>Ostatnio oglądane</button></div>
      <div className="grid">{rows.map(r => <div key={r!.id} className="mwrap"><RecipeCard r={r!} demoted={demoted.has(r!.id)} />
        {tab === 'cooked' && <p className="missing">{'★'.repeat(rat.find(x => x.id === r!.id)?.stars ?? 0) || 'bez oceny'}</p>}</div>)}</div>
      {tab === 'mine' && <Link to="/dodaj" className="btn gold wide addmine"><Plus size={18} /> Dodaj przepis z linku</Link>}
      {rows.length === 0 && tab === 'mine' && <p className="muted center">Tu trafią przepisy, które sam dodasz: z Instagrama, TikToka, Facebooka, YouTube, ze stron internetowych albo z wklejonego tekstu.</p>}
      {rows.length === 0 && tab !== 'mine' && <p className="muted center">Nic tu jeszcze nie ma. Otwórz przepis i dotknij serca lub oceń go po ugotowaniu.</p>}
    </div>
  )
}
