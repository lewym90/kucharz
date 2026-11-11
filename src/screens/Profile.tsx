import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Upload, ChevronRight, Info, FileText } from 'lucide-react'
import { exportBackup, importBackup } from '../lib/db'

export default function Profile() {
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const doExport = async () => {
    const blob = new Blob([await exportBackup()], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `ksiazka-kucharska-kopia-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href)
    setMsg('Kopia zapisana.')
  }
  const doImport = async (f?: File) => {
    if (!f) return
    try { await importBackup(await f.text()); setMsg('Kopia wczytana. Odśwież widok, aby zobaczyć dane.') } catch (e: any) { setMsg('Błąd: ' + e.message) }
  }
  return (
    <div className="page">
      <h1 className="ptitle">Profil</h1>
      <div className="list">
        <Link className="row" to="/plan"><span>Planer posiłków</span><ChevronRight size={18} /></Link>
        <Link className="row" to="/zakupy"><span>Lista zakupów</span><ChevronRight size={18} /></Link>
        <Link className="row" to="/zrodla"><span><FileText size={16} /> Źródła i licencje</span><ChevronRight size={18} /></Link>
      </div>
      <section className="section"><div className="section-h"><h2>Kopia zapasowa</h2></div>
        <p className="muted">Ulubione, oceny, notatki, plan, lista zakupów i lodówka są zapisane tylko w tej przeglądarce. Zrób kopię do pliku, aby przenieść je na inne urządzenie.</p>
        <div className="actions"><button className="btn gold" onClick={doExport}><Download size={16} /> Eksportuj</button>
          <button className="btn ghost" onClick={() => file.current?.click()}><Upload size={16} /> Importuj</button></div>
        <input ref={file} type="file" accept="application/json" hidden onChange={e => doImport(e.target.files?.[0])} />
        {msg && <p className="muted">{msg}</p>}
      </section>
      <section className="section"><div className="section-h"><h2>O aplikacji</h2></div>
        <p className="muted"><Info size={14} /> Książka Kucharska działa offline, bez kont, bez reklam i bez sztucznej inteligencji w czasie działania. Wszystkie dane zostają na Twoim urządzeniu.</p></section>
    </div>
  )
}
