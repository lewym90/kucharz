import { useEffect, useState } from 'react'
import { RefreshCw, Link2, Unlink, Eye, EyeOff, Smartphone, Loader2, AlertCircle, Check } from 'lucide-react'
import { guessName, joinSync, leaveSync, listDevices, revokeDevice, syncNow, useSync } from '../lib/sync'

type Dev = { id: string; name: string; seen: number; created: number; me: boolean }
const when = (t?: number) => {
  if (!t) return '—'
  const d = new Date(t > 1e12 ? t : t * 1000), now = new Date()
  const hm = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === now.toDateString() ? 'dziś ' + hm : d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) + ' ' + hm
}

export function SyncPanel() {
  const st = useSync()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [name, setName] = useState(guessName())
  const [create, setCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [devs, setDevs] = useState<Dev[]>([])
  const loadDevs = () => listDevices().then(setDevs).catch(() => {})
  useEffect(() => { if (st.on) loadDevs() }, [st.on, st.at])

  const join = async (mk: boolean) => {
    setErr('')
    if (mk && pw !== pw2) { setErr('Hasła się różnią. Wpisz to samo hasło dwa razy.'); return }
    setBusy(true)
    try { await joinSync(pw, name.trim() || guessName(), mk); setPw(''); setPw2(''); setCreate(false) }
    catch (e: any) { if (e.code === 'no_kitchen') setCreate(true); else setErr(e.message) }
    setBusy(false)
  }

  if (!st.on) return (
    <section className="section syncbox"><div className="section-h"><h2>Synchronizacja urządzeń</h2></div>
      <p className="muted">Połącz swoje urządzenia jednym hasłem (telefon, laptop, tablet, telefon partnerki). Przepisy, zdjęcia, ulubione, oceny, plan, lista zakupów i lodówka będą wspólne – to, co dodasz na jednym, pojawi się na pozostałych. Urządzenia bez hasła (np. rodziny) niczego nie widzą.</p>
      {st.err && <p className="errnote"><AlertCircle size={15} /> {st.err}</p>}
      <label className="fld"><span>Hasło synchronizacji</span>
        <div className="pwrow"><input className="urlin" type={show ? 'text' : 'password'} value={pw} onChange={e => { setPw(e.target.value); setCreate(false) }} autoCapitalize="none" autoCorrect="off" autoComplete="new-password" placeholder="co najmniej 6 znaków" />
          <button className="iconbtn" aria-label={show ? 'Ukryj hasło' : 'Pokaż hasło'} onClick={() => setShow(s => !s)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
      {create && <>
        <p className="importnote">Nie ma jeszcze synchronizacji z tym hasłem. Jeśli to Twoje <b>pierwsze</b> urządzenie, utwórz ją – na pozostałych wpiszesz dokładnie to samo hasło. Jeśli to kolejne urządzenie, hasło jest wpisane inaczej niż na pierwszym.</p>
        <label className="fld"><span>Powtórz hasło</span><input className="urlin" type={show ? 'text' : 'password'} value={pw2} onChange={e => setPw2(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="new-password" /></label>
      </>}
      <label className="fld"><span>Nazwa tego urządzenia</span><input className="urlin" value={name} onChange={e => setName(e.target.value)} placeholder="np. Mój iPhone, Laptop, Tablet" /></label>
      {err && <p className="errnote"><AlertCircle size={15} /> {err}</p>}
      {create
        ? <button className="btn gold wide" disabled={busy || pw.length < 6 || !pw2} onClick={() => join(true)}>{busy ? <Loader2 className="spin" size={18} /> : <Link2 size={18} />} Utwórz synchronizację z tym hasłem</button>
        : <button className="btn gold wide" disabled={busy || pw.length < 6} onClick={() => join(false)}>{busy ? <Loader2 className="spin" size={18} /> : <Link2 size={18} />} Połącz to urządzenie</button>}
      <p className="muted small">Bezpiecznie: przy łączeniu nic nie jest kasowane – przepisy z tego urządzenia są dokładane do wspólnych. Hasło wpisujesz tylko raz, potem urządzenie zostaje połączone.</p>
    </section>
  )

  return (
    <section className="section syncbox"><div className="section-h"><h2>Synchronizacja urządzeń</h2></div>
      <p className="syncstat">{st.busy ? <Loader2 className="spin" size={16} /> : st.err ? <AlertCircle size={16} /> : <Check size={16} />}
        <span>{st.busy ? (st.progress ?? 'Synchronizuję…') : st.err ? st.err : `Połączone jako „${st.name}”. Ostatnia synchronizacja: ${when(st.at)}.`}</span></p>
      <button className="btn ghost wide" disabled={st.busy} onClick={() => syncNow()}><RefreshCw size={17} /> Synchronizuj teraz</button>
      {devs.length > 0 && <div className="devlist">
        <h3>Połączone urządzenia</h3>
        {devs.map(d => (
          <div key={d.id} className="dev"><Smartphone size={17} />
            <div><b>{d.name}{d.me ? ' (to urządzenie)' : ''}</b><small>ostatnio: {when(d.seen)}</small></div>
            {!d.me && <button className="link" onClick={async () => { if (confirm(`Odłączyć „${d.name}”? Przestanie dostawać zmiany (dane na nim zostaną). Żeby połączyć je znowu, trzeba wpisać hasło.`)) setDevs(await revokeDevice(d.id)) }}>Odłącz</button>}
          </div>))}
      </div>}
      <button className="btn ghost wide" onClick={async () => { if (confirm('Odłączyć to urządzenie od synchronizacji? Wszystkie przepisy zostaną na nim, tylko przestaną się synchronizować.')) await leaveSync() }}><Unlink size={17} /> Odłącz to urządzenie</button>
    </section>
  )
}
