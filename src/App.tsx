import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import { Home as HomeIcon, Compass, Plus, Heart, User } from 'lucide-react'
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
import Onboarding from './screens/Onboarding'
import { getSetting, setSetting } from './lib/db'

export default function App() {
  const [ready, setReady] = useState(false)
  const [onboard, setOnboard] = useState(false)
  const [splash, setSplash] = useState(true)
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(() => {
    getSetting('onboarded', false).then(v => { setOnboard(!v); setReady(true) })
    const t = setTimeout(() => setSplash(false), 1400)
    return () => clearTimeout(t)
  }, [])
  const hideNav = loc.pathname.startsWith('/cook/')
  if (splash || !ready) return <div className="splash"><img src={import.meta.env.BASE_URL + 'img/splash.webp'} alt="Książka Kucharska" /></div>
  if (onboard) return <Onboarding onDone={() => { setSetting('onboarded', true); setOnboard(false); nav('/') }} />
  return (
    <div className="app">
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/odkrywaj" element={<Library />} />
          <Route path="/przepis/:id" element={<RecipeScreen />} />
          <Route path="/cook/:id" element={<Cook />} />
          <Route path="/lodowka" element={<Fridge />} />
          <Route path="/plan" element={<Planner />} />
          <Route path="/zakupy" element={<Shopping />} />
          <Route path="/ulubione" element={<Favorites />} />
          <Route path="/profil" element={<Profile />} />
          <Route path="/zrodla" element={<Sources />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      {!hideNav && (
        <nav className="tabbar">
          <NavLink to="/" end><HomeIcon size={22} /><span>Start</span></NavLink>
          <NavLink to="/odkrywaj"><Compass size={22} /><span>Odkrywaj</span></NavLink>
          <NavLink to="/lodowka" className="plus" aria-label="Moja lodówka"><Plus size={28} /></NavLink>
          <NavLink to="/ulubione"><Heart size={22} /><span>Ulubione</span></NavLink>
          <NavLink to="/profil"><User size={22} /><span>Profil</span></NavLink>
        </nav>
      )}
    </div>
  )
}
