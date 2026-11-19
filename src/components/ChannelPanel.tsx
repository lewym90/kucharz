import { Link } from 'react-router-dom'
import { Loader2, Check, AlertCircle, X } from 'lucide-react'
import { dismissChannel, phasePct, phaseText, useChannelJob } from '../lib/channel'

/** Karta postępu pobierania kanału (w Dodaj i w zakładce kanału w Moje). */
export function ChannelProgress({ only }: { only?: string }) {
  const c = useChannelJob()
  if (!c || c.dismissed) return null
  const j = c.job
  if (only && j?.key && j.key !== only) return null
  const running = !j || j.state === 'running' || c.saved < (j?.found ?? 0)
  const err = j?.state === 'error'
  return (
    <div className={'chprog' + (err ? ' err' : '')}>
      <div className="chprog-h">
        {err ? <AlertCircle size={18} /> : running ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
        <b>{c.repair ? 'Poprawiam przepisy: ' : ''}{j?.name || 'Pobieranie przepisów'}</b>
        {!running && <button className="iconbtn" aria-label="Zamknij" onClick={dismissChannel}><X size={16} /></button>}
      </div>
      <div className="chbar"><div style={{ width: phasePct(j) + '%' }} /></div>
      <p>{phaseText(j)}</p>
      {c.repair
        ? <p className="muted small">Pobieram kanał jeszcze raz poprawioną wersją i poprawiam przepisy, w których zamiast składników były wartości odżywcze. Zdjęcia, oceny i ulubione zostają, a przepisy, które sam edytowałeś, są nietknięte. Poprawione: <b>{c.fixed ?? 0}</b>{c.added ? ` · nowe: ${c.added}` : ''}</p>
        : <p className="muted small">Znalezione pełne przepisy: <b>{j?.found ?? 0}</b> · zapisane w telefonie: <b>{c.saved}</b>{c.added < c.saved ? ` (nowe: ${c.added})` : ''}</p>}
      {running && <p className="muted small">Pobieranie trwa na serwerze – możesz zamknąć aplikację, po powrocie przepisy dojdą same.</p>}
      {!running && !err && j?.key && !only && <Link className="btn gold wide" to={'/ulubione?tab=' + encodeURIComponent('ch:' + j.key)}>Otwórz zakładkę „{j.name}”</Link>}
    </div>
  )
}
