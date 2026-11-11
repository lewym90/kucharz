import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2 } from 'lucide-react'
import { db } from '../lib/db'
import { DEPTS, dept } from '../lib/shopping'
import { fmtIng } from '../lib/format'

export default function Shopping() {
  const items = useLiveQuery(() => db.shop.toArray(), []) ?? []
  const [name, setName] = useState('')
  const total = items.length, done = items.filter(i => i.done).length
  const add = async () => {
    const n = name.trim(); if (!n) return
    await db.shop.put({ key: 'm|' + n.toLowerCase() + '|' + Date.now(), name: n, qty: null, unit: null, dept: dept(n), done: false, src: 'ręcznie' }); setName('')
  }
  return (
    <div className="page">
      <h1 className="ptitle">Lista zakupów</h1>
      <p className="muted">{done} z {total} produktów</p>
      <form className="searchbar" onSubmit={e => { e.preventDefault(); add() }}><input value={name} onChange={e => setName(e.target.value)} placeholder="Dodaj produkt…" /><button className="iconbtn" type="submit"><Plus size={18} /></button></form>
      {DEPTS.map(d => { const di = items.filter(i => i.dept === d); if (!di.length) return null; return (
        <section key={d} className="section"><div className="section-h"><h2>{d} ({di.length})</h2></div>
          <div className="list">{di.sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name, 'pl')).map(i => (
            <label key={i.key} className={'row shop' + (i.done ? ' done' : '')}><input type="checkbox" checked={i.done} onChange={e => db.shop.update(i.key, { done: e.target.checked })} />
              <span className="grow">{i.name}<small>{i.src}</small></span><span className="iq">{i.qty != null ? fmtIng(i.qty, i.unit) : ''}</span></label>))}</div></section>) })}
      {total === 0 && <p className="muted center">Lista jest pusta. Dodaj produkty z przepisu albo z planera.</p>}
      {done > 0 && <button className="btn ghost wide" onClick={() => db.shop.filter(i => i.done).delete()}><Trash2 size={16} /> Usuń kupione</button>}
      {total > 0 && <button className="link" onClick={() => db.shop.clear()}>Wyczyść całą listę</button>}
    </div>
  )
}
