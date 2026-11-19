import { Link } from 'react-router-dom'
import { Clock, Gauge, Star } from 'lucide-react'
import type { IndexItem } from '../lib/types'
import { DIFF, catLabel } from '../lib/types'
import { fmtMin } from '../lib/format'
import { useThumb } from '../lib/photos'

const img = (cat: string) => `${import.meta.env.BASE_URL}img/cat/${cat}.webp`
export function RecipeCard({ r, badge, demoted }: { r: IndexItem; badge?: string; demoted?: boolean }) {
  const sig = r.tags.includes('signature') && !demoted
  const th = useThumb(r.id)
  return (
    <Link to={`/przepis/${encodeURIComponent(r.id)}`} className="card rcard">
      <span className={'rc-img' + (th ? '' : ' cat')} style={{ backgroundImage: `url(${th || img(r.cat)})` }} />
      <div className="rc-body">
        <span className="catlbl">{catLabel(r.cat)}{r.id.startsWith('mine:') ? ' · moje' : ''}</span>
        <h3>{r.title}</h3>
        <div className="meta">
          <span><Clock size={13} /> {fmtMin(r.min)}{r.rest ? ` + ${fmtMin(r.rest)}` : ''}</span>
          <span><Gauge size={13} /> {DIFF[r.diff]}</span>
        </div>
      </div>
      {badge ? <span className="pct">{badge}</span> : sig ? <span className="sig"><Star size={12} fill="currentColor" /> Signature</span> : null}
    </Link>
  )
}
export function Section({ title, more, children }: { title: string; more?: React.ReactNode; children: React.ReactNode }) {
  return (<section className="section"><div className="section-h"><h2>{title}</h2>{more}</div>{children}</section>)
}
export const catImg = img
