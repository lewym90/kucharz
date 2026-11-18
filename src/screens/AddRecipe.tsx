import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Camera, ImagePlus, X, ClipboardPaste, Link2, FileText, PencilLine, Loader2, Sparkles, AlertCircle, Check, Images, ExternalLink, Tv } from 'lucide-react'
import { CATS } from '../lib/types'
import { db } from '../lib/db'
import { PhotoPair, delPhoto, processPhoto, putPhoto, shrinkForUpload } from '../lib/photos'
import { Draft, emptyDraft, importFrom, ingToLine, lineToIng, saveMine, toDraft } from '../lib/mine'
import { isChannelUrl, isFacebookProfile, isSiteUrl, startChannel, useChannelJob } from '../lib/channel'
import { ChannelProgress } from '../components/ChannelPanel'

type Mode = 'link' | 'text' | 'photo' | 'channel' | 'manual'
type Shot = { mime: string; data: string; preview: string }
const STEPS_LOADING = ['Pobieram stronę lub film…', 'Czytam opis i komentarz autora…', 'Słucham, co mówi autor…', 'Układam składniki i kroki…', 'Przeliczam jednostki na polskie…']
const STEPS_PHOTO = ['Wysyłam zdjęcia…', 'Czytam tekst ze zrzutów…', 'Łączę składniki i kroki…', 'Przeliczam jednostki na polskie…']
const HOW: Record<string, string> = {
  'strona+gemini': 'ze strony z przepisem', 'strona-reguły': 'ze strony z przepisem', 'strona+reguły': 'ze strony z przepisem', 'strona-tekst+gemini': 'z tekstu strony', 'opis+gemini': 'z opisu posta',
  'opis+reguły': 'z opisu posta i komentarza autora', 'zdjecia+gemini': 'ze zrzutów ekranu', 'ai-internet': 'z internetu (AI znalazło przepis z Twoich produktów)',
  'ai-nowy': 'jako nowy przepis AI z Twoich produktów', 'film+gemini': 'z filmu (obraz i dźwięk)', 'tekst+gemini': 'z wklejonego tekstu', 'tekst+reguły': 'z wklejonego tekstu', offline: 'z wklejonego tekstu (bez internetu)',
}

export default function AddRecipe() {
  const nav = useNavigate()
  const { id: rawId } = useParams()
  const editId = rawId ? decodeURIComponent(rawId) : null
  const [sp] = useSearchParams()
  const loc = useLocation()
  const fromFridge = (loc.state as any)?.draft as Draft | undefined
  const [extras, setExtras] = useState<string[]>((loc.state as any)?.extras ?? [])
  const [shots, setShots] = useState<Shot[]>([])
  const [reading, setReading] = useState(false)
  const [chUrl, setChUrl] = useState('')
  const chJob = useChannelJob()
  const chRunning = !!chJob && !chJob.dismissed && chJob.job?.state === 'running'
  const runChannel = async (u: string) => {
    setErr(''); setBusy(true)
    try { await startChannel(u); setMode('channel') } catch (e: any) { setErr(e.message || 'Nie udało się zacząć pobierania.') }
    setBusy(false)
  }
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
  const [photo, setPhoto] = useState<PhotoPair | null>(null)
  const [photoDirty, setPhotoDirty] = useState(false)
  const [autoPhoto, setAutoPhoto] = useState(false)
  const pickPhoto = async (f?: File | null) => {
    if (!f) return
    try { setPhoto(await processPhoto(f)); setPhotoDirty(true); setErr('') } catch (e: any) { setErr(e.message || 'Nie udało się wczytać zdjęcia.') }
  }

  useEffect(() => {
    if (!editId) return
    db.mine.get(editId).then(r => { if (r) openEditor(toDraft(r)) })
    Promise.all([db.photos.get(editId), db.thumbs.get(editId)]).then(([f, t]) => { if (f) setPhoto({ full: f.data, thumb: t?.data ?? f.data }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])
  useEffect(() => { // przepis z lodówki (Stwórz z AI) – od razu do sprawdzenia i zapisu
    if (!fromFridge || editId) return
    setHow((loc.state as any)?.how ?? ''); openEditor(fromFridge)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromFridge])
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setPhase(p => Math.min(p + 1, (mode === 'photo' ? STEPS_PHOTO : STEPS_LOADING).length - 1)), 4500)
    return () => clearInterval(t)
  }, [busy])
  useEffect(() => {
    // po wejściu spróbuj podpowiedzieć link ze schowka (iOS może poprosić o zgodę; błąd ignorujemy)
    if (editId || url || fromFridge) return
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
      const input = mode === 'link' ? { url: url.trim() } : mode === 'photo' ? { images: shots.map(({ mime, data }) => ({ mime, data })) } : { text: text.trim() }
      const { draft: d, how: h } = await importFrom(input)
      setHow(h); openEditor(d)
      // zdjęcie dania z filmu lub strony – od razu jako zdjęcie przepisu (można zmienić albo usunąć)
      if (d.image && !photo) {
        try {
          const blob = await (await fetch(d.image)).blob()
          setPhoto(await processPhoto(new File([blob], 'danie', { type: blob.type || 'image/jpeg' }))); setPhotoDirty(true); setAutoPhoto(true)
        } catch { /* bez zdjęcia */ }
      }
    } catch (e: any) { setErr(e.message || 'Import się nie udał.') }
    setBusy(false)
  }
  const addShots = async (files: FileList | null) => {
    if (!files?.length) return
    setReading(true); setErr('')
    const out: Shot[] = []
    for (const f of Array.from(files).slice(0, 10)) { try { out.push(await shrinkForUpload(f)) } catch (e: any) { setErr(e.message || 'Nie udało się wczytać zdjęcia.') } }
    setShots(s => [...s, ...out].slice(0, 10)); setReading(false)
  }
  const startManual = () => { setMode('manual'); openEditor(emptyDraft()) }
  const save = async () => {
    if (!draft) return
    const ing = ingTxt.split('\n').map(lineToIng).filter(Boolean) as Draft['ing']
    const steps = stepTxt.split(/\n+/).map(s => s.trim()).filter(Boolean)
    if (!draft.title.trim()) { setErr('Wpisz tytuł przepisu.'); return }
    if (ing.length < 1 || steps.length < 1) { setErr('Dodaj przynajmniej jeden składnik i jeden krok.'); return }
    const id = await saveMine({ ...draft, ing, steps }, editId ?? undefined)
    if (photoDirty) { if (photo) await putPhoto(id, photo); else await delPhoto(id) }
    nav('/przepis/' + encodeURIComponent(id), { replace: true })
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => (d ? { ...d, [k]: v } : d))

  if (draft) {
    return (
      <div className="page addrec">
        <h1 className="ptitle">{editId ? 'Edytuj przepis' : 'Sprawdź przepis'}</h1>
        {!editId && how && <p className="importnote"><Sparkles size={15} /> {how.startsWith('ai-') ? 'Przepis przygotowany' : 'Wczytano'} {HOW[how] ?? 'z linku'}. Przejrzyj i popraw, zanim zapiszesz.</p>}
        {!editId && extras.length > 0 && <p className="errnote"><AlertCircle size={15} /> Uwaga: przepis używa produktów, których nie zaznaczyłeś w lodówce: {extras.join(', ')}. Usuń je albo zamień.</p>}
        {!editId && how === 'ai-internet' && /^https?:\/\//.test(draft.src) && <p className="muted small"><a className="srclink" href={draft.src} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Strona, z której pochodzi przepis</a></p>}
        {err && <p className="errnote"><AlertCircle size={15} /> {err}</p>}
        <div className="photofld">
          {photo ? (
            <div className="photoprev"><img src={photo.full} alt="" />
              <button className="iconbtn glass" aria-label="Usuń zdjęcie" onClick={() => { setPhoto(null); setPhotoDirty(true); setAutoPhoto(false) }}><X size={18} /></button></div>
          ) : null}
          {photo && autoPhoto && <p className="muted small">Zdjęcie pobrane {mode === 'link' && /youtu|tiktok|instagram|facebook|fb\./i.test(url) ? 'z filmu' : 'ze strony'}. Możesz je zmienić albo usunąć.</p>}
          <label className="btn ghost wide"><input type="file" accept="image/*" hidden onChange={e => { pickPhoto(e.target.files?.[0]); setAutoPhoto(false); e.target.value = '' }} />
            {photo ? <><ImagePlus size={17} /> Zmień zdjęcie</> : <><Camera size={17} /> Dodaj zdjęcie dania</>}</label>
        </div>
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
        <button className="btn ghost wide" onClick={() => (editId || fromFridge ? nav(-1) : (setDraft(null), setErr(''), setExtras([]), autoPhoto && (setPhoto(null), setPhotoDirty(false), setAutoPhoto(false))))}>{editId ? 'Anuluj' : 'Wróć'}</button>
      </div>
    )
  }

  const elapsed = busy ? Math.round((Date.now() - started.current) / 1000) : 0
  return (
    <div className="page addrec">
      <h1 className="ptitle">Dodaj przepis</h1>
      <div className="chips wrap">
        <button className={mode === 'link' ? 'on' : ''} onClick={() => { setMode('link'); setErr('') }}><Link2 size={15} /> Z linku</button>
        <button className={mode === 'photo' ? 'on' : ''} onClick={() => { setMode('photo'); setErr('') }}><Images size={15} /> Ze zdjęć</button>
        <button className={mode === 'channel' ? 'on' : ''} onClick={() => { setMode('channel'); setErr('') }}><Tv size={15} /> Kanał lub strona</button>
        <button className={mode === 'text' ? 'on' : ''} onClick={() => { setMode('text'); setErr('') }}><FileText size={15} /> Tekst</button>
        <button onClick={startManual}><PencilLine size={15} /> Ręcznie</button>
      </div>
      {mode === 'link' && (
        <>
          <p className="muted">Skopiuj link do posta, filmu lub strony z przepisem (Instagram, TikTok, Facebook, YouTube, bloga) i wklej tutaj. Aplikacja przeczyta opis, pierwszy komentarz autora i sam film. Jeśli nie wyjdzie, zrób zrzuty ekranu i użyj zakładki „Ze zdjęć”.</p>
          <input className="urlin" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} />
        </>
      )}
      {mode === 'link' && (isChannelUrl(url) || isSiteUrl(url) || isFacebookProfile(url)) && !busy && (
        <div className="importnote chnote"><Tv size={15} /> <span>{isSiteUrl(url) ? 'To link do całej strony lub działu z przepisami.' : 'To link do całego kanału lub profilu.'} <button className="link" onClick={() => { setChUrl(url.trim()); runChannel(url.trim()) }}>Pobierz wszystkie przepisy</button></span></div>
      )}
      {mode === 'channel' && (
        <>
          <p className="muted">Wklej link do kanału YouTube (np. https://www.youtube.com/@nazwa), profilu TikTok albo dowolnej strony z przepisami (cały serwis albo jeden dział, np. „/przepisy/zupy”). Bez AI: aplikacja zapisze tylko pełne przepisy – z filmów te spisane przez autora w opisie, w jego komentarzu albo na jego stronie, a ze stron te zapisane w standardowym formacie przepisu (ma go większość blogów kulinarnych). Przepisy trafią do osobnej zakładki z nazwą kanału lub strony w „Moje”.</p>
          <p className="muted small">Instagram i Facebook nie pozwalają pobrać całego profilu bez logowania – posty z nich dodawaj pojedynczo z linku albo ze zrzutów.</p>
          <ChannelProgress />
          {!chRunning && <input className="urlin" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://www.youtube.com/@… albo https://strona.pl" value={chUrl} onChange={e => setChUrl(e.target.value)} disabled={busy} />}
        </>
      )}
      {mode === 'photo' && (
        <>
          <p className="muted">Dodaj jeden lub kilka zrzutów ekranu albo zdjęć (np. na jednym lista składników, na drugim sposób przygotowania). Aplikacja połączy je w jeden przepis.</p>
          {shots.length > 0 && <div className="shots">{shots.map((s, k) => (
            <div key={k} className="shot"><img src={s.preview} alt={`Zdjęcie ${k + 1}`} /><span>{k + 1}</span>
              {!busy && <button className="iconbtn glass" aria-label="Usuń zdjęcie" onClick={() => setShots(x => x.filter((_, j) => j !== k))}><X size={15} /></button>}</div>))}</div>}
          {!busy && shots.length < 10 && <label className="btn ghost wide"><input type="file" accept="image/*" multiple hidden onChange={e => { addShots(e.target.files); e.target.value = '' }} />
            {reading ? <><Loader2 className="spin" size={17} /> Wczytuję…</> : <><ImagePlus size={17} /> {shots.length ? 'Dodaj kolejne zdjęcia' : 'Wybierz zdjęcia lub zrzuty'}</>}</label>}
        </>
      )}
      {mode === 'text' && (
        <>
          <p className="muted">Wklej opis posta lub tekst przepisu (z Facebooka, Instagrama, wiadomości…). Aplikacja wyłuska z niego składniki i kroki.</p>
          <textarea className="textin" rows={10} placeholder="Skopiowany tekst przepisu…" value={text} onChange={e => setText(e.target.value)} disabled={busy} />
        </>
      )}
      {err && <p className="errnote"><AlertCircle size={15} /> {err}</p>}
      {mode === 'channel' ? (!chRunning && <button className="btn gold wide" disabled={busy || !/\S/.test(chUrl)} onClick={() => runChannel(chUrl)}>{busy ? <Loader2 className="spin" size={18} /> : <Tv size={18} />} Pobierz wszystkie przepisy</button>)
      : busy ? (
        <div className="loadbox"><Loader2 className="spin" size={22} /><div><b>{(mode === 'photo' ? STEPS_PHOTO : STEPS_LOADING)[phase]}</b>
          <small>{mode === 'photo' ? 'Zwykle 10 do 40 sekund.' : elapsed > 25 ? 'Film trwa dłużej niż strona, to normalne. Jeszcze chwila…' : 'Zwykle 5 do 40 sekund.'}</small></div></div>
      ) : (
        <>
          <button className="btn gold wide" onClick={run} disabled={mode === 'link' ? !/\S/.test(url) : mode === 'photo' ? !shots.length || reading : text.trim().length < 20}><Sparkles size={18} /> {mode === 'photo' ? 'Stwórz przepis ze zdjęć' : 'Pobierz przepis'}</button>
          {mode !== 'photo' && <button className="btn ghost wide" onClick={paste}><ClipboardPaste size={18} /> Wklej ze schowka</button>}
        </>
      )}
    </div>
  )
}
