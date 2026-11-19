import { ChefHat } from 'lucide-react'

// Wspólne złote elementy nowego wyglądu. Grafiki z public/img/ui (gdy są) zastępują wersje rysowane kodem.
export const UI = (f: string) => `${import.meta.env.BASE_URL}img/ui/${f}`

/** Gradienty złota używane jako obrys ikon (stroke="url(#gold)"). Wstawiane raz w App. */
export function GoldDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">
          <stop offset="0" stopColor="#fbe7a8" />
          <stop offset=".45" stopColor="#e2b75a" />
          <stop offset=".75" stopColor="#b5832e" />
          <stop offset="1" stopColor="#f0cf7a" />
        </linearGradient>
        <linearGradient id="goldDark" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="22">
          <stop offset="0" stopColor="#3a2708" />
          <stop offset="1" stopColor="#120b02" />
        </linearGradient>
      </defs>
    </svg>
  )
}

/** Logo: złota czapka kucharska z poświatą + napis jak na renderze. */
export function Logo() {
  return (
    <div className="logo">
      <div className="logo-mark">
        <img className="logo-img" src={UI('logo.webp')} alt="" />
        <i className="logo-line" />
      </div>
      <div className="logo-txt">
        <b>Książka<br />Kucharska</b>
        <small>Twoje centrum kulinarne</small>
      </div>
    </div>
  )
}

/** Złoty medalion z czapką kucharską (środkowy przycisk dolnego paska). */
export function Medallion({ size = 70 }: { size?: number }) {
  return (
    <span className="medal" style={{ width: size, height: size }}>
      <span className="medal-face"><ChefHat size={size * 0.46} strokeWidth={1.7} stroke="url(#goldDark)" /></span>
    </span>
  )
}

/** Nagłówek ekranu: duży tytuł, złota linia, zdjęcie w tle wtapiające się w ciemność. */
export function PageHero({ title, sub, img, children }: { title: React.ReactNode; sub?: React.ReactNode; img?: string; children?: React.ReactNode }) {
  return (
    <header className="phero">
      {img && <div className="phero-img" style={{ backgroundImage: `url(${img})` }} />}
      <div className="phero-in">
        <h1>{title}</h1>
        <i className="goldline" />
        {sub && <p>{sub}</p>}
        {children}
      </div>
    </header>
  )
}
