import type { CellProps, Grid } from './grid'
import LayerStack from './LayerStack'
import { NEIGHBOURS, cellScore, describeValue, rankText, shortPlaceOf, type Driver, type Scores } from './scores'
import { BIG_EMPTY, EMPTY, LUXURY, VACANCY, WEAK_KEY } from './dashboardData'
import { PROFILES, type ProfileId } from './stores'
import { fmt, lang, tr } from './i18n'

/** "1 brand" / "2 brands"; a French noun and its adjective both take the s: "2 boutiques vides". */
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : word.replace(/(\S)(?=\s|$)/g, '$1s')}`

const profileLabel = (id: ProfileId) => PROFILES.find((p) => p.id === id)?.label ?? id

function Bar({ contribution, largest }: { contribution: number; largest: number }) {
  return (
    <span
      className={`bar ${contribution > 0 ? 'up' : 'down'}`}
      role="img"
      aria-label={contribution > 0 ? tr('fait monter la note', 'raises the score') : tr('fait baisser la note', 'lowers the score')}
    >
      <span style={{ width: `${(Math.abs(contribution) / largest) * 100}%` }} />
    </span>
  )
}

type CellScoreProps = {
  cell: CellProps
  grid: Grid
  profile: ProfileId
  scores: Scores
  /** What the block reaches on foot, drawn shaded on the map. */
  zone?: Zone
  /** The searched address in this block, if any. */
  address?: string
  onCompare: () => void
  onMemo: () => void
  picking: boolean
}

/** What a block reaches on foot (computed in the app from the pipeline's catchments and demand). */
export type Zone = {
  minutes: number
  blocks: number
  /** Spending demand reached, in average Paris blocks. */
  demand: number
  /** Share of that demand from each group, in the pipeline's group order. */
  split: { label: string; share: number }[]
  boutiques: number
  brands: number
}

function ZoneCard({ zone, profile }: { zone: Zone; profile: ProfileId }) {
  return (
    <section className="zone" aria-label={tr(`À ${zone.minutes} minutes à pied`, `Within a ${zone.minutes}-minute walk`)}>
      <ul className="tiles">
        <li
          className="tile"
          title={tr(
            'Pouvoir d’achat de tous les blocs à portée de marche ; 1 = un bloc parisien moyen',
            'Spending demand of every block in the walk; 1 = an average Paris block',
          )}
        >
          <span className="tile-value">{fmt(zone.demand, 1)}</span>
          <span className="tile-label">{tr('blocs moyens de pouvoir d’achat', 'average blocks of spending')}</span>
        </li>
        <li
          className="tile"
          title={tr('Boutiques du catalogue de ce profil dans les blocs à portée de marche', 'Catalogue boutiques of this profile in the blocks of the walk')}
        >
          <span className="tile-value">{zone.boutiques}</span>
          <span className="tile-label">
            {tr(
              `boutiques ${profileLabel(profile).toLowerCase()}, ${plural(zone.brands, 'marque')}`,
              `${profileLabel(profile).toLowerCase()} boutiques, ${plural(zone.brands, 'brand')}`,
            )}
          </span>
        </li>
      </ul>
      <div className="split" role="img" aria-label={zone.split.map((g) => `${g.label} ${pct(g.share)}`).join(', ')}>
        {zone.split.map((g, i) => (
          <span key={g.label} className={`split-${i}`} style={{ flexGrow: g.share }} />
        ))}
      </div>
      <ul className="split-legend small" aria-hidden="true">
        {zone.split.map((g, i) => (
          <li key={g.label}>
            <span className={`swatch split-${i}`} /> {g.label} {pct(g.share)}
          </li>
        ))}
      </ul>
      <p className="muted small">
        {tr(
          `${zone.blocks} blocs, ombrés sur la carte. La barre montre d’où vient leur pouvoir d’achat.`,
          `${zone.blocks} blocks, shaded on the map. The bar shows where their spending comes from.`,
        )}
      </p>
    </section>
  )
}

const pct = (share: number) => `${Math.round(share * 100)}${lang() === 'en' ? '%' : ' %'}`

/** Score as a ring: the share of Paris this block beats. */
function ScoreRing({ score }: { score: number }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <svg className="ring" viewBox="0 0 72 72" aria-hidden="true">
      <defs>
        <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--seine)" />
          <stop offset="1" stopColor="var(--ring-end)" />
        </linearGradient>
      </defs>
      <circle className="ring-track" cx="36" cy="36" r={r} />
      <circle
        className="ring-value"
        cx="36"
        cy="36"
        r={r}
        strokeDasharray={`${(c * score) / 100} ${c}`}
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="36" dy="0.35em" textAnchor="middle">
        {Math.round(score)}
      </text>
    </svg>
  )
}

const compact = (v: number) =>
  v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${fmt(v / 1000, 1)}k` : `${Math.round(v)}`
/** €12k in English, 12k € in French. */
const euros = (v: number) => (lang() === 'en' ? `€${compact(v)}` : `${compact(v)} €`)

/** The block's own numbers from the pipeline, as tiles. Missing values are left out. */
function facts(cell: CellProps) {
  const num = (k: string) => (typeof cell[k] === 'number' ? (cell[k] as number) : undefined)
  const rows: { value?: string; label: string; title: string }[] = [
    {
      value: num('demand') !== undefined ? compact(num('demand')!) : undefined,
      label: tr('pouvoir d’achat', 'spending demand'),
      title: tr(
        'Revenus des habitants, actifs et clients d’hôtel du bloc ; moyenne de Paris = 100',
        "Residents' income, workers and hotel guests in the block; Paris average = 100",
      ),
    },
    {
      value: num('street_footfall') !== undefined ? `${fmt(num('street_footfall')!, 1)}×` : undefined,
      label: tr('passage dans sa rue la plus fréquentée', 'footfall of its busiest street'),
      title: tr(
        'Passage dans la rue la plus fréquentée du bloc, comparé à une rue parisienne type (estimé à partir du réseau de rues)',
        'Walks past the busiest street of the block, compared with a typical Paris street (estimated from the street network)',
      ),
    },
    {
      value: num('upscale_rooms_r1') !== undefined ? compact(num('upscale_rooms_r1')!) : undefined,
      label: tr('chambres d’hôtels 4 et 5 étoiles', '4- and 5-star hotel rooms'),
      title: tr(
        'Chambres d’hôtels 4 et 5 étoiles dans le bloc et autour (Atout France)',
        'Rooms in 4- and 5-star hotels in the block and around it (Atout France)',
      ),
    },
    {
      value: num(NEIGHBOURS) !== undefined ? String(num(NEIGHBOURS)) : undefined,
      label: tr('boutiques de luxe autour', 'luxury boutiques around'),
      title: tr('Boutiques de luxe de tous profils dans les six blocs autour', 'Luxury boutiques of any profile in the six blocks around it'),
    },
    {
      value: num('living_standard_r1') !== undefined ? euros(num('living_standard_r1')!) : undefined,
      label: tr('niveau de vie / an', 'living standard / year'),
      title: tr(
        'Revenu disponible moyen par unité de consommation des habitants à environ 350 m (INSEE Filosofi)',
        'Mean disposable income per consumption unit of residents within about 350 m (INSEE Filosofi)',
      ),
    },
    {
      value: num('transit_entries_r2') !== undefined ? compact(num('transit_entries_r2')!) : undefined,
      label: tr('entrées en gare / jour', 'station entries / day'),
      title: tr(
        'Entrées moyennes par jour dans les stations de métro, RER et train à environ 600 m (Île-de-France Mobilités)',
        'Average daily entries at metro, RER and train stations within about 600 m (Île-de-France Mobilités)',
      ),
    },
    {
      value: num('apartment_price_m2') !== undefined ? euros(num('apartment_price_m2')!) : undefined,
      label: tr('prix des appartements / m²', 'apartment price / m²'),
      title: tr('Prix de vente médian des appartements à environ 350 m (DVF)', 'Median sale price of apartments within about 350 m (DVF)'),
    },
  ]
  return rows.filter((r) => r.value !== undefined)
}

/** The score in plain words. The classes follow SCORE_BREAKS. */
function verdict(score: number) {
  if (score >= 95) return tr('L’une des meilleures adresses de Paris', 'One of the best places in Paris')
  if (score >= 90) return tr('Une excellente adresse', 'An excellent place')
  if (score >= 75) return tr('Une très bonne adresse', 'A very good place')
  if (score >= 50) return tr('Une adresse correcte', 'A fair place')
  return tr('Pas un choix naturel', 'Not a natural fit')
}

const NOUN: Record<ProfileId, string> = {
  'jewellery-watches': tr('un joaillier ou un horloger', 'a jeweller or watchmaker'),
  'fashion-house': tr('une maison de mode', 'a fashion house'),
  beauty: tr('une marque de beauté', 'a beauty brand'),
}

/** A few facts anyone can read; each comes straight from the block's pipeline values. */
function keyFacts(cell: CellProps) {
  const num = (k: string) => (typeof cell[k] === 'number' ? (cell[k] as number) : undefined)
  const out: string[] = []
  // the catalogue boutiques in the block and around it: the dots on the map
  const lux = LUXURY.reduce((t, k) => t + (num(k) ?? 0), 0)
  out.push(
    lux
      ? tr(`${plural(lux, 'boutique')} de luxe dans ce bloc et autour`, `${lux} luxury boutique${lux === 1 ? '' : 's'} in and around this block`)
      : tr('Aucune boutique de luxe dans ce bloc ni autour pour l’instant', 'No luxury boutique in or around this block yet'),
  )
  // what there is to move into, from Apur's census of ground floors
  const empty = num(EMPTY)
  const big = num(BIG_EMPTY)
  if (empty !== undefined && big !== undefined)
    out.push(
      big
        ? tr(
            `${plural(big, 'boutique vide')} de 300 m² ou plus à proximité, ${empty} vides en tout`,
            `${big} empty shop${big === 1 ? '' : 's'} of 300 m² or more nearby, ${empty} empty in all`,
          )
        : tr(
            `${plural(empty, 'boutique vide')} à proximité, aucune de 300 m² ou plus`,
            `${empty} empty shop${empty === 1 ? '' : 's'} nearby, none of 300 m² or more`,
          ),
    )
  const share = num(VACANCY)
  if (share !== undefined && cell[WEAK_KEY] === 1)
    out.push(
      tr(
        `${pct(share)} des boutiques autour sont vides, plus que dans la plupart de Paris`,
        `${pct(share)} of the shops around stand empty, more than in most of Paris`,
      ),
    )
  // at least four of the seven blocks inside: the block is in the zone or on its edge
  const tourist = num('tourist_zone_r1')
  if (tourist !== undefined && tourist >= 0.5)
    out.push(
      tr(
        'En zone touristique internationale : les boutiques peuvent ouvrir le dimanche et en soirée',
        'In an international tourist zone: shops may open on Sundays and late in the evening',
      ),
    )
  return out
}

export function CellScore({ cell, grid, profile, scores, zone, address, onCompare, onMemo, picking }: CellScoreProps) {
  const entry = cellScore(scores, profile, cell.cell)
  if (!entry) return null
  const [score, drivers] = entry
  const largest = Math.max(...drivers.map((d) => Math.abs(d[1])), 1e-9)
  return (
    <div className="cell-score">
      <div className="score-head">
        <ScoreRing score={score} />
        <div>
          <h2 className="place">{address ?? shortPlaceOf(cell)}</h2>
          <p className="verdict">
            {verdict(score)} {tr('pour', 'for')} {NOUN[profile]}.
          </p>
          <p className="muted small">
            {tr('Ce bloc', 'This block')} {rankText(score)}.
          </p>
        </div>
      </div>
      <LayerStack grid={grid} cell={cell} profile={profile} />
      <ul className="facts">
        {keyFacts(cell).map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      <details className="more">
        <summary>{tr('Pourquoi cette note ?', 'Why this score?')}</summary>
        <ul className="drivers">
          {drivers.map(([key, contribution, value]) => {
            const d = describeValue(scores, key, value)
            return (
              <li key={key} title={d.description}>
                <span className="driver-name">{d.label}</span>
                <span className="driver-value">{d.text}</span>
                <Bar contribution={contribution} largest={largest} />
              </li>
            )
          })}
        </ul>
        <p className="muted small">{tr('Les barres longues font monter la note, les grises la font baisser.', 'Long bars raise the score, grey bars lower it.')}</p>
      </details>
      {zone && (
        <details className="more">
          <summary>{tr(`Qu’y a-t-il à ${zone.minutes} minutes à pied ?`, `What is within a ${zone.minutes}-minute walk?`)}</summary>
          <ZoneCard zone={zone} profile={profile} />
        </details>
      )}
      <details className="more">
        <summary>{tr('Tous les chiffres', 'All the numbers')}</summary>
        <ul className="tiles" aria-label={tr('Ce bloc en chiffres', 'This block in numbers')}>
          {facts(cell).map((f) => (
            <li key={f.label} className="tile" title={f.title}>
              <span className="tile-value">{f.value}</span>
              <span className="tile-label">{f.label}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="actions">
        <button className="button secondary" onClick={onCompare} aria-pressed={picking}>
          {picking ? tr('Cliquez sur un second bloc…', 'Now tap a second block…') : tr('Comparer avec un autre bloc', 'Compare with another block')}
        </button>
        <button className="button secondary" onClick={onMemo}>
          {tr('Fiche du site', 'Site memo')}
        </button>
      </div>
    </div>
  )
}

type CompareProps = {
  a: CellProps
  b: CellProps
  profile: ProfileId
  scores: Scores
  onMemo: () => void
  onClear: () => void
}

export function Compare({ a, b, profile, scores, onMemo, onClear }: CompareProps) {
  const ea = cellScore(scores, profile, a.cell)
  const eb = cellScore(scores, profile, b.cell)
  if (!ea || !eb) return null
  const contrib = (e: [number, Driver[]], key: string) => e[1].find((d) => d[0] === key)?.[1]
  const keys = [...new Set([...ea[1], ...eb[1]].map((d) => d[0]))].sort(
    (x, y) =>
      Math.max(Math.abs(contrib(ea, y) ?? 0), Math.abs(contrib(eb, y) ?? 0)) -
      Math.max(Math.abs(contrib(ea, x) ?? 0), Math.abs(contrib(eb, x) ?? 0)),
  )
  const largest = Math.max(...[...ea[1], ...eb[1]].map((d) => Math.abs(d[1])), 1e-9)
  const sides = [
    { name: 'A', cell: a, entry: ea },
    { name: 'B', cell: b, entry: eb },
  ]
  const gap = Math.round(ea[0]) - Math.round(eb[0])
  const verdict =
    gap === 0
      ? tr('Les deux blocs ont la même note.', 'Both blocks score the same.')
      : tr(
          `${gap > 0 ? 'A' : 'B'} a ${plural(Math.abs(gap), 'point')} de plus.`,
          `${gap > 0 ? 'A' : 'B'} scores ${plural(Math.abs(gap), 'point')} higher.`,
        )

  return (
    <section className="compare" aria-live="polite">
      <h2 className="label">{tr('Comparer', 'Compare')}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">{tr('Critère', 'Feature')}</span>
            </th>
            {sides.map((s) => (
              <th scope="col" key={s.name}>
                <span className={`tag tag-${s.name.toLowerCase()}`}>{s.name}</span>
                <span className="compare-score">{Math.round(s.entry[0])}</span>
                <span className="muted small">{shortPlaceOf(s.cell)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const d = describeValue(scores, key, null)
            return (
              <tr key={key}>
                <th scope="row" title={d.description}>
                  {d.label}
                </th>
                {sides.map((s) => {
                  const x = contrib(s.entry, key)
                  return (
                    <td key={s.name}>
                      <span className="driver-value">{describeValue(scores, key, s.cell[key]).text}</span>
                      {x !== undefined && <Bar contribution={x} largest={largest} />}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted small">
        {verdict}{' '}
        {tr(
          'Les barres montrent les principaux moteurs de chaque bloc ; une valeur sans barre a peu pesé sur sa note.',
          "Bars show each block's own top drivers; a value without a bar did not move that block's score much.",
        )}
      </p>
      <div className="actions">
        <button className="button" onClick={onMemo}>
          {tr('Fiche de A', 'Memo for A')}
        </button>
        <button className="button secondary" onClick={onClear}>
          {tr('Arrêter la comparaison', 'Stop comparing')}
        </button>
      </div>
    </section>
  )
}
