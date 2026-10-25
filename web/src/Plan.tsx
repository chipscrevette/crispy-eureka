import { useRef } from 'react'
import { useDialog } from './dialog'
import { NEW_BRAND, formatBlocks, type Backtest, type Planner } from './planner'
import { PROFILES, type ProfileId } from './stores'
import { lang, tr } from './i18n'

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

const pct = (v: number | undefined) => `${Math.round(v ?? 0)}${lang() === 'en' ? '%' : ' %'}`
const SHORT: Record<ProfileId, string> = {
  'jewellery-watches': tr('Joaillerie', 'Jewellery'),
  'fashion-house': tr('Mode', 'Fashion'),
  beauty: tr('Beauté', 'Beauty'),
}
const NOUN: Record<ProfileId, string> = {
  'jewellery-watches': tr('joaillier et horloger', 'jeweller and watchmaker'),
  'fashion-house': tr('maison de mode', 'fashion house'),
  beauty: tr('marque de beauté', 'beauty brand'),
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
        <h2 id="plan-title">{tr('Planifier un réseau', 'Plan a network')}</h2>
        <button className="button secondary" onClick={props.onClose}>
          {tr('Fermer', 'Close')}
        </button>
      </div>

      <div className="plan-form">
        <div className="step">
          <h3 className="step-title" id="plan-step-1">
            <span className="step-n" aria-hidden="true">
              1
            </span>
            {tr('Quelle marque ?', 'Which brand?')}
          </h3>
          <div className="seg seg-3" role="group" aria-label={tr('Type de marque', 'Type of brand')}>
            {PROFILES.map((p) => (
              <button key={p.id} aria-pressed={p.id === profile} onClick={() => props.onProfile(p.id)}>
                {SHORT[p.id]}
              </button>
            ))}
          </div>
          <select
            id="plan-brand"
            aria-labelledby="plan-step-1"
            value={isNew ? NEW_BRAND : brand}
            onChange={(e) => props.onBrand(e.target.value)}
          >
            <option value={NEW_BRAND}>{tr('Une nouvelle marque, pas encore à Paris', 'A new brand, not yet in Paris')}</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b} ({plans[b].boutiques} {tr('à Paris', 'in Paris')})
              </option>
            ))}
          </select>
        </div>
        <div className="step">
          <h3 className="step-title" id="plan-count">
            <span className="step-n" aria-hidden="true">
              2
            </span>
            {tr('Combien de nouvelles boutiques ?', 'How many new boutiques?')}
          </h3>
          <div className="seg seg-n" role="group" aria-labelledby="plan-count">
            {Array.from({ length: planner.steps }, (_, i) => i + 1).map((n) => (
              <button key={n} aria-pressed={n === count} onClick={() => props.onCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="step">
        <h3 className="step-title">
          <span className="step-n" aria-hidden="true">
            3
          </span>
          {picks.length === 1 ? tr('Ouvrir ici', 'Open here') : tr('Ouvrir ici, dans cet ordre', 'Open here, in this order')}
        </h3>
        <ol className="plan-picks">
          {picks.map((p, i) => (
            <li key={p.cell}>
              <button className="plan-pick" onClick={() => props.onPick(p.cell)}>
                <span className="plan-n" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="plan-place">{placeOf(p.cell)}</span>
                <span className="plan-gain">+{formatBlocks(p.gain)}</span>
                <span className="top-bar" aria-hidden="true">
                  <span style={{ width: `${(100 * p.gain) / Math.max(...picks.map((q) => q.gain), 1e-9)}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className="plan-summary" aria-live="polite">
          <span className="stat-value" aria-hidden="true">
            +{formatBlocks(gain)}
          </span>
          {lang() === 'en' ? (
            <span>
              {picks.length === 1 ? 'It wins' : 'Together they win'} the spending of about{' '}
              <strong>{formatBlocks(gain)} average Paris blocks</strong>
              {isNew || lost < 50 ? '.' : `, after taking ${formatBlocks(lost)} from ${brand}'s own boutiques nearby.`}
            </span>
          ) : (
            <span>
              {picks.length === 1 ? 'Elle capte' : 'Ensemble, elles captent'} le pouvoir d’achat d’environ{' '}
              <strong>{formatBlocks(gain)} blocs parisiens moyens</strong>
              {isNew || lost < 50 ? '.' : `, après en avoir pris ${formatBlocks(lost)} aux boutiques de ${brand} à proximité.`}
            </span>
          )}
        </p>
      </div>

      <details className="more">
        <summary>{tr('Que veut dire « +3 » ?', 'What does “+3” mean?')}</summary>
        <p className="muted small plan-unit">
          {lang() === 'en'
            ? `The spending a new boutique wins, counted in average Paris blocks: 1 = all the spending demand of an average block (residents' income, workers and hotel guests). Each pick takes the earlier ones into account${isNew ? '' : `, and what it takes from ${brand}'s own boutiques is already removed`}.`
            : `Le pouvoir d’achat que capte une nouvelle boutique, compté en blocs parisiens moyens : 1 = tout le pouvoir d’achat d’un bloc moyen (revenus des habitants, actifs et clients d’hôtel). Chaque choix tient compte des précédents${isNew ? '' : `, et ce qu’il prend aux boutiques de ${brand} est déjà retiré`}.`}
        </p>
        <ul className="plan-detail-list small">
          {picks.map((p, i) => (
            <li key={p.cell}>
              {i + 1}. {placeOf(p.cell)}
              {tr(' : capte ', ': wins ')}
              {formatBlocks(p.gross)}
              {p.cannibalised >= 5
                ? tr(`, dont ${formatBlocks(p.cannibalised)} pris à ses propres boutiques`, `, of which ${formatBlocks(p.cannibalised)} from its own boutiques`)
                : ''}
            </li>
          ))}
        </ul>
      </details>

      <details className="more">
        <summary>{tr('Est-ce fiable ?', 'How reliable is this?')}</summary>
        {lang() === 'en' ? (
          <p className="small">
            We hid each {NOUN[profile]} in turn and let the planner choose as many sites as it really has. Its picks
            landed within a {backtest.within_minutes}-minute walk of <strong>{pct(found['planner'])}</strong> of its
            real boutiques, against {pct(found['random'])} for random sites and {pct(found['lookalike'])} for the
            top-scoring blocks.{' '}
            {found['planner'] >= found['lookalike']
              ? 'So for this profile the planner finds real choices better than the score alone, and it also says what each site wins and takes from the brand.'
              : 'So for this profile the score alone copies real choices better; the planner adds what each site wins and takes from the brand.'}
          </p>
        ) : (
          <p className="small">
            Nous avons caché chaque {NOUN[profile]} tour à tour, et laissé le planificateur choisir autant d’adresses
            qu’il en a vraiment. Ses choix tombent à moins de {backtest.within_minutes} minutes à pied de{' '}
            <strong>{pct(found['planner'])}</strong> de ses vraies boutiques, contre {pct(found['random'])} pour des
            adresses au hasard et {pct(found['lookalike'])} pour les blocs les mieux notés.{' '}
            {found['planner'] >= found['lookalike']
              ? 'Pour ce profil, le planificateur retrouve donc les vrais choix mieux que la note seule, et il dit en plus ce que chaque adresse capte et prend à la marque.'
              : 'Pour ce profil, la note seule retrouve donc mieux les vrais choix ; le planificateur ajoute ce que chaque adresse capte et prend à la marque.'}
          </p>
        )}
        <p className="muted small">
          {tr(
            `Limites : la demande est un indice issu de données ouvertes, pas des ventes ; l’accès se fait à pied seulement ; l’attrait d’une boutique ne dépend que du luxe autour. Seuls les blocs notés ${planner.suitable} ou plus sont retenus.`,
            `Limits: demand is an index from open data, not sales; access is on foot only; a boutique's pull depends only on the luxury around it. Only blocks scoring ${planner.suitable} or more are considered.`,
          )}{' '}
          <button className="link" onClick={props.onMethod}>
            {tr('Comment ça marche', 'How it works')}
          </button>
        </p>
      </details>
    </div>
  )
}
