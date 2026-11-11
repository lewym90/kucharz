import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ClipboardPaste, Link2, FileText, PencilLine, Loader2, Sparkles, AlertCircle, Check } from 'lucide-react'
import { CATS } from '../lib/types'
import { db } from '../lib/db'
import { Draft, emptyDraft, importFrom, ingToLine, lineToIng, saveMine, toDraft } from '../lib/mine'

type Mode = 'link' | 'text' | 'manual'
const STEPS_LOADING = ['Pobieram stronę lub film…', 'Czytam opis i napisy…', 'Słucham, co mówi autor…', 'Układam składniki i kroki…', 'Przeliczam jednostki na polskie…']
const HOW: Record<string, string> = {
  'strona+gemini': 'ze strony z przepisem', 'strona+reguły': 'ze strony z przepisem', 'strona-tekst+gemini': 'z tekstu strony', 'opis+gemini': 'z opisu posta',
  'opis+reguły': 'z opisu posta', 'film+gemini': 'z filmu (obraz i dźwięk)', 'tekst+gemini': 'z wklejonego tekstu', 'tekst+reguły': 'z wklejonego tekstu', offline: 'z wklejonego tekstu (bez internetu)',
}

export default function AddRecipe() {
  const nav = useNavigate()
  const { id: rawId } = useParams()
  const editId = rawId ? decodeURIComponent(rawId) : null
  const [sp] = useSearchParams()
  const [mode, setMode] = useState<Mode>('link')
  const [url, setUrl] = useState(sp.get('u') ?? '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState(0)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [how, setHow] = useState('')
  const [ingTxt, setIngTxt] = useState('')
  const [stepTxt, setStepTxt] = useState('')
  const started = useRef(0)

  useEffect(() => {
    if (!editId) return
    db.mine.get(editId).then(r => { if (r) openEditor(toDraft(r)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setPhase(p => Math.min(p + 1, STEPS_LOADING.length - 1)), 4500)
    return () => clearInterval(t)
  }, [busy])
  useEffect(() => {
    // po wejściu spróbuj podpowiedzieć link ze schowka (iOS może poprosić o zgodę; błąd ignorujemy)
    if (editId || url) return
    navigator.clipboard?.readText?.().then(t => { if (/^https?:\/\/\S+$/.test(t.trim())) setUrl(t.trim()) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openEditor = (d: Draft) => { setDraft(d); setIngTxt(d.ing.map(ingToLine).join('\n')); setStepTxt(d.steps.join('\n\n')) }
  const paste = async () => {
    try { const t = (await navigator.clipboard.readText()).trim(); if (/^https?:\/\//.test(t) && !/\s/.test(t)) { setUrl(t); setMode('link') } else { setText(t); setMode('text') } }
    catch { setErr('Nie mogę odczytać schowka. Wklej ręcznie w pole poniżej (przytrzymaj pole i wybierz „Wklej”).') }
  }
  const run = async () => {
    setErr(''); setBusy(true); setPhase(0); started.current = Date.now()
    try {
      const input = mode === 'link' ? { url: url.trim() } : { text: text.trim() }
      const { draft: d, how: h } = await importFrom(input)
      setHow(h); openEditor(d)
    } catch (e: any) { setErr(e.message || 'Import się nie udał.') }
    setBusy(false)
  }
  const startManual = () => { setMode('manual'); openEditor(emptyDraft()) }
  const save = async () => {
    if (!draft) return
    const ing = ingTxt.split('\n').map(lineToIng).filter(Boolean) as Draft['ing']
    const steps = stepTxt.split(/\n+/).map(s => s.trim()).filter(Boolean)
    if (!draft.title.trim()) { setErr('Wpisz tytuł przepisu.'); return }
    if (ing.length < 1 || steps.length < 1) { setErr('Dodaj przynajmniej jeden składnik i jeden krok.'); return }
    const id = await saveMine({ ...draft, ing, steps }, editId ?? undefined)
    nav('/przepis/' + encodeURIComponent(id), { replace: true })
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => (d ? { ...d, [k]: v } : d))

  if (draft) {
    return (
      <div className="page addrec">
        <h1 className="ptitle">{editId ? 'Edytuj przepis' : 'Sprawdź przepis'}</h1>
        {!editId && how && <p className="importnote"><Sparkles size={15} /> Wczytano {HOW[how] ?? 'z linku'}. Przejrzyj i popraw, zanim zapiszesz.</p>}
        {err && <p className="errnote"><AlertCircle size={15} /> {err}</p>}
        <label className="fld">Tytuł<input value={draft.title} onChange={e => set('title', e.target.value)} /></label>
        <label className="fld">Krótki opis<textarea rows={2} value={draft.summary} onChange={e => set('summary', e.target.value)} /></label>
        <div className="fld">Kategoria
          <div className="chips wrap">{CATS.map(c => <button key={c.id} className={draft.cat === c.id ? 'on' : ''} onClick={() => set('cat', c.id)}>{c.label}</button>)}</div></div>
        <div className="row3">
          <label className="fld">Porcje<input type="number" min={1} value={draft.serv} onChange={e => set('serv', +e.target.value)} /></label>
          <label className="fld">Czas (min)<input type="number" min={1} value={draft.min} onChange={e => set('min', +e.target.value)} /></label>
          <label className="fld">Trudność<select value={draft.diff} onChange={e => set('diff', +e.target.value)}><option value={1}>Bardzo łatwe</option><option value={2}>Łatwe</option><option value={3}>Średnie</option><option value={4}>Trudne</option></select></label>
        </div>
        <label className="fld">Składniki <small>(jeden w linii, np. „200 g mąki”, „2 jajka”, „sól do smaku”)</small>
          <textarea rows={Math.max(6, ingTxt.split('\n').length + 1)} value={ingTxt} onChange={e => setIngTxt(e.target.value)} /></label>
        <label className="fld">Kroki <small>(oddziel pustą linią lub nową linią)</small>
          <textarea rows={Math.max(8, stepTxt.split('\n').length + 2)} value={stepTxt} onChange={e => setStepTxt(e.target.value)} /></label>
        <label className="fld">Wskazówka <small>(opcjonalnie)</small><input value={draft.tip ?? ''} onChange={e => set('tip', e.target.value || null)} /></label>
        {draft.src && <p className="muted small">Źródło: {draft.src}</p>}
        <button className="btn gold wide" onClick={save}><Check size={18} /> Zapisz w „Moich przepisach”</button>
        <button className="btn ghost wide" onClick={() => (editId ? nav(-1) : (setDraft(null), setErr('')))}>{editId ? 'Anuluj' : 'Wróć'}</button>
      </div>
    )
  }

  const elapsed = busy ? Math.round((Date.now() - started.current) / 1000) : 0
  return (
    <div className="page addrec">
      <h1 className="ptitle">Dodaj przepis</h1>
      <div className="chips">
        <button className={mode === 'link' ? 'on' : ''} onClick={() => { setMode('link'); setErr('') }}><Link2 size={15} /> Z linku</button>
        <button className={mode === 'text' ? 'on' : ''} onClick={() => { setMode('text'); setErr('') }}><FileText size={15} /> Wklej tekst</button>
        <button onClick={startManual}><PencilLine size={15} /> Ręcznie</button>
      </div>
      {mode === 'link' && (
        <>
          <p className="muted">Skopiuj link do posta, filmu lub strony z przepisem (Instagram, TikTok, Facebook, YouTube, bloga) i wklej tutaj. Dostaniesz pełen przepis: składniki i kroki.</p>
          <input className="urlin" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} />
        </>
      )}
      {mode === 'text' && (
        <>
          <p className="muted">Wklej opis posta lub tekst przepisu (z Facebooka, Instagrama, wiadomości…). Aplikacja wyłuska z niego składniki i kroki.</p>
          <textarea className="textin" rows={10} placeholder="Skopiowany tekst przepisu…" value={text} onChange={e => setText(e.target.value)} disabled={busy} />
        </>
      )}
      {err && <p className="errnote"><AlertCircle size={15} /> {err}</p>}
      {busy ? (
        <div className="loadbox"><Loader2 className="spin" size={22} /><div><b>{STEPS_LOADING[phase]}</b>
          <small>{elapsed > 25 ? 'Film trwa dłużej niż strona, to normalne. Jeszcze chwila…' : 'Zwykle 5 do 40 sekund.'}</small></div></div>
      ) : (
        <>
          <button className="btn gold wide" onClick={run} disabled={mode === 'link' ? !/\S/.test(url) : text.trim().length < 20}><Sparkles size={18} /> Pobierz przepis</button>
          <button className="btn ghost wide" onClick={paste}><ClipboardPaste size={18} /> Wklej ze schowka</button>
        </>
      )}
    </div>
  )
}
