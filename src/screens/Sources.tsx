import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function Sources() {
  const [meta, setMeta] = useState<{ count: number; cats: Record<string, number> } | null>(null)
  useEffect(() => { fetch(import.meta.env.BASE_URL + 'data/meta.json').then(r => r.json()).then(setMeta) }, [])
  return (
    <div className="page">
      <Link to="/profil" className="iconbtn"><ArrowLeft /></Link>
      <h1 className="ptitle">Źródła i licencje</h1>
      <section className="section"><h2>Własne przepisy</h2>
        <p>{meta ? meta.count : '…'} przepisów zostało napisanych od zera na potrzeby tej aplikacji, własnymi słowami, i nie pochodzi z żadnej innej strony ani książki. Przepisy nie były jeszcze testowane w kuchni – oceń je po ugotowaniu.</p></section>
      <section className="section"><h2>Zdjęcia i grafiki</h2>
        <p>Grafiki interfejsu, ikona i zdjęcia poglądowe kategorii zostały przygotowane dla tego projektu. Zdjęcia kategorii mają charakter ilustracyjny i nie przedstawiają konkretnych przepisów.</p></section>
      <section className="section"><h2>Biblioteki</h2>
        <p>React, Vite, Dexie, MiniSearch, Lucide Icons, Workbox (licencje MIT / ISC).</p></section>
      <section className="section"><h2>Przepisy z otwartych źródeł</h2>
        <p>Gdy zostaną dodane przepisy z otwartych źródeł (np. Wikibooks, licencja CC BY-SA), pojawi się tu ich lista z autorami, adresami i licencjami.</p></section>
    </div>
  )
}
