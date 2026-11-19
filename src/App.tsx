import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import { Home as HomeIcon, Compass, Bookmark, User, Timer } from 'lucide-react'
import { GoldDefs, Medallion } from './components/Gold'
import Home from './screens/Home'
import Library from './screens/Library'
import RecipeScreen from './screens/RecipeScreen'
import Cook from './screens/Cook'
import Fridge from './screens/Fridge'
import Planner from './screens/Planner'
import Shopping from './screens/Shopping'
import Favorites from './screens/Favorites'
import Profile from './screens/Profile'
import Sources from './screens/Sources'
import AddRecipe from './screens/AddRecipe'
import Onboarding from './screens/Onboarding'
import { getSetting, setSetting } from './lib/db'
import { leftOf, stopAlarm, useTimers } from './lib/timerStore'
import './lib/channel'
import { startAutoSync } from './lib/sync'

export default function App() {
  const [ready, setReady] = useState(false)
  const [onboard, setOnboard] = useState(false)
  // ekran powitalny tylko przy pierwszym otwarciu w danej sesji (nie po przeładowaniu przy aktualizacji)
  const [splash, setSplash] = useState(() => { try { return !sessionStorage.getItem('splash') } catch { return true } })
  const timers = useTimers()
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(() => {
    getSetting('onboarded', false).then(v => { setOnboard(!v); setReady(true) })
    const t = setTimeout(() => { setSplash(false); try { sessionStorage.setItem('splash', '1') } catch { /* */ } }, 1100)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    startAutoSync() // synchronizacja z innymi urządzeniami (jeśli to urządzenie jest połączone)
  }, [])
  const hideNav = loc.pathname.startsWith('/cook/')
  if (splash || !ready) return <div className="splash"><img src={import.meta.env.BASE_URL + 'img/splash.webp'} alt="Książka Kucharska" /></div>
  if (onboard) return <Onboarding onDone={() => { setSetting('onboarded', true); setOnboard(false); nav('/') }} />
  return (
    <div className={'app' + (hideNav ? ' nonav' : '') + (loc.pathname === '/' ? ' ishome' : '')}>
      <GoldDefs />
      <div className="bgl" aria-hidden="true" />
      <main className="main" key={loc.pathname}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/odkrywaj" element={<Library />} />
          <Route path="/przepis/:id" element={<RecipeScreen />} />
          <Route path="/cook/:id" element={<Cook />} />
          <Route path="/lodowka" element={<Fridge />} />
          <Route path="/plan" element={<Planner />} />
          <Route path="/zakupy" element={<Shopping />} />
          <Route path="/ulubione" element={<Favorites />} />
          <Route path="/dodaj" element={<AddRecipe />} />
          <Route path="/edytuj/:id" element={<AddRecipe />} />
          <Route path="/profil" element={<Profile />} />
          <Route path="/zrodla" element={<Sources />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      {!hideNav && timers.length > 0 && (() => {
        const t = [...timers].sort((a, b) => leftOf(a) - leftOf(b))[0]
        const left = leftOf(t)
        return <button className={'timerpill' + (t.done ? ' done' : '')} onClick={() => { stopAlarm(); nav('/cook/' + encodeURIComponent(t.rid)) }}>
          <Timer size={16} /> {t.done ? 'Minutnik: koniec!' : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`}{timers.length > 1 ? ` · ${timers.length}` : ''}</button>
      })()}
      {!hideNav && (
        <nav className="tabbar">
          <div className="tabbar-in">
            <NavLink to="/" end><HomeIcon size={25} strokeWidth={1.6} /><span>Start</span></NavLink>
            <NavLink to="/odkrywaj"><Compass size={25} strokeWidth={1.6} /><span>Odkrywaj</span></NavLink>
            <span className="tb-gap" />
            <NavLink to="/ulubione"><Bookmark size={25} strokeWidth={1.6} /><span>Moje</span></NavLink>
            <NavLink to="/profil"><User size={25} strokeWidth={1.6} /><span>Profil</span></NavLink>
          </div>
          <NavLink to="/dodaj" className="tb-center" aria-label="Dodaj przepis"><Medallion size={74} /></NavLink>
        </nav>
      )}
    </div>
  )
}
