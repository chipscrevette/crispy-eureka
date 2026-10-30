import { useMemo, useState } from 'react'
import type { Data } from './appData'
import { ATLAS, atlasKey, useOutline } from './atlasLayers'
import { kilo, num, short, type Placed } from './blocks'
import type { Borders } from './borders'
import { openKey } from './dashboardData'
import { fmt, sourceShort, tr } from './i18n'
import { coloursOf, rampFor } from './palette'
import { scoreKey } from './scores'
import type { ProfileId } from './stores'

type Layer = (typeof ATLAS)[number]['id']

/** One arrondissement in numbers: each layer's value, its free spots and its blocks. */
type Arr = { n: number; blocks: number; free: number; values: Record<Layer, number> }

/**
 * Each layer read for a whole arrondissement. Boutiques and station entries are counted from their points,
 * placed in a block; the other layers are the average of the arrondissement's blocks.
 */
const HOW: Record<Layer, 'mean' | 'stores' | 'stations'> = {
  score: 'mean',
  demand: 'mean',
  street_footfall: 'mean',
  transit_entries_r2: 'stations',
  fashion_stores_r1: 'mean',
  luxury: 'stores',
  upscale_rooms_r1: 'mean',
  offices_r1: 'mean',
  commercial_price_m2: 'mean',
}

/** A value short enough to sit on the map. */
function compact(id: Layer, v: number) {
  if (id === 'score') return fmt(v)
  if (id === 'demand') return `${fmt(v / 100, 1)}×`
  if (id === 'street_footfall') return `${fmt(v, 1)}×`
  if (id === 'transit_entries_r2') return kilo(v)
  if (id === 'commercial_price_m2') return `${kilo(v)} €`
  return fmt(v)
}

/** What the number of an arrondissement means, in a few words. */
function unit(id: Layer) {
  const u: Record<Layer, () => string> = {
    score: () => tr('note moyenne des blocs, sur 100', 'average block score, out of 100'),
    demand: () => tr('indice de clientèle moyen', 'average customer index'),
    street_footfall: () => tr('centralité moyenne, rue type = 1×', 'average street centrality, typical street = 1×'),
    transit_entries_r2: () => tr('validations par jour, gares de l’arrondissement', 'validations a day, stations in the arrondissement'),
    fashion_stores_r1: () => tr('boutiques de mode à 350 m, en moyenne', 'fashion shops within 350 m, on average'),
    luxury: () => tr('boutiques de ce type', 'boutiques of this type'),
    upscale_rooms_r1: () => tr('chambres haut de gamme à 350 m, en moyenne', 'upscale rooms within 350 m, on average'),
    offices_r1: () => tr('bureaux et banques à 350 m, en moyenne', 'offices and banks within 350 m, on average'),
    commercial_price_m2: () => tr('prix de vente moyen des murs, € / m² (DVF)', 'average sale price of premises, € / m² (DVF)'),
  }
  return u[id]()
}

/** Dark or light text, whichever reads on a fill. */
function inkOn(hex: string) {
  const v = parseInt(hex.slice(1, 7), 16)
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1c1b1f' : '#ffffff'
}

const mega = (n: number) => (n >= 1e6 ? `${fmt(n / 1e6, 1)} M` : kilo(n))

const arrOf = (name: unknown) => {
  const m = /(\d+)/.exec(String(name ?? ''))
  return m ? Number(m[1]) : null
}
const nth = (n: number) => (n === 1 ? tr('1er', '1st') : tr(`${n}e`, `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`))

/** Rank classes 0..4 of each arrondissement on one layer: the same five colours as the map's ramp. */
function classes(rows: Arr[], id: Layer) {
  const order = [...rows].sort((a, b) => a.values[id] - b.values[id])
  return new Map(order.map((r, i) => [r.n, Math.min(4, Math.floor((i / order.length) * 5))]))
}

/**
 * Paris in numbers, arrondissement by arrondissement: the key figures, a map of the arrondissements on one
 * layer, their ranking, every layer side by side, the chosen arrondissement against the others, and where
 * spending meets footfall.
 */
export default function ParisView(props: {
  data: Data
  profile: ProfileId
  borders: Borders | null
  placed: Map<string, string>
  stations: Placed[]
  onBlock: (cell: string) => void
}) {
  const { data, profile, borders, placed, stations } = props
  const [layer, setLayer] = useState<Layer>('score')
  const [chosen, setChosen] = useState(8)
  const key = scoreKey(profile)

  const { rows, paris } = useMemo(() => {
    const arrOfCell = new Map(data.grid.features.map((f) => [f.properties.cell, arrOf(f.properties.arrondissement)]))
    const by = new Map<number, { blocks: number; free: number; sums: Record<string, [number, number]>; stores: number; entries: number }>()
    const get = (n: number) => {
      if (!by.has(n)) by.set(n, { blocks: 0, free: 0, sums: {}, stores: 0, entries: 0 })
      return by.get(n)!
    }
    for (const f of data.grid.features) {
      const p = f.properties
      const n = arrOfCell.get(p.cell)
      if (!n) continue
      const a = get(n)
      a.blocks++
      if (p[openKey(key)] === 1) a.free++
      for (const l of ATLAS) {
        const v = num(p, atlasKey(l.id, profile))
        if (v === null) continue
        const s = (a.sums[l.id] ??= [0, 0])
        s[0] += v
        s[1]++
      }
    }
    for (const f of data.stores.features) {
      const n = arrOfCell.get(placed.get(f.properties.id) ?? '')
      if (f.properties.profile === profile && n) get(n).stores++
    }
    for (const s of stations) {
      const n = arrOfCell.get(s.cell)
      if (n) get(n).entries += s.p.entries
    }
    const rows: Arr[] = [...by].map(([n, a]) => ({
      n,
      blocks: a.blocks,
      free: a.free,
      values: Object.fromEntries(
        ATLAS.map((l) => [l.id, HOW[l.id] === 'stores' ? a.stores : HOW[l.id] === 'stations' ? a.entries : a.sums[l.id] ? a.sums[l.id][0] / a.sums[l.id][1] : 0]),
      ) as Record<Layer, number>,
    }))
    rows.sort((a, b) => a.n - b.n)
    const stores = data.stores.features.filter((f) => f.properties.profile === profile)
    return {
      rows,
      paris: {
        blocks: rows.reduce((s, r) => s + r.blocks, 0),
        free: rows.reduce((s, r) => s + r.free, 0),
        boutiques: stores.length,
        brands: new Set(stores.map((f) => f.properties.brand)).size,
        stations: stations.length,
        entries: stations.reduce((s, x) => s + x.p.entries, 0),
      },
    }
  }, [data, profile, key, placed, stations])

  const here = rows.find((r) => r.n === chosen) ?? rows[0]
  const ramp = (id: Layer) => coloursOf(rampFor(atlasKey(id, profile)))
  const cls = useMemo(() => new Map(ATLAS.map((l) => [l.id, classes(rows, l.id)])), [rows])
  const colourOf = (id: Layer, n: number) => ramp(id)[cls.get(id)?.get(n) ?? 0]
  const best = [...rows].sort((a, b) => b.values.score - a.values.score)[0]

  // the chosen arrondissement's best free spot, to open on the overview
  const bestFree = useMemo(() => {
    const spots = data.grid.features
      .map((f) => f.properties)
      .filter((p) => arrOf(p.arrondissement) === chosen && p[openKey(key)] === 1)
      .sort((a, b) => (num(b, key) ?? 0) - (num(a, key) ?? 0))
    return spots[0] ?? null
  }, [data, chosen, key])

  if (!here) return null
  const src = (word: string, name: string) => sourceShort(data.meta.sources, word, name)
  const kpis: { value: string; label: string; layer: Layer; source: string }[] = [
    { value: fmt(paris.free), label: tr('sites avec local vide (2023)', 'sites with an empty shop (2023)'), layer: 'score', source: src('BDCOM', 'Apur') },
    { value: fmt(paris.boutiques), label: tr(`boutiques de ce type, ${paris.brands} marques`, `boutiques of this type, ${paris.brands} brands`), layer: 'luxury', source: src('Overture Maps Places', 'Overture') },
    { value: fmt(paris.stations), label: tr('gares de métro et RER', 'metro and RER stations'), layer: 'transit_entries_r2', source: src('Mobilités', 'IDFM') },
    { value: mega(paris.entries), label: tr('validations par jour, gares de Paris', 'validations a day, Paris stations'), layer: 'transit_entries_r2', source: src('Mobilités', 'IDFM') },
    { value: nth(best.n), label: tr('meilleure ressemblance moyenne', 'best average likeness'), layer: 'score', source: tr('notre modèle', 'our model') },
    { value: fmt(paris.blocks), label: tr('blocs de 200 m étudiés', '200 m blocks studied'), layer: 'score', source: 'Uber H3' },
  ]

  return (
    <main className="dash-page paris-page">
      <section className="paris-kpis" aria-label={tr('Paris en chiffres', 'Paris in numbers')}>
        {kpis.map((k) => (
          <button key={k.label} className="paris-kpi" onClick={() => setLayer(k.layer)}>
            <span className="paris-kpi-value">{k.value}</span>
            <span className="paris-kpi-label">{k.label}</span>
            <span className="dash-figure-source">{k.source}</span>
          </button>
        ))}
      </section>

      <section className="dash-card paris-map-card">
        <div className="paris-card-head">
          <div>
            <p className="dash-kicker">{tr('Les 20 arrondissements', 'The 20 arrondissements')}</p>
            <h2 className="paris-title">{ATLAS.find((l) => l.id === layer)!.label}</h2>
            <p className="muted paris-unit">{unit(layer)}</p>
          </div>
          <Legend colours={ramp(layer)} />
        </div>
        <ArrMap data={data} borders={borders} rows={rows} layer={layer} chosen={chosen} colourOf={colourOf} onPick={setChosen} />
        <Ranking rows={rows} layer={layer} chosen={chosen} colourOf={colourOf} onPick={setChosen} />
      </section>

      <section className="dash-card paris-matrix-card">
        <p className="dash-kicker">{tr('Chaque couche, chaque arrondissement', 'Every layer, every arrondissement')}</p>
        <Matrix rows={rows} layer={layer} chosen={chosen} colourOf={colourOf} onLayer={setLayer} onPick={setChosen} />
        <p className="dash-note muted">{tr('Couleur : rang de l’arrondissement sur la couche, du plus bas au plus haut.', 'Colour: the arrondissement’s rank on the layer, lowest to highest.')}</p>
      </section>

      <section className="dash-card paris-side">
        <div className="paris-card-head">
          <div>
            <p className="dash-kicker">{tr('Arrondissement choisi', 'Chosen arrondissement')}</p>
            <h2 className="paris-title">{tr(`Le ${nth(here.n)}`, `The ${nth(here.n)}`)}</h2>
          </div>
          <div className="paris-side-figures">
            <span>
              <b>{fmt(here.values.score)}</b>
              {tr('ressemblance', 'likeness')}
            </span>
            <span>
              <b>{fmt(here.free)}</b>
              {tr('sites avec local vide (2023)', 'sites with an empty shop (2023)')}
            </span>
            <span>
              <b>{fmt(here.values.luxury)}</b>
              {tr('boutiques', 'boutiques')}
            </span>
          </div>
        </div>
        <Radar rows={rows} chosen={here} ramp={ramp} />
        {bestFree && (
          <button className="paris-open" onClick={() => props.onBlock(bestFree.cell)}>
            {tr(`Voir son meilleur site avec local vide (${short(bestFree)}, ${Math.round(num(bestFree, key) ?? 0)}/100) →`, `See its best site with an empty shop (${short(bestFree)}, ${Math.round(num(bestFree, key) ?? 0)}/100) →`)}
          </button>
        )}
        <div className="paris-bubbles-head">
          <p className="dash-kicker">{tr('Clientèle et centralité de la rue', 'Customers and street centrality')}</p>
          <p className="muted">{tr('Taille : boutiques de ce type', 'Size: boutiques of this type')}</p>
        </div>
        <Bubbles rows={rows} chosen={chosen} colourOf={colourOf} onPick={setChosen} />
      </section>
    </main>
  )
}

function Legend(props: { colours: string[] }) {
  return (
    <div className="paris-legend" aria-hidden="true">
      <span className="muted">{tr('bas', 'low')}</span>
      {props.colours.map((c) => (
        <i key={c} style={{ background: c }} />
      ))}
      <span className="muted">{tr('haut', 'high')}</span>
    </div>
  )
}

/** The arrondissements as they are, not as blocks: each in its class colour with its number and value. */
function ArrMap(props: {
  data: Data
  borders: Borders | null
  rows: Arr[]
  layer: Layer
  chosen: number
  colourOf: (id: Layer, n: number) => string
  onPick: (n: number) => void
}) {
  const outline = useOutline(props.data.grid)
  const shapes = useMemo(
    () =>
      (props.borders?.features ?? [])
        .filter((f) => f.properties.n)
        .map((f) => ({
          n: f.properties.n!,
          d: f.geometry.coordinates.map((ring) => 'M' + ring.map((c) => outline.project(c).map((v) => (v * 1000).toFixed(1)).join(',')).join('L') + 'Z').join(''),
          at: outline.project(f.properties.label ?? f.geometry.coordinates[0][0]).map((v) => v * 1000),
        })),
    [props.borders, outline],
  )
  if (!shapes.length) return <p className="dash-empty">{tr('Contours des arrondissements indisponibles.', 'Arrondissement outlines unavailable.')}</p>
  const value = new Map(props.rows.map((r) => [r.n, r.values[props.layer]]))
  const h = outline.aspect * 1000
  return (
    <svg className="paris-map" viewBox={`-10 -10 1020 ${h + 20}`} role="img" aria-label={tr('Carte des arrondissements', 'Map of the arrondissements')}>
      {shapes.map((s) => (
        <path
          key={s.n}
          d={s.d}
          fill={props.colourOf(props.layer, s.n)}
          className={s.n === props.chosen ? 'is-chosen' : undefined}
          onClick={() => props.onPick(s.n)}
        >
          <title>{`${nth(s.n)} · ${compact(props.layer, value.get(s.n) ?? 0)}`}</title>
        </path>
      ))}
      {shapes.map((s) => (
        <g key={s.n} className="paris-map-label" transform={`translate(${s.at[0]},${s.at[1]})`} fill={inkOn(props.colourOf(props.layer, s.n))}>
          {s.n > 4 && (
            <text className="paris-map-n" y={-10}>
              {nth(s.n)}
            </text>
          )}
          <text className="paris-map-v" y={s.n > 4 ? 14 : 8}>
            {compact(props.layer, value.get(s.n) ?? 0)}
          </text>
        </g>
      ))}
    </svg>
  )
}

/** The 20 arrondissements from highest to lowest on the layer. */
function Ranking(props: { rows: Arr[]; layer: Layer; chosen: number; colourOf: (id: Layer, n: number) => string; onPick: (n: number) => void }) {
  const order = [...props.rows].sort((a, b) => b.values[props.layer] - a.values[props.layer])
  const max = Math.max(...order.map((r) => r.values[props.layer]), 1e-9)
  return (
    <div className="paris-ranking" role="list">
      {order.map((r) => (
        <button key={r.n} role="listitem" aria-pressed={r.n === props.chosen} onClick={() => props.onPick(r.n)} title={`${nth(r.n)} · ${compact(props.layer, r.values[props.layer])}`}>
          <span className="paris-ranking-bar" style={{ height: `${Math.max(3, (r.values[props.layer] / max) * 100)}%`, background: props.colourOf(props.layer, r.n) }} />
          <span className="paris-ranking-n">{r.n}</span>
        </button>
      ))}
    </div>
  )
}

/** Every layer side by side for every arrondissement, each cell in its rank colour. */
function Matrix(props: {
  rows: Arr[]
  layer: Layer
  chosen: number
  colourOf: (id: Layer, n: number) => string
  onLayer: (l: Layer) => void
  onPick: (n: number) => void
}) {
  return (
    <div className="paris-matrix" style={{ gridTemplateColumns: `34px repeat(${ATLAS.length}, minmax(0, 1fr))` }}>
      <span />
      {ATLAS.map((l) => (
        <button key={l.id} className="paris-matrix-col" aria-pressed={l.id === props.layer} onClick={() => props.onLayer(l.id)} title={l.label}>
          {l.label}
        </button>
      ))}
      {props.rows.map((r) => (
        <Row key={r.n} r={r} {...props} />
      ))}
    </div>
  )
}

function Row(props: { r: Arr; layer: Layer; chosen: number; colourOf: (id: Layer, n: number) => string; onLayer: (l: Layer) => void; onPick: (n: number) => void }) {
  const { r } = props
  const chosen = r.n === props.chosen
  return (
    <>
      <button className={`paris-matrix-row${chosen ? ' is-chosen' : ''}`} onClick={() => props.onPick(r.n)}>
        {nth(r.n)}
      </button>
      {ATLAS.map((l) => (
        <button
          key={l.id}
          className={`paris-matrix-cell${chosen ? ' is-chosen' : ''}${l.id === props.layer ? ' is-layer' : ''}`}
          style={{ background: props.colourOf(l.id, r.n), color: inkOn(props.colourOf(l.id, r.n)) }}
          onClick={() => {
            props.onPick(r.n)
            props.onLayer(l.id)
          }}
          title={`${nth(r.n)} · ${l.label} : ${compact(l.id, r.values[l.id])}`}
        >
          {compact(l.id, r.values[l.id])}
        </button>
      ))}
    </>
  )
}

/** The chosen arrondissement's rank on every layer, over the outlines of the 19 others. */
function Radar(props: { rows: Arr[]; chosen: Arr; ramp: (id: Layer) => string[] }) {
  const axes = ATLAS
  const size = 280
  const c = size / 2
  const R = c - 46
  const rank = (r: Arr, id: Layer) => {
    const below = props.rows.filter((x) => x.values[id] < r.values[id]).length
    return below / Math.max(1, props.rows.length - 1)
  }
  const pt = (i: number, k: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / axes.length
    return [c + Math.cos(a) * R * k, c + Math.sin(a) * R * k]
  }
  const shape = (r: Arr) => axes.map((l, i) => pt(i, 0.08 + 0.92 * rank(r, l.id)).join(',')).join(' ')
  return (
    <svg className="paris-radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={tr('Rang sur chaque couche', 'Rank on each layer')}>
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} className="paris-radar-grid" points={axes.map((_, i) => pt(i, k).join(',')).join(' ')} />
      ))}
      {props.rows
        .filter((r) => r.n !== props.chosen.n)
        .map((r) => (
          <polygon key={r.n} className="paris-radar-other" points={shape(r)} />
        ))}
      <polygon className="paris-radar-chosen" points={shape(props.chosen)} />
      {axes.map((l, i) => {
        const [x, y] = pt(i, 0.08 + 0.92 * rank(props.chosen, l.id))
        return <circle key={l.id} cx={x} cy={y} r={3.5} fill={props.ramp(l.id)[3]} />
      })}
      {axes.map((l, i) => {
        const [x, y] = pt(i, 1.2)
        return (
          <text key={l.id} x={x} y={y} className="paris-radar-label" textAnchor={Math.abs(x - c) < 8 ? 'middle' : x > c ? 'start' : 'end'}>
            {l.label}
          </text>
        )
      })}
    </svg>
  )
}

/** Each arrondissement placed by spending and footfall, as large as its boutiques of the type. */
function Bubbles(props: { rows: Arr[]; chosen: number; colourOf: (id: Layer, n: number) => string; onPick: (n: number) => void }) {
  const [w, h, pad] = [300, 170, 18]
  // both on a log scale: a few central arrondissements are many times the others
  const xs = props.rows.map((r) => Math.log(Math.max(r.values.demand, 1)))
  const ys = props.rows.map((r) => Math.log(Math.max(r.values.street_footfall, 0.01)))
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const maxB = Math.max(1, ...props.rows.map((r) => r.values.luxury))
  const X = (v: number) => pad + 14 + ((Math.log(Math.max(v, 1)) - x0) / (x1 - x0 || 1)) * (w - 2 * pad - 28)
  const Y = (v: number) => h - pad - 14 - ((Math.log(Math.max(v, 0.01)) - y0) / (y1 - y0 || 1)) * (h - 2 * pad - 28)
  const order = [...props.rows].sort((a, b) => b.values.luxury - a.values.luxury)
  return (
    <svg className="paris-bubbles" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={tr('Clientèle et centralité de la rue', 'Customers and street centrality')}>
      <line x1={pad} y1={h - pad} x2={w - pad / 2} y2={h - pad} className="paris-axis" />
      <line x1={pad} y1={pad / 2} x2={pad} y2={h - pad} className="paris-axis" />
      <text x={w - pad / 2} y={h - 6} textAnchor="end" className="paris-axis-label">
        {tr('clientèle →', 'customers →')}
      </text>
      <text x={pad + 4} y={pad / 2 + 6} className="paris-axis-label">
        {tr('↑ centralité', '↑ centrality')}
      </text>
      {order.map((r) => {
        const rad = 5 + 13 * Math.sqrt(r.values.luxury / maxB)
        return (
          <g key={r.n} className={r.n === props.chosen ? 'paris-bubble is-chosen' : 'paris-bubble'} onClick={() => props.onPick(r.n)}>
            <title>{`${nth(r.n)} · ${fmt(r.values.luxury)} ${tr('boutiques', 'boutiques')}`}</title>
            <circle cx={X(r.values.demand)} cy={Y(r.values.street_footfall)} r={rad} fill={props.colourOf('score', r.n)} />
            <text x={X(r.values.demand)} y={Y(r.values.street_footfall) + 0.5} fill={inkOn(props.colourOf('score', r.n))}>
              {r.n}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
