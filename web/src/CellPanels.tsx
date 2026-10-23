import type { CellProps } from './grid'
import { cellScore, describeValue, placeOf, rankText, shortPlaceOf, type Driver, type Scores } from './scores'
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
  onCompare: () => void
  onMemo: () => void
  picking: boolean
}

export function CellScore({ cell, profile, scores, onCompare, onMemo, picking }: CellScoreProps) {
  const entry = cellScore(scores, profile, cell.cell)
  if (!entry) return null
  const [score, drivers] = entry
  const largest = Math.max(...drivers.map((d) => Math.abs(d[1])), 1e-9)
  return (
    <div className="cell-score">
      <p className="score">
        <span className="big">{Math.round(score)}</span>
        <span className="muted"> / 100 in {placeOf(cell)}</span>
      </p>
      <p className="muted small">
        {profileLabel(profile)} opportunity: this block {rankText(score)}.
      </p>
      <h3 className="label">What drives it</h3>
      <p className="muted small">Teal bars raise the score, grey bars lower it.</p>
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
