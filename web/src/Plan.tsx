import { useRef } from 'react'
import { useDialog } from './dialog'
import { NEW_BRAND, formatBlocks, type Backtest, type Planner } from './planner'
import { PROFILES, type ProfileId } from './stores'

type Props = {
  planner: Planner
  backtest: Backtest
  profile: ProfileId
  brand: string
  count: number
  /** Name of the block, e.g. "the 2nd arrondissement". */
  placeOf: (cell: string) => string
  onProfile: (p: ProfileId) => void
  onBrand: (brand: string) => void
  onCount: (n: number) => void
  onPick: (cell: string) => void
  onMethod: () => void
  onClose: () => void
}

const pct = (v: number | undefined) => `${Math.round(v ?? 0)}%`
const NOUN: Record<ProfileId, string> = {
  'jewellery-watches': 'jeweller and watchmaker',
  'fashion-house': 'fashion house',
  beauty: 'beauty brand',
}

export default function Plan(props: Props) {
  const { planner, backtest, profile, brand, count, placeOf } = props
  const drawer = useRef<HTMLDivElement>(null)
  useDialog(drawer, props.onClose)

  const plans = planner.profiles[profile].plans
  const plan = plans[brand] ?? plans[NEW_BRAND]
  const picks = plan.picks.slice(0, count)
  const gain = picks.reduce((s, p) => s + p.gain, 0)
  const lost = picks.reduce((s, p) => s + p.cannibalised, 0)
  const brands = Object.keys(plans).filter((b) => b !== NEW_BRAND)
  const test = backtest.profiles[profile]
  const found = test.found_percent
  const isNew = brand === NEW_BRAND

  return (
    <div className="ask plan" role="dialog" aria-modal="false" aria-labelledby="plan-title" tabIndex={-1} ref={drawer}>
      <div className="ask-bar">
        <h2 id="plan-title">Plan a network</h2>
        <button className="button secondary" onClick={props.onClose}>
          Close
        </button>
      </div>

      <div className="plan-form">
        <div className="plan-profiles" role="group" aria-label="Brand profile">
          {PROFILES.map((p) => (
            <button key={p.id} className="chip" aria-pressed={p.id === profile} onClick={() => props.onProfile(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="label" htmlFor="plan-brand">
          Brand
        </label>
        <select id="plan-brand" value={isNew ? NEW_BRAND : brand} onChange={(e) => props.onBrand(e.target.value)}>
          <option value={NEW_BRAND}>A new brand, not yet in Paris</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b} ({plans[b].boutiques} in Paris)
            </option>
          ))}
        </select>
        <span className="label" id="plan-count">
          New boutiques
        </span>
        <div className="plan-count" role="group" aria-labelledby="plan-count">
          {Array.from({ length: planner.steps }, (_, i) => i + 1).map((n) => (
            <button key={n} className="chip" aria-pressed={n === count} onClick={() => props.onCount(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <p className="plan-summary" aria-live="polite">
        {picks.length === 1 ? 'This boutique wins' : `These ${picks.length} boutiques win`} the spending of about{' '}
        <strong>{formatBlocks(gain)} average blocks</strong> of Paris
        {isNew || lost < 50 ? '.' : `, after taking ${formatBlocks(lost)} from ${brand}'s own boutiques nearby.`}
      </p>

      <ol className="plan-picks">
        {picks.map((p, i) => (
          <li key={p.cell}>
            <button className="plan-pick" onClick={() => props.onPick(p.cell)}>
              <span className="plan-n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="plan-place">{placeOf(p.cell)}</span>
              <span className="plan-gain">+{formatBlocks(p.gain)}</span>
              <span className="plan-detail muted small">
                wins {formatBlocks(p.gross)}
                {p.cannibalised >= 5 ? `, of which ${formatBlocks(p.cannibalised)} from its own boutiques` : ''}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="muted small plan-unit">
        1 average block = all the spending demand of an average Paris block (residents' income, workers and hotel
        guests). Each pick takes the earlier ones into account.
      </p>

      <section className="plan-trust" aria-labelledby="plan-trust">
        <h3 id="plan-trust" className="label">
          How far to trust it
        </h3>
        <p className="small">
          We hid each {NOUN[profile]} in turn and let the planner choose as many sites as it really has. Its picks
          landed within a {backtest.within_minutes}-minute walk of <strong>{pct(found['planner'])}</strong> of its real
          boutiques, against {pct(found['random'])} for random sites and {pct(found['lookalike'])} for the top-scoring
          blocks.{' '}
          {found['planner'] >= found['lookalike']
            ? 'So for this profile the planner finds real choices better than the score alone, and it also says what each site wins and takes from the brand.'
            : 'So for this profile the score alone copies real choices better; the planner adds what each site wins and takes from the brand.'}
        </p>
        <p className="muted small">
          Limits: demand is an index from open data, not sales; access is on foot only; a boutique's pull depends only
          on the luxury around it. Only blocks scoring {planner.suitable} or more are considered.{' '}
          <button className="link" onClick={props.onMethod}>
            How it works
          </button>
        </p>
      </section>
    </div>
  )
}
