import type { CellProps } from './grid'
import { NEIGHBOURS, cellScore, describeValue, rankText, shortPlaceOf, type Driver, type Scores } from './scores'
import { PROFILES, type ProfileId } from './stores'

const profileLabel = (id: ProfileId) => PROFILES.find((p) => p.id === id)?.label ?? id

function Bar({ contribution, largest }: { contribution: number; largest: number }) {
  return (
    <span
      className={`bar ${contribution > 0 ? 'up' : 'down'}`}
      role="img"
      aria-label={contribution > 0 ? 'raises the score' : 'lowers the score'}
    >
      <span style={{ width: `${(Math.abs(contribution) / largest) * 100}%` }} />
    </span>
  )
}

type CellScoreProps = {
  cell: CellProps
  profile: ProfileId
  scores: Scores
  /** Blocks reachable on foot, drawn shaded on the map. */
  walk?: { minutes: number; blocks: number }
  onCompare: () => void
  onMemo: () => void
  picking: boolean
}

/** Score as a ring: the share of Paris this block beats. */
function ScoreRing({ score }: { score: number }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <svg className="ring" viewBox="0 0 72 72" aria-hidden="true">
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
  v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`

/** The block's own numbers from the pipeline, as tiles. Missing values are left out. */
function facts(cell: CellProps, walk?: { minutes: number; blocks: number }) {
  const num = (k: string) => (typeof cell[k] === 'number' ? (cell[k] as number) : undefined)
  const rows: { value?: string; label: string; title: string }[] = [
    {
      value: num('demand') !== undefined ? compact(num('demand')!) : undefined,
      label: 'spending demand',
      title: "Residents' income, workers and hotel guests in the block; Paris average = 100",
    },
    {
      value: walk && walk.blocks > 0 ? String(walk.blocks) : undefined,
      label: `blocks within ${walk?.minutes ?? ''} min on foot`,
      title: 'Blocks reachable along the streets, shaded on the map',
    },
    {
      value: num(NEIGHBOURS) !== undefined ? String(num(NEIGHBOURS)) : undefined,
      label: 'luxury boutiques around',
      title: 'Luxury boutiques of any profile in the six blocks around it',
    },
    {
      value: num('living_standard_r1') !== undefined ? `€${compact(num('living_standard_r1')!)}` : undefined,
      label: 'living standard / year',
      title: 'Mean disposable income per consumption unit of residents within about 350 m (INSEE Filosofi)',
    },
    {
      value: num('transit_entries_r2') !== undefined ? compact(num('transit_entries_r2')!) : undefined,
      label: 'station entries / day',
      title: 'Average daily entries at metro, RER and train stations within about 600 m (Île-de-France Mobilités)',
    },
    {
      value: num('apartment_price_m2') !== undefined ? `€${compact(num('apartment_price_m2')!)}` : undefined,
      label: 'apartment price / m²',
      title: 'Median sale price of apartments within about 350 m (DVF)',
    },
  ]
  return rows.filter((r) => r.value !== undefined)
}

export function CellScore({ cell, profile, scores, walk, onCompare, onMemo, picking }: CellScoreProps) {
  const entry = cellScore(scores, profile, cell.cell)
  if (!entry) return null
  const [score, drivers] = entry
  const largest = Math.max(...drivers.map((d) => Math.abs(d[1])), 1e-9)
  return (
    <div className="cell-score">
      <div className="score-head">
        <ScoreRing score={score} />
        <div>
          <h2 className="place">{shortPlaceOf(cell)}</h2>
          <p className="muted small">
            {profileLabel(profile)} opportunity: this block {rankText(score)}.
          </p>
        </div>
      </div>
      <ul className="tiles" aria-label="This block in numbers">
        {facts(cell, walk).map((f) => (
          <li key={f.label} className="tile" title={f.title}>
            <span className="tile-value">{f.value}</span>
            <span className="tile-label">{f.label}</span>
          </li>
        ))}
      </ul>
      <h3 className="label">What drives the score</h3>
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
      <p className="muted small">Green bars raise the score, grey bars lower it.</p>
      <div className="actions">
        <button className="button" onClick={onMemo}>
          Site memo
        </button>
        <button className="button secondary" onClick={onCompare} aria-pressed={picking}>
          {picking ? 'Tap a second block…' : 'Compare'}
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
      ? 'Both blocks score the same.'
      : `${gap > 0 ? 'A' : 'B'} scores ${Math.abs(gap)} point${Math.abs(gap) === 1 ? '' : 's'} higher.`

  return (
    <section className="compare" aria-live="polite">
      <h2 className="label">Compare</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Feature</span>
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
        {verdict} Bars show each block's own top drivers; a value without a bar did not move that block's score much.
      </p>
      <div className="actions">
        <button className="button" onClick={onMemo}>
          Memo for A
        </button>
        <button className="button secondary" onClick={onClear}>
          Stop comparing
        </button>
      </div>
    </section>
  )
}
