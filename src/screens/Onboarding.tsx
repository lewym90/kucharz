import { useState } from 'react'

const imgs = ['ob1', 'ob2', 'ob3']
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0)
  return (
    <div className="onb" onClick={() => (i < imgs.length - 1 ? setI(i + 1) : onDone())}>
      <img src={`${import.meta.env.BASE_URL}img/${imgs[i]}.webp`} alt="" />
      <button className="skip" onClick={e => { e.stopPropagation(); onDone() }}>Pomiń</button>
      <div className="tap">Dotknij, aby kontynuować</div>
    </div>
  )
}
