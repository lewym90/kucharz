import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_u, reg) { reg?.update().catch(() => {}); },
  onNeedRefresh() { updateSW(true) }
})
for (const ev of ['gesturestart', 'gesturechange', 'gestureend'])
  document.addEventListener(ev, e => e.preventDefault())
let lastTouch = 0
document.addEventListener('touchend', e => {
  const t = Date.now(); if (t - lastTouch < 350) e.preventDefault(); lastTouch = t
}, { passive: false })
document.addEventListener('touchmove', e => { if ((e as TouchEvent).touches.length > 1) e.preventDefault() }, { passive: false })
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
