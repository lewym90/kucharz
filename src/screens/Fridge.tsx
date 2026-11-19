import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, Search, Sparkles, Loader2, AlertCircle, ChevronDown, ChevronUp, Check } from 'lucide-react'
import { useIndex, useDemoted } from '../components/hooks'
import { RecipeCard } from '../components/RecipeCard'
import { loadCatalog } from '../lib/data'
import type { CatalogItem } from '../lib/types'
import { CATS } from '../lib/types'
import { db, getSetting, setSetting } from '../lib/db'
import { cookable } from '../lib/fridge'
import { dept } from '../lib/shopping'
import { fold, isStaple, labelAndKey } from '../lib/keys'
import { createFromFridge } from '../lib/mine'
import { PageHero, UI } from '../components/Gold'

const GROUPS = ['Warzywa i owoce', 'Nabiał i jajka', 'Mięso i wędliny', 'Ryby i owoce morza', 'Pieczywo i produkty sypkie', 'Przyprawy i sosy', 'Napoje i inne', 'Inne']
const TYPES: { id: string; label: string }[] = [{ id: '', label: 'Wszystko' }, ...CATS.map(c => ({ id: c.id, label: c.label.replace(/^Śniadania$/, 'Śniadanie').replace(/^Obiady$/, 'Obiad').replace(/^Kolacje$/, 'Kolacja').replace(/^Zupy$/, 'Zupa').replace(/^Makarony$/, 'Makaron').replace(/^Sałatki$/, 'Sałatka').replace(/^Przekąski$/, 'Przekąska').replace(/^Ciasta$/, 'Ciasto').replace(/^Desery$/, 'Deser').replace(/^Napoje$/, 'Napój').replace(/^Drinki$/, 'Drink').replace(/^Sosy$/, 'Sos') }))]
const AI_STEPS = ['Szukam w internecie przepisu z Twoich produktów…', 'Sprawdzam, czy nie wymaga niczego więcej…', 'Układam nowy przepis z tego, co masz…', 'Dopracowuję smak i kroki…']
const SHOW = 14

export default function Fridge() {
  const ix = useIndex()
  const nav = useNavigate()
  const demoted = useDemoted()
  const [cat, setCat] = useState<CatalogItem[]>([])
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [limit, setLimit] = useState(30)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [ai, setAi] = useState<{ busy: boolean; phase: number; err: string }>({ busy: false, phase: 0, err: '' })
  const have = useLiveQuery(async () => (await db.pantry.toArray()).sort((a, b) => a.at - b.at), []) ?? []
  const haveSet = useMemo(() => new Set(have.map(h => h.k)), [have])

  useEffect(() => {
    getSetting<string>('fridgeType', '').then(setType)
    loadCatalog().then(async (c: CatalogItem[]) => {
      setCat(c)
      // po zmianie kluczy składników: stare wpisy w lodówce przeliczamy na nowe klucze
      const known = new Set(c.map(x => x.k))
      for (const p of await db.pantry.toArray()) {
        if (known.has(p.k)) continue
        const k = labelAndKey(p.label).key
        if (k !== p.k && known.has(k)) { await db.pantry.delete(p.k); await db.pantry.put({ ...p, k }) }
      }
    })
  }, [])
  useEffect(() => { setLimit(30) }, [type, have.length])
  useEffect(() => {
    if (!ai.busy) return
    const t = setInterval(() => setAi(a => ({ ...a, phase: Math.min(a.phase + 1, AI_STEPS.length - 1) })), 7000)
    return () => clearInterval(t)
  }, [ai.busy])

  const pickType = (t: string) => { setType(t); setSetting('fridgeType', t) }
  const toggle = (c: CatalogItem) => haveSet.has(c.k) ? db.pantry.delete(c.k) : db.pantry.put({ k: c.k, label: c.l, at: Date.now() })
  const addFromSearch = (c: CatalogItem) => { if (!haveSet.has(c.k)) db.pantry.put({ k: c.k, label: c.l, at: Date.now() }); setQ('') }

  const pool = useMemo(() => cat.filter(c => !c.s && !isStaple(c.k)), [cat])
  const sugg = useMemo(() => {
    const f = fold(q.trim()); if (f.length < 2) return []
    return pool.filter(c => fold(c.l).includes(f)).sort((a, b) => Number(!fold(a.l).startsWith(f)) - Number(!fold(b.l).startsWith(f)) || b.c - a.c).slice(0, 10)
  }, [q, pool])
  const groups = useMemo(() => {
    const g = new Map<string, CatalogItem[]>(GROUPS.map(n => [n, []]))
    for (const c of pool) g.get(dept(c.l))?.push(c)
    return [...g.entries()].filter(([, v]) => v.length)
  }, [pool])

  const all = useMemo(() => (ix && have.length ? cookable(ix, haveSet) : []), [ix, haveSet, have.length])
  const counts = useMemo(() => { const m: Record<string, number> = {}; for (const x of all) m[x.r.cat] = (m[x.r.cat] ?? 0) + 1; return m }, [all])
  const res = useMemo(() => (type ? all.filter(x => x.r.cat === type) : all), [all, type])
  const label = (k: string) => have.find(h => h.k === k)?.label ?? cat.find(c => c.k === k)?.l ?? k

  const createAI = async () => {
    setAi({ busy: true, phase: 0, err: '' })
    try {
      let avoid: string[] = []
      try { avoid = JSON.parse(sessionStorage.getItem('aiAvoid') ?? '[]') } catch { /* */ }
      const { draft, how, extras } = await createFromFridge(have.map(h => h.label), type, avoid)
      try { sessionStorage.setItem('aiAvoid', JSON.stringify([...avoid, draft.title].slice(-8))) } catch { /* */ }
      if (!draft.src) draft.src = 'Przepis AI z mojej lodówki'
      // dodatkowa kontrola po stronie aplikacji: czy przepis nie wymaga czegoś, czego nie zaznaczyłeś
      const more = draft.ing.filter(i => i.u !== 'do smaku' && i.u !== 'do podania').map(i => ({ n: i.n, k: labelAndKey(i.n).key }))
        .filter(i => !isStaple(i.k) && !haveSet.has(i.k)).map(i => i.n)
      setAi({ busy: false, phase: 0, err: '' })
      nav('/dodaj', { state: { draft, how, extras: [...new Set([...(extras ?? []), ...more])] } })
    } catch (e: any) { setAi({ busy: false, phase: 0, err: e.message || 'Nie udało się stworzyć przepisu.' }) }
  }

  const aiBox = (strong: boolean) => (
    <div className={'aibox' + (strong ? ' strong' : '')}>
      {strong && <p><b>Nie ma przepisu tylko z tych produktów{type ? ` (${TYPES.find(t => t.id === type)?.label.toLowerCase()})` : ''}.</b><br />AI poszuka sprawdzonego przepisu w internecie, a jeśli go nie znajdzie, ułoży nowy – tylko z tego, co masz.</p>}
      {!strong && <p className="muted">Chcesz czegoś innego? AI znajdzie albo ułoży przepis tylko z tego, co masz.</p>}
      {ai.err && <p className="errnote"><AlertCircle size={15} /> {ai.err}</p>}
      {ai.busy
        ? <div className="loadbox"><Loader2 className="spin" size={22} /><div><b>{AI_STEPS[ai.phase]}</b><small>Zwykle 15 do 60 sekund.</small></div></div>
        : <button className={'btn wide ' + (strong ? 'gold' : 'ghost')} onClick={createAI}><Sparkles size={18} /> Stwórz z AI</button>}
    </div>
  )

  return (
    <div className="page fridge">
      <PageHero title={<>Moja <em>lodówka</em></>} img={UI('h-lodowka.webp')} />
      <p className="muted">Zaznacz wszystko, co masz w domu. Pokażę tylko dania, na które masz komplet składników. Sól, pieprz, woda, olej, oliwa i cukier liczą się zawsze.</p>
      <div className="searchbar"><Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj składnika, np. jajka, pieczarki…" />{q && <button className="iconbtn" aria-label="Wyczyść" onClick={() => setQ('')}><X size={16} /></button>}</div>
      {sugg.length > 0 && <div className="sugg">{sugg.map(c => <button key={c.k} className={haveSet.has(c.k) ? 'on' : ''} onClick={() => addFromSearch(c)}>{haveSet.has(c.k) && <Check size={13} />} {c.l}</button>)}</div>}
      {q.trim().length >= 2 && sugg.length === 0 && cat.length > 0 && <p className="muted small">Nie znam takiego składnika w przepisach.</p>}

      {have.length > 0 && (
        <section className="section">
          <div className="section-h"><h2>W lodówce ({have.length})</h2><button className="link" onClick={() => { if (confirm('Wyczyścić całą lodówkę?')) db.pantry.clear() }}>Wyczyść</button></div>
          <div className="chips wrap">{have.map(h => <button key={h.k} className="on" onClick={() => db.pantry.delete(h.k)}>{h.label} <X size={13} /></button>)}</div>
        </section>
      )}

      <section className="section">
        <div className="section-h"><h2>Co chcesz zrobić?</h2></div>
        <div className="chips wrap">{TYPES.map(t => {
          const n = t.id ? counts[t.id] ?? 0 : all.length
          return <button key={t.id} className={type === t.id ? 'on' : ''} onClick={() => pickType(t.id)}>{t.label}{have.length > 0 && <small>{n}</small>}</button>
        })}</div>
      </section>

      {have.length > 0 && ix && (
        <section className="section">
          <div className="section-h"><h2>{res.length ? `Możesz zrobić (${res.length})` : 'Możesz zrobić'}</h2></div>
          {res.length === 0 ? aiBox(true) : (
            <>
              <div className="grid">{res.slice(0, limit).map(m => (
                <div key={m.r.id} className="mwrap">
                  <RecipeCard r={m.r} badge="✓ masz wszystko" demoted={demoted.has(m.r.id)} />
                  <p className="missing ok">Zużyjesz: {m.r.req.map(label).join(', ')}</p>
                </div>))}</div>
              {res.length > limit && <button className="btn ghost wide" onClick={() => setLimit(l => l + 30)}>Pokaż więcej</button>}
              {aiBox(false)}
            </>
          )}
        </section>
      )}

      <section className="section">
        <div className="section-h"><h2>Dodaj z listy</h2></div>
        {groups.map(([g, items]) => {
          const isOpen = !!open[g]
          const sel = items.filter(c => haveSet.has(c.k))
          const top = items.slice(0, SHOW)
          const shown = isOpen ? items : [...top, ...sel.filter(c => !top.includes(c))]
          return (
            <div key={g} className="fgroup">
              <h3>{g}{sel.length > 0 && <small> · {sel.length}</small>}</h3>
              <div className="chips wrap">{shown.map(c => <button key={c.k} className={haveSet.has(c.k) ? 'on' : ''} onClick={() => toggle(c)}>{haveSet.has(c.k) && <Check size={13} />} {c.l}</button>)}</div>
              {items.length > SHOW && <button className="link" onClick={() => setOpen(o => ({ ...o, [g]: !isOpen }))}>{isOpen ? <><ChevronUp size={14} /> Zwiń</> : <><ChevronDown size={14} /> Pokaż wszystkie ({items.length})</>}</button>}
            </div>
          )
        })}
      </section>
    </div>
  )
}
