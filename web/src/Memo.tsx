import { useRef } from 'react'
import { useDialog } from './dialog'
import { centroid, distanceM, toMetres, type LonLat } from './geo'
import type { CellProps, Grid, GridMeta } from './grid'
import { cellScore, describeValue, ordinal, placeOf, rankText, scoreKey, SCORE_BREAKS, type Scores } from './scores'
import { PROFILES, type ProfileId, type Stores } from './stores'
import { lang, locale, tr } from './i18n'

const RADIUS_M = 450
const MAP_PX = 260
const OPACITY = [0.06, 0.2, 0.36, 0.54, 0.74]

type Props = {
  cell: CellProps
  profile: ProfileId
  grid: Grid
  stores: Stores
  scores: Scores
  meta: GridMeta
  onClose: () => void
}

export default function Memo({ cell, profile, grid, stores, scores, meta, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  useDialog(dialog, onClose)

  const entry = cellScore(scores, profile, cell.cell)
  const feature = grid.features.find((f) => f.properties.cell === cell.cell)
  if (!entry || !feature) return null
  const [score, drivers] = entry
  const centre = centroid(feature.geometry.coordinates[0])
  const label = PROFILES.find((p) => p.id === profile)?.label ?? profile
  const validation = scores.validation[profile]
  const nearby = stores.features
    .map((f) => ({ ...f.properties, d: distanceM(f.geometry.coordinates as LonLat, centre) }))
    .filter((s) => s.d <= RADIUS_M)
    .sort((x, y) => x.d - y.d)
  const today = new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="memo-backdrop" onClick={onClose}>
      <div
        className="memo"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memo-title"
        tabIndex={-1}
        ref={dialog}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="memo-tools">
          <button className="button" onClick={() => window.print()}>
            {tr('Imprimer ou enregistrer en PDF', 'Print or save as PDF')}
          </button>
          <button className="button secondary" onClick={onClose}>
            {tr('Fermer', 'Close')}
          </button>
        </div>

        <header className="memo-head">
          <p className="label">
            Adresse · {tr('Fiche du site', 'Site memo')} · {today}
          </p>
          <h1 id="memo-title">{placeOf(cell)}</h1>
          <p className="muted">
            {tr(`Boutique ${label.toLowerCase()} · bloc H3 `, `${label} boutique · H3 block `)}
            <code>{cell.cell}</code>
          </p>
        </header>

        <div className="memo-grid">
          <section>
            <p className="memo-score">
              <span className="big">{Math.round(score)}</span>
              <span className="muted"> / 100</span>
            </p>
            <p>
              {tr(
                `Pour une boutique ${label.toLowerCase()}, ce bloc ${rankText(score)}. La note mesure à quel point ses environs ressemblent aux blocs que les marques de luxe de ce type ont déjà choisis.`,
                `For a ${label.toLowerCase()} boutique, this block ${rankText(score)}. The score measures how closely its surroundings resemble the blocks that luxury brands of this kind already chose.`,
              )}
            </p>
          </section>
          <MiniMap centre={centre} grid={grid} stores={stores} profile={profile} cell={cell.cell} />
        </div>

        <section>
          <h2 className="label">{tr('Pourquoi cette note', 'Why this score')}</h2>
          <ul className="memo-drivers">
            {drivers.map(([key, contribution, value]) => {
              const d = describeValue(scores, key, value)
              return (
                <li key={key}>
                  <strong>{d.label}</strong>
                  {lang() === 'en'
                    ? `: ${d.text}. This ${contribution > 0 ? 'raises' : 'lowers'} the score${Math.abs(contribution) >= 1 ? ' strongly' : ''}.`
                    : ` : ${d.text}. Cela fait ${contribution > 0 ? 'monter' : 'baisser'} la note${Math.abs(contribution) >= 1 ? ' nettement' : ''}.`}
                </li>
              )
            })}
          </ul>
        </section>

        <section>
          <h2 className="label">{tr(`Boutiques de luxe à moins de ${RADIUS_M} m`, `Luxury boutiques within ${RADIUS_M} m`)}</h2>
          {nearby.length === 0 ? (
            <p className="muted">
              {tr(
                'Aucune dans le catalogue. Une marque qui s’installe ici ne rejoindrait pas un pôle existant.',
                'None in the catalogue. A first mover here would not be joining a cluster.',
              )}
            </p>
          ) : (
            <ul className="memo-nearby">
              {nearby.slice(0, 10).map((s) => (
                <li key={s.id}>
                  <span>{s.brand}</span>
                  <span className="muted small">
                    {PROFILES.find((p) => p.id === s.profile)?.label} · {Math.round(s.d / 10) * 10} m
                  </span>
                </li>
              ))}
              {nearby.length > 10 && (
                <li className="muted small">{tr(`et ${nearby.length - 10} autres`, `and ${nearby.length - 10} more`)}</li>
              )}
            </ul>
          )}
        </section>

        <section>
          <h2 className="label">{tr('Quelle confiance lui accorder', 'How far to trust it')}</h2>
          <p className="small">
            {tr(
              `Testé sur des marques que le modèle n’a jamais vues, leurs boutiques arrivent en moyenne au ${ordinal(validation.model.mean_percentile)} centile ; suivre simplement les autres boutiques de luxe donne le ${ordinal(validation['luxury neighbours'].mean_percentile)}. La note ne sait rien des loyers, des baux ni de la stratégie propre d’une marque. Elle sert à choisir où chercher, pas quoi signer.`,
              `Tested on brands the model never saw, their boutiques landed at the ${ordinal(validation.model.mean_percentile)} percentile on average; simply following other luxury boutiques gives the ${ordinal(validation['luxury neighbours'].mean_percentile)}. The score knows nothing about rents, vacant units, lease terms or a brand's own strategy. Use it to choose where to look, not what to sign.`,
            )}
          </p>
        </section>

        <footer className="muted small">
          {tr('Sources : ', 'Sources: ')}
          {meta.sources.join(' · ')} ·{' '}
          {tr('contributeurs OpenStreetMap. Fait avec Adresse, open source.', 'OpenStreetMap contributors. Built with Adresse, open source.')}
        </footer>
      </div>
    </div>
  )
}

type MiniMapProps = { centre: LonLat; grid: Grid; stores: Stores; profile: ProfileId; cell: string }

function MiniMap({ centre, grid, stores, profile, cell }: MiniMapProps) {
  const scale = MAP_PX / (2 * RADIUS_M)
  const project = (p: LonLat) => {
    const [x, y] = toMetres(p, centre)
    return [MAP_PX / 2 + x * scale, MAP_PX / 2 - y * scale]
  }
  const key = scoreKey(profile)
  const cells = grid.features.filter((f) => distanceM(centroid(f.geometry.coordinates[0]), centre) < RADIUS_M * 1.3)
  const points = stores.features.filter(
    (f) => f.properties.profile === profile && distanceM(f.geometry.coordinates as LonLat, centre) < RADIUS_M * 1.3,
  )
  const opacity = (v: unknown) => (typeof v === 'number' ? OPACITY[SCORE_BREAKS.filter((b) => v >= b).length] : 0)
  const path = (ring: number[][]) =>
    ring
      .map(
        (p, i) =>
          `${i ? 'L' : 'M'}${project(p as LonLat)
            .map((n) => n.toFixed(1))
            .join(' ')}`,
      )
      .join('') + 'Z'

  return (
    <figure className="minimap">
      <svg viewBox={`0 0 ${MAP_PX} ${MAP_PX}`} role="img" aria-label={tr('Notes des blocs voisins', 'Scores of the surrounding blocks')}>
        <rect width={MAP_PX} height={MAP_PX} className="minimap-bg" />
        {cells.map((f) => (
          <path
            key={f.properties.cell}
            d={path(f.geometry.coordinates[0])}
            className="minimap-cell"
            style={{ fillOpacity: opacity(f.properties[key]) }}
          />
        ))}
        {cells
          .filter((f) => f.properties.cell === cell)
          .map((f) => (
            <path key="selected" d={path(f.geometry.coordinates[0])} className="minimap-selected" />
          ))}
        {points.map((f) => {
          const [x, y] = project(f.geometry.coordinates as LonLat)
          return <circle key={f.properties.id} cx={x} cy={y} r={3.5} className="minimap-store" />
        })}
      </svg>
      <figcaption className="muted small">
        {tr(
          `Plus le bloc est foncé, plus sa note est haute. Les points sont les boutiques de ce profil. Environ ${RADIUS_M * 2} m de large.`,
          `Darker blocks score higher. Dots are existing boutiques of this profile. About ${RADIUS_M * 2} m across.`,
        )}
      </figcaption>
    </figure>
  )
}
