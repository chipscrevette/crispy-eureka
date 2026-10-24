import type { AreaBar, Slice, TopBlock } from './dashboardData'

type Props = {
  title: string
  bars: AreaBar[]
  barNote: string
  colours: string[]
  mix: Slice[]
  mixColours: string[]
  mixTitle: string
  mixNote: string
  top: TopBlock[]
  topTitle: string
  onArea: (bar: AreaBar) => void
  onBlock: (cell: string) => void
}

function Donut({ slices, colours }: { slices: Slice[]; colours: string[] }) {
  const r = 34
  const c = 2 * Math.PI * r
  let at = 0
  return (
    <svg className="donut" viewBox="0 0 88 88" aria-hidden="true">
      {slices.map((s, i) => {
        const len = s.share * c
        const el = (
          <circle
            key={s.label}
            cx="44"
            cy="44"
            r={r}
            stroke={colours[i]}
            strokeDasharray={`${Math.max(len - 2, 0)} ${c}`}
            strokeDashoffset={-at}
            transform="rotate(-90 44 44)"
          />
        )
        at += len
        return el
      })}
    </svg>
  )
}

/** The cards under the map: they follow the layer, the profile and the selected block. */
export default function Dashboard(p: Props) {
  const most = Math.max(...p.bars.map((b) => b.value), 1e-9)
  return (
    <div className="charts">
      <section className="card chart" aria-labelledby="chart-areas">
        <h2 id="chart-areas" className="card-title">
          {p.title}
        </h2>
        <ol className="bars">
          {p.bars.map((b) => (
            <li key={b.name}>
              <button onClick={() => p.onArea(b)} title={`Show the ${b.name} on the map`}>
                <span className="bar-name">{b.name}</span>
                <span className="bar-track" aria-hidden="true">
                  <span style={{ width: `${(b.value / most) * 100}%`, background: p.colours[3] }} />
                </span>
                <span className="bar-value">{b.text}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="card-note">{p.barNote}</p>
      </section>

      <section className="card chart" aria-labelledby="chart-mix">
        <h2 id="chart-mix" className="card-title">
          {p.mixTitle}
        </h2>
        <div className="mix">
          <Donut slices={p.mix} colours={p.mixColours} />
          <ul className="mix-legend">
            {p.mix.map((s, i) => (
              <li key={s.label}>
                <span className="swatch" style={{ background: p.mixColours[i] }} aria-hidden="true" />
                <span>{s.label}</span>
                <span className="mix-value">{Math.round(s.share * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="card-note">{p.mixNote}</p>
      </section>

      <section className="card chart" aria-labelledby="chart-top">
        <h2 id="chart-top" className="card-title">
          {p.topTitle}
        </h2>
        <ol className="top">
          {p.top.map((t, i) => (
            <li key={t.cell}>
              <button onClick={() => p.onBlock(t.cell)}>
                <span className="top-n">{i + 1}</span>
                <span className="top-place">
                  {t.place} <span className="muted">· {t.detail}</span>
                </span>
                <span className="top-value">{t.text}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
