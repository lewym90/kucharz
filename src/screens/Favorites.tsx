import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, Tv, Globe, Search } from 'lucide-react'
import { useIndex, useDemoted, useMine, useChannels } from '../components/hooks'
import { RecipeCard } from '../components/RecipeCard'
import { db } from '../lib/db'
import { fold } from '../lib/keys'
import { deleteChannel, isSocialSource } from '../lib/channel'
import { PageHero, UI } from '../components/Gold'

const PAGE = 40
export default function Favorites() {
  const ix = useIndex()
  const demoted = useDemoted()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') ?? 'mine'
  const setTab = (t: string) => setSp(p => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })
  const chKey = tab.startsWith('ch:') ? tab.slice(3) : ''
  const channels = useChannels()
  const ch = channels.find(c => c.key === chKey)
  const mine = useMine()
  const chRecipes = useMine(chKey || '__none__')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const favs = useLiveQuery(() => db.favs.orderBy('at').reverse().toArray(), []) ?? []
  const rat = useLiveQuery(() => db.ratings.toArray(), []) ?? []
  const hist = useLiveQuery(() => db.hist.orderBy('at').reverse().limit(60).toArray(), []) ?? []
  const byId = useMemo(() => new Map((ix ?? []).map(r => [r.id, r])), [ix])
  const rows = useMemo(() => {
    if (chKey) {
      const f = fold(q.trim())
      return f ? chRecipes.filter(r => fold(r.title + ' ' + r.ingtext).includes(f)) : chRecipes
    }
    const ids = tab === 'mine' ? mine.map(m => m.id) : tab === 'fav' ? favs.map(f => f.id) : tab === 'cooked' ? rat.filter(r => r.cooked || r.stars > 0).sort((a, b) => b.stars - a.stars).map(r => r.id) : hist.map(h => h.id)
    return ids.map(id => byId.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof byId.get>>[]
  }, [chKey, chRecipes, q, tab, mine, favs, rat, hist, byId])
  const remove = async () => { if (ch && confirm(`Usunąć „${ch.name}” i wszystkie jego przepisy (${ch.count}) z telefonu?`)) { await deleteChannel(ch.key); setTab('mine') } }
  return (
    <div className="page">
      <PageHero title={<>Moja <em>kuchnia</em></>} sub="Twoje przepisy i ulubione." img={UI('h-moje.webp')} />
      <div className="chips"><button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>Moje przepisy ({mine.length})</button>
        {channels.map(c => <button key={c.key} className={chKey === c.key ? 'on' : ''} onClick={() => { setTab('ch:' + c.key); setQ(''); setLimit(PAGE) }}>{isSocialSource(c.url) ? <Tv size={15} /> : <Globe size={15} />} {c.name} ({c.count})</button>)}
        <button className={tab === 'fav' ? 'on' : ''} onClick={() => setTab('fav')}>Ulubione ({favs.length})</button>
        <button className={tab === 'cooked' ? 'on' : ''} onClick={() => setTab('cooked')}>Ocenione / ugotowane</button>
        <button className={tab === 'hist' ? 'on' : ''} onClick={() => setTab('hist')}>Ostatnio oglądane</button></div>
      {ch && (
        <div className="chhead">
          <p className="muted">Przepisy pobrane wcześniej z całego kanału. Tej funkcji już nie ma – możesz je przejrzeć albo usunąć całą zakładkę.</p>
          <div className="actions">
            <button className="btn ghost" onClick={remove}><Trash2 size={16} /> Usuń zakładkę z przepisami</button>
          </div>
          {ch.count > 8 && <div className="searchbar"><Search size={18} /><input value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE) }} placeholder={`Szukaj w „${ch.name}”…`} /></div>}
        </div>
      )}
      <div className="grid">{rows.slice(0, limit).map(r => <div key={r.id} className="mwrap"><RecipeCard r={r} demoted={demoted.has(r.id)} />
        {tab === 'cooked' && <p className="missing">{'★'.repeat(rat.find(x => x.id === r.id)?.stars ?? 0) || 'bez oceny'}</p>}</div>)}</div>
      {rows.length > limit && <button className="btn ghost wide" onClick={() => setLimit(l => l + PAGE)}>Pokaż więcej</button>}
      {tab === 'mine' && <Link to="/dodaj" className="btn gold wide addmine"><Plus size={18} /> Dodaj przepis z linku</Link>}
      {rows.length === 0 && tab === 'mine' && <p className="muted center">Tu trafią przepisy, które sam dodasz: z Instagrama, TikToka, Facebooka, YouTube, ze stron internetowych, ze zrzutów ekranu albo z wklejonego tekstu.</p>}
      {rows.length === 0 && chKey && !q && <p className="muted center">Z tego kanału nie ma jeszcze zapisanych przepisów.</p>}
      {rows.length === 0 && !chKey && tab !== 'mine' && <p className="muted center">Nic tu jeszcze nie ma. Otwórz przepis i dotknij serca lub oceń go po ugotowaniu.</p>}
    </div>
  )
}
