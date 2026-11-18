import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { hasTimers } from './lib/timerStore'
import './styles.css'

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_u, reg) {
    reg?.update().catch(() => {})
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg?.update().catch(() => {}) })
    setInterval(() => reg?.update().catch(() => {}), 10 * 60 * 1000)
  },
  onNeedRefresh() { updateSW(true) }
})
// Nowa wersja przeładowuje aplikację – ale nie w trakcie gotowania i nie przy działających minutnikach (wtedy czeka).
const busy = () => location.hash.startsWith('#/cook/') || hasTimers()
let reloaded = false
const reloadWhenFree = () => {
  if (reloaded) return
  if (busy()) { setTimeout(reloadWhenFree, 5000); return }
  reloaded = true; location.reload()
}
navigator.serviceWorker?.addEventListener('controllerchange', reloadWhenFree)
// blokada powiększania szczypaniem (podwójne stuknięcie blokuje już touch-action: manipulation w CSS,
// więc szybkie stuknięcia w przyciski nie są gubione)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend'])
  document.addEventListener(ev, e => e.preventDefault())
document.addEventListener('touchmove', e => { if ((e as TouchEvent).touches.length > 1) e.preventDefault() }, { passive: false })
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
