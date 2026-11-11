import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { X, ChevronLeft, ChevronRight, Timer, Pause, Play, ListChecks, Type, Check } from 'lucide-react'
import type { Recipe } from '../lib/types'
import { loadRecipe } from '../lib/data'
import { fmtIng } from '../lib/format'
import { detectTimers, beep } from '../lib/timers'
import { db } from '../lib/db'

type T = { id: number; label: string; left: number; total: number; running: boolean; done: boolean }
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
export default function Cook() {
  const { id: raw } = useParams()
  const id = decodeURIComponent(raw ?? '')
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [r, setR] = useState<Recipe | null>(null)
  const [i, setI] = useState(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [timers, setTimers] = useState<T[]>([])
  const [showIng, setShowIng] = useState(false)
  const [big, setBig] = useState(false)
  const nextId = useRef(1)
  const sx = useRef(0)
  useEffect(() => { loadRecipe(id).then(x => setR(x ?? null)) }, [id])
  useEffect(() => { // ekran nie gaśnie podczas gotowania
    let lock: any = null
    ;(navigator as any).wakeLock?.request?.('screen').then((l: any) => { lock = l }).catch(() => {})
    return () => { lock?.release?.() }
  }, [])
  useEffect(() => {
    const t = setInterval(() => {
      setTimers(ts => ts.map(x => {
        if (!x.running || x.done) return x
        const left = x.left - 1
        if (left <= 0) { beep(); return { ...x, left: 0, running: false, done: true } }
        return { ...x, left }
      }))
    }, 1000)
    return () => clearInterval(t)
  }, [])
  if (!r) return <div className="page"><p className="muted center">Ładowanie…</p></div>
  const serv = Number(sp.get('s')) || r.serv
  const f = serv / r.serv
  const step = r.steps[i]
  const found = detectTimers(step)
  const addTimer = (label: string, sec: number) => setTimers(ts => [...ts, { id: nextId.current++, label: `${label} · krok ${i + 1}`, left: sec, total: sec, running: true, done: false }])
  const finish = async () => { await db.hist.put({ id, at: Date.now() }); nav(`/przepis/${encodeURIComponent(id)}`) }
  const last = i === r.steps.length - 1
  return (
    <div className={'cook' + (big ? ' big' : '')}>
      <div className="cook-top">
        <button className="iconbtn" onClick={() => nav(-1)} aria-label="Zamknij"><X /></button>
        <div className="cook-title">{r.title}</div>
        <button className={'iconbtn' + (big ? ' on' : '')} onClick={() => setBig(b => !b)} aria-label="Duży tekst"><Type /></button>
        <button className={'iconbtn' + (showIng ? ' on' : '')} onClick={() => setShowIng(s => !s)} aria-label="Składniki"><ListChecks /></button>
      </div>
      <div className="progress"><div style={{ width: `${((i + 1) / r.steps.length) * 100}%` }} /></div>
      {showIng ? (
        <div className="cook-body"><h2>Składniki ({serv} porcji)</h2>
          <ul className="ings">{r.ing.map((x, k) => <li key={k}><label><input type="checkbox" /><span className="in">{x.n}</span><span className="iq">{x.u === 'do smaku' || x.u === 'do podania' ? x.u : fmtIng(x.q, x.u, f)}</span></label></li>)}</ul></div>
      ) : (
        <div className="cook-body stage" onTouchStart={e => { sx.current = e.touches[0].clientX }} onTouchEnd={e => { const d = e.changedTouches[0].clientX - sx.current; if (d < -60 && !last) setI(i + 1); else if (d > 60 && i > 0) setI(i - 1) }}>
          <div className="stepcard" key={i}>
            <div className="stepbadge">{i + 1}</div>
            <div className="stepno">Krok {i + 1} z {r.steps.length}</div>
            <p className="steptext">{step}</p>
          </div>
          <div className="timer-add">
            {found.map((t, k) => <button key={k} className="btn ghost" onClick={() => addTimer(t.label, t.sec)}><Timer size={16} /> Minutnik: {t.label}</button>)}
            <button className="btn ghost" onClick={() => addTimer('Własny 5 min', 300)}><Timer size={16} /> +5 min</button>
          </div>
          <label className={'donepill' + (done.has(i) ? ' on' : '')}><input type="checkbox" checked={done.has(i)} onChange={() => setDone(d => { const n = new Set(d); n.has(i) ? n.delete(i) : n.add(i); return n })} /><Check size={18} /> Zrobione</label>
          {last && r.tip && <p className="tip small tipc">💡 {r.tip}</p>}
        </div>
      )}
      {timers.length > 0 && (
        <div className="timers">{timers.map(t => (
          <div key={t.id} className={'timer' + (t.done ? ' done' : '')}>
            <div className="tl">{t.label}</div><div className="tt">{t.done ? 'Koniec!' : mmss(t.left)}</div>
            {!t.done && <button className="iconbtn" onClick={() => setTimers(ts => ts.map(x => x.id === t.id ? { ...x, running: !x.running } : x))}>{t.running ? <Pause size={18} /> : <Play size={18} />}</button>}
            <button className="iconbtn" onClick={() => setTimers(ts => ts.filter(x => x.id !== t.id))}><X size={18} /></button>
          </div>))}</div>
      )}
      <div className="cook-nav">
        <button className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft /> Wstecz</button>
        {last ? <button className="btn gold" onClick={finish}><Check /> Gotowe</button> : <button className="btn gold" onClick={() => setI(i + 1)}>Dalej <ChevronRight /></button>}
      </div>
    </div>
  )
}
