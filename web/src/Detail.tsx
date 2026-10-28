import { useEffect, useMemo } from 'react'
import type { Data } from './appData'
import type { Borders } from './borders'
import { kilo, num, short, zoneStats, type Placed } from './blocks'
import { openKey } from './dashboardData'
import type { LonLat } from './geo'
import type { CellProps } from './grid'
import HeroMap, { type Mark } from './HeroMap'
import { fmt, sourceLabel, tr } from './i18n'
import { badgeHtml, type LineColours, type Network } from './network'
import { coloursOf, profileColour, rampFor, useTheme } from './palette'
import { scoreKey } from './scores'
import type { ProfileId } from './stores'

/** The four numbers of the walk, each of which opens its own view. */
export type Metric = 'stations' | 'free' | 'boutiques' | 'spending'

type Stats = ReturnType<typeof zoneStats>
type Spot = { p: CellProps; km: number }

/** What each view puts on its map, and how it reads its number from the walk. */
const METRICS: Record<
  Metric,
  { layer: string; value: (z: Stats) => number; text: (n: number) => string; label: () => string; colour: (p: ProfileId) => string }
> = {
  stations: {
    layer: 'transit_entries_r2',
    value: (z) => z.entries,
    text: kilo,
    label: () => tr('validations / jour, gares de la zone', 'validations / day, stations in the walk'),
    colour: () => coloursOf(rampFor('transit'))[3],
  },
  free: {
    layer: 'score',
    value: (z) => z.free,
    text: (n) => fmt(n),
    label: () => tr('sites avec local vide (2023)', 'sites with an empty shop (2023)'),
    colour: (p) => coloursOf(rampFor(scoreKey(p)))[3],
  },
  boutiques: {
    layer: 'luxury',
    value: (z) => z.boutiques,
    text: (n) => fmt(n),
    label: () => tr('boutiques de ce type', 'boutiques of this type'),
    colour: profileColour,
  },
  spending: {
    layer: 'demand',
    value: (z) => z.spendAvg ?? 0,
    text: (n) => `${fmt(n / 100, 1)}×`,
    label: () => tr('indice de clientèle', 'customer index'),
    colour: () => coloursOf(rampFor('demand'))[3],
  },
}
const ORDER: Metric[] = ['stations', 'free', 'boutiques', 'spending']

const sourceOf = (data: Data, word: string) => sourceLabel(data.meta.sources.find((s) => s.includes(word)) ?? '')

/**
 * One number of the walk, opened up: a map that shows only that subject around the chosen block,
 * the chart that explains it, how it grows with the minutes on foot, and where it comes from.
 */
export default function Detail(props: {
  metric: Metric
  onMetric: (m: Metric) => void
  onClose: () => void
  data: Data
  profile: ProfileId
  block: CellProps
  rings: Map<string, number>
  bands: number[]
  minutes: number
  onMinutes: (m: number) => void
  placed: Map<string, string>
  stations: Placed[]
  colours: LineColours | null
  open: CellProps[]
  borders: Borders | null
  network: Network | null
  onBlock: (cell: string | null) => void
}) {
  const { metric, data, profile, block, rings, bands, minutes, placed, stations, onClose } = props
  const m = METRICS[metric]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // the walk band by band, so each number can show how it grows with the minutes
  const byBand = useMemo(
    () =>
      bands.map((b) => {
        const zone = new Set([...rings].filter(([, t]) => t <= b).map(([c]) => c))
        return { minutes: b, zone, stats: zoneStats(data, profile, zone, placed, stations) }
      }),
    [bands, rings, data, profile, placed, stations],
  )
  const here = byBand.find((b) => b.minutes === minutes) ?? byBand[byBand.length - 1]
  const z = here.stats

  const theme = useTheme()
  const centres = useMemo(() => new Map(data.grid.features.map((f) => [f.properties.cell, centre(f.geometry.coordinates[0])])), [data])
  const key = scoreKey(profile)

  // the free spots of Paris for this type; when none is in the walk, the three nearest as the crow flies
  const free = useMemo(() => {
    const from = centres.get(block.cell)!
    const all = data.grid.features
      .map((f) => f.properties)
      .filter((p) => p[openKey(key)] === 1)
      .map((p) => ({ p, km: crow(from, centres.get(p.cell)!) }))
    const inside = all.filter((x) => here.zone.has(x.p.cell)).sort((a, b) => (num(b.p, key) ?? 0) - (num(a.p, key) ?? 0))
    return { all, inside, nearest: inside.length ? [] : [...all].sort((a, b) => a.km - b.km).slice(0, 3) }
  }, [data, key, centres, block, here])

  // each view draws its subject its own way: stations as their lines' badges, free spots as pins holding their score,
  // boutiques as bubbles holding their count, spending as each block's multiple of Paris
  const marks = useMemo<Mark[]>(() => {
    if (metric === 'stations') {
      if (!z.near.length) return []
      const colour = coloursOf(rampFor('transit'))[3]
      const top = z.near[0].p.entries
      return z.near.flatMap((s, i) => {
        const p = s.at ?? centres.get(s.cell)
        const badges = (s.p.lines ?? []).flatMap((l) => {
          const c = props.colours?.get(l)
          return c ? [{ label: l.startsWith('RER ') ? l.slice(4) : l.replace('bis', 'b'), colour: c.colour, ink: c.text, rer: l.startsWith('RER ') }] : []
        })
        return p ? [{ at: p, size: s.p.entries / top, colour, badges, label: i < 5 ? `${s.p.name} · ${kilo(s.p.entries)}` : undefined }] : []
      })
    }
    if (metric === 'free') {
      const ramp = coloursOf(rampFor(key))
      const named = new Set([...free.inside.slice(0, 3), ...free.nearest].map((x) => x.p.cell))
      return free.all.map(({ p, km }) => {
        const score = Math.round(num(p, key) ?? 0)
        const inside = here.zone.has(p.cell)
        return {
          at: centres.get(p.cell)!,
          size: score / 100,
          colour: ramp[score >= 90 ? 4 : score >= 75 ? 3 : 2],
          pin: String(score),
          faded: !inside && !named.has(p.cell),
          label: named.has(p.cell) ? (inside ? short(p) : `${short(p)} · ${fmt(km, 1)} km`) : undefined,
        }
      })
    }
    if (metric === 'boutiques') {
      // the boutiques of the type, gathered by block
      const byCell = new Map<string, string[]>()
      for (const f of data.stores.features) {
        const c = placed.get(f.properties.id)
        if (f.properties.profile !== profile || !c) continue
        byCell.set(c, [...(byCell.get(c) ?? []), f.properties.brand])
      }
      const max = Math.max(1, ...[...byCell.values()].map((b) => b.length))
      const top = new Set([...byCell].filter(([c]) => here.zone.has(c)).sort((a, b) => b[1].length - a[1].length).slice(0, 3).map(([c]) => c))
      return [...byCell].map(([c, brands]) => {
        const names = [...new Set(brands)]
        return {
          at: centres.get(c)!,
          size: brands.length / max,
          colour: profileColour(profile),
          bubble: String(brands.length),
          faded: !here.zone.has(c),
          label: top.has(c) ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '') : undefined,
        }
      })
    }
    // spending: each block of the walk with its multiple of the Paris average
    const ink = coloursOf(rampFor('demand'))
    return data.grid.features.flatMap((f) => {
      const v = num(f.properties, 'demand')
      if (!here.zone.has(f.properties.cell) || f.properties.cell === block.cell || v === null) return []
      return [{ at: centres.get(f.properties.cell)!, size: 0, colour: ink[ink.length - 1], tag: `${fmt(v / 100, 1)}×` }]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ramps follow the theme
  }, [metric, z, data, props.colours, theme, free, here, centres, profile, placed, key, block])

  // what the map frames: the walk at the chosen minutes, or with the nearest free spots when the walk has none
  const focus = useMemo(() => {
    if (metric === 'stations' || metric === 'spending') return here.zone
    const wide = byBand[byBand.length - 1].zone
    return metric === 'free' && free.nearest.length ? new Set([...wide, ...free.nearest.map((x) => x.p.cell)]) : wide
  }, [metric, here, byBand, free])

  return (
    <main className="dash-page detail">
      <header className="detail-head">
        <button className="detail-back" onClick={onClose}>
          {tr('← Retour', '← Back')}
        </button>
        <p className="dash-kicker">
          {tr(`Autour du ${short(block)}, à ${minutes} min à pied`, `Around ${short(block)}, within ${minutes} min on foot`)}
        </p>
        <nav className="detail-tabs" aria-label={tr('Les chiffres de la zone', 'The numbers of the walk')}>
          {ORDER.map((id) => (
            <button key={id} aria-current={id === metric ? 'true' : undefined} onClick={() => props.onMetric(id)}>
              <span className="detail-tab-value">{METRICS[id].text(METRICS[id].value(z))}</span>
              <span className="detail-tab-label">{METRICS[id].label()}</span>
            </button>
          ))}
        </nav>
      </header>

      <section className="dash-hero detail-map" aria-label={tr('Carte', 'Map')}>
        <HeroMap
          data={data}
          profile={profile}
          layer={m.layer}
          cell={block.cell}
          dots="none"
          marks={marks}
          muted={muted(metric, profile)}
          transit={metric === 'stations'}
          zoneOnly={metric === 'spending'}
          open={props.open}
          zone={here.zone}
          rings={rings}
          minutes={minutes}
          focus={focus}
          pin={null}
          brand={null}
          placed={placed}
          borders={props.borders}
          network={props.network}
          onBlock={props.onBlock}
        />
      </section>

      <section className="dash-card detail-side">
        <div className="detail-headline">
          <Picto metric={metric} colour={m.colour(profile)} />
          <span className="dash-figure-value">{m.text(m.value(z))}</span>
          <span className="dash-figure-label">{m.label()}</span>
          <p className="muted">{headline(metric, data, profile, z)}</p>
        </div>

        <div className="detail-chart">
          {metric === 'stations' && <StationsChart z={z} colours={props.colours} />}
          {metric === 'free' && <FreeChart profile={profile} inside={free.inside} nearest={free.nearest} onBlock={props.onBlock} />}
          {metric === 'boutiques' && <BrandsChart z={z} profile={profile} />}
          {metric === 'spending' && <SpendingChart data={data} zone={here.zone} />}
        </div>

        <div className="detail-bands">
          <p className="dash-kicker">{tr('Selon la durée à pied', 'By minutes on foot')}</p>
          <div className="detail-band-bars">
            {byBand.map((b) => {
              const v = m.value(b.stats)
              const max = Math.max(1, ...byBand.map((x) => m.value(x.stats)))
              return (
                <button key={b.minutes} aria-pressed={b.minutes === minutes} onClick={() => props.onMinutes(b.minutes)}>
                  <span className="detail-band-value">{m.text(v)}</span>
                  <span className="detail-band-bar" style={{ height: `${Math.max(3, (v / max) * 100)}%`, background: m.colour(profile) }} />
                  <span className="detail-band-label">{b.minutes} min</span>
                </button>
              )
            })}
          </div>
        </div>

        <p className="dash-note muted">{source(metric, data)}</p>
      </section>
    </main>
  )
}

const centre = (ring: number[][]): LonLat => {
  const pts = ring.slice(0, -1)
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
}

/** Kilometres between two points as the crow flies. */
const crow = (a: LonLat, b: LonLat) => {
  const k = Math.PI / 180
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * k)
  return Math.hypot(dx, b[1] - a[1]) * k * 6371
}

/** The pale tone of the walk under each view's marks; spending shows its own colours instead. */
function muted(metric: Metric, profile: ProfileId) {
  if (metric === 'stations') return coloursOf(rampFor('transit'))[0]
  if (metric === 'free') return coloursOf(rampFor(scoreKey(profile)))[0]
  if (metric === 'boutiques') return `${profileColour(profile)}26`
  return undefined
}

/** One sentence that puts the number against Paris. */
function headline(metric: Metric, data: Data, profile: ProfileId, z: Stats) {
  const blocks = data.grid.features.map((f) => f.properties)
  if (metric === 'stations')
    return z.near.length
      ? tr(`${z.near.length} gares de métro et RER dans la zone. Chiffre : validations moyennes par jour (Île-de-France Mobilités).`, `${z.near.length} metro and RER stations in the walk. The figure: average ticket validations a day (Île-de-France Mobilités).`)
      : tr('Aucune gare dans la zone.', 'No station in the walk.')
  if (metric === 'free') {
    const all = blocks.filter((p) => p[openKey(scoreKey(profile))] === 1).length
    return tr(`${fmt(z.free)} des ${fmt(all)} sites avec local vide (2023) de Paris pour ce type de marque sont dans la zone.`, `${fmt(z.free)} of the ${fmt(all)} sites with an empty shop (2023) in Paris for this type of brand are in the walk.`)
  }
  if (metric === 'boutiques') {
    const all = data.stores.features.filter((f) => f.properties.profile === profile).length
    return z.boutiques
      ? tr(`${fmt(z.boutiques)} des ${fmt(all)} boutiques de ce type à Paris, de ${z.brands.size} marques.`, `${fmt(z.boutiques)} of the ${fmt(all)} boutiques of this type in Paris, from ${z.brands.size} brands.`)
      : tr('Aucune boutique de ce type dans la zone.', 'No boutique of this type in the walk.')
  }
  return z.spendAvg === null
    ? tr('Pas de donnée de pouvoir d’achat ici.', 'No spending data here.')
    : tr(
        `Les blocs de la zone dépensent en moyenne ${fmt(z.spendAvg / 100, 1)} fois la moyenne de Paris. Habitants, actifs et visiteurs y comptent à parts égales.`,
        `The walk's blocks spend on average ${fmt(z.spendAvg / 100, 1)} times the Paris average. Residents, workers and visitors count equally.`,
      )
}

function source(metric: Metric, data: Data) {
  const s =
    metric === 'stations'
      ? sourceOf(data, 'Mobilités')
      : metric === 'spending'
        ? [sourceOf(data, 'Filosofi'), sourceOf(data, 'Sirene'), sourceOf(data, 'hotels')].filter(Boolean).join(' · ')
        : metric === 'boutiques'
          ? sourceOf(data, 'Overture Maps Places')
          : tr('Notre modèle, testé à l’aveugle (onglet Méthode)', 'Our model, blind-tested (Method tab)')
  return `${tr('Source', 'Source')} : ${s}`
}

/** The stations of the walk, busiest first, with their lines. */
function StationsChart(props: { z: Stats; colours: LineColours | null }) {
  const rows = props.z.near.slice(0, 8)
  if (!rows.length) return <p className="dash-empty">{tr('Aucune gare dans la zone.', 'No station in the walk.')}</p>
  const max = rows[0].p.entries
  const colour = coloursOf(rampFor('transit'))[3]
  // every line that stops in the walk, metro first then RER, in the order of their names
  const lines = [...new Set(props.z.near.flatMap((s) => s.p.lines ?? []))].sort((a, b) => Number(a.startsWith('RER')) - Number(b.startsWith('RER')) || a.localeCompare(b, undefined, { numeric: true }))
  return (
    <>
      <ul className="detail-bars">
        {rows.map((s) => (
          <li key={s.p.name}>
            <span className="detail-bar-name">
              <span className="tip-badges" dangerouslySetInnerHTML={{ __html: props.colours ? (s.p.lines ?? []).map((l) => badgeHtml(l, props.colours!)).join('') : '' }} />
              {s.p.name}
            </span>
            <span className="dash-brand-track">
              <span style={{ width: `${(s.p.entries / max) * 100}%`, background: colour }} />
            </span>
            <span className="muted">{kilo(s.p.entries)}</span>
          </li>
        ))}
      </ul>
      {props.colours && lines.length > 0 && (
        <div className="detail-lines">
          <p className="dash-kicker">{tr(`${lines.length} lignes desservent la zone`, `${lines.length} lines serve the walk`)}</p>
          <span className="tip-badges" dangerouslySetInnerHTML={{ __html: lines.map((l) => badgeHtml(l, props.colours!)).join('') }} />
        </div>
      )}
    </>
  )
}

/** The free spots of the walk, best first; when the walk has none, the nearest ones. A click opens the block. */
function FreeChart(props: { profile: ProfileId; inside: Spot[]; nearest: Spot[]; onBlock: (cell: string) => void }) {
  const key = scoreKey(props.profile)
  const rows = props.inside.length ? props.inside.slice(0, 8) : props.nearest
  if (!rows.length) return <p className="dash-empty">{tr('Aucun site avec local vide (2023) à Paris pour ce type de marque.', 'No site with an empty shop (2023) in Paris for this type of brand.')}</p>
  const ramp = coloursOf(rampFor(key))
  return (
    <>
      {!props.inside.length && (
        <p className="dash-kicker">{tr('Aucune dans la zone. Les plus proches, à vol d’oiseau :', 'None in the walk. The nearest, as the crow flies:')}</p>
      )}
      <ul className="detail-spots">
        {rows.map(({ p, km }) => {
          const score = Math.round(num(p, key) ?? 0)
          return (
            <li key={p.cell}>
              <button onClick={() => props.onBlock(p.cell)}>
                <span className="detail-spot-pin" style={{ background: ramp[score >= 90 ? 4 : score >= 75 ? 3 : 2] }}>
                  <span>{score}</span>
                </span>
                <span className="detail-bar-name">{short(p)}</span>
                <span className="muted">{props.inside.length ? tr('dans la zone', 'in the walk') : `${fmt(km, 1)} km`}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="dash-note muted">{tr('Dans l’épingle : la note du bloc sur 100.', 'In the pin: the block’s score out of 100.')}</p>
    </>
  )
}

/** The brands already in the walk: one dot per boutique, the most present first. */
function BrandsChart(props: { z: Stats; profile: ProfileId }) {
  const rows = [...props.z.brands].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (!rows.length) return <p className="dash-empty">{tr('Aucune boutique de ce type dans la zone.', 'No boutique of this type in the walk.')}</p>
  const shown = rows.slice(0, 10)
  const colour = profileColour(props.profile)
  return (
    <>
      <ul className="detail-units">
        {shown.map(([brand, n]) => (
          <li key={brand}>
            <span className="detail-bar-name">{brand}</span>
            <span className="detail-unit-dots" aria-label={String(n)}>
              {Array.from({ length: n }, (_, i) => (
                <span key={i} style={{ background: colour }} />
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="dash-note muted">
        {rows.length > shown.length
          ? tr(`Un point = une boutique. Et ${rows.length - shown.length} autres marques.`, `One dot = one boutique. And ${rows.length - shown.length} more brands.`)
          : tr('Un point = une boutique.', 'One dot = one boutique.')}
      </p>
    </>
  )
}

/** Spending in the walk by group of people, each with its picture and its multiple of the Paris average. */
function SpendingChart(props: { data: Data; zone: Set<string> }) {
  const blocks = props.data.grid.features.map((f) => f.properties).filter((p) => props.zone.has(p.cell))
  const avg = (k: string) => {
    const v = blocks.map((p) => num(p, k)).filter((x): x is number => x !== null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
  }
  const ramp = coloursOf(rampFor('demand'))
  const icons: Record<string, string> = {
    residents: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
    workers: 'M4 8h16v11H4V8Zm5 0V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16',
    visitors: 'M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm3 0V5h4v2M9 11v6M15 11v6',
  }
  return (
    <>
      <ul className="detail-groups">
        {props.data.groups.map((g, i) => {
          const v = avg(`demand_${g.key}`)
          const colour = ramp[2 + i] ?? ramp[ramp.length - 1]
          return (
            <li key={g.key} style={{ background: `${colour}14` }}>
              <span className="detail-picto" style={{ color: colour, background: `${colour}1f` }} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={icons[g.key] ?? icons.residents} />
                </svg>
              </span>
              <span className="detail-group-value" style={{ color: colour }}>{fmt(v / 100, 1)}×</span>
              <span className="detail-group-label">{g.label}</span>
            </li>
          )
        })}
      </ul>
      <p className="dash-note muted">{tr('1× = la moyenne de Paris. Sur la carte, chaque bloc de la zone.', '1× = the Paris average. On the map, each block of the walk.')}</p>
    </>
  )
}

/** Each view's own pictogram, in its colour: a train, a pin, a shopping bag, a wallet. Our own drawings. */
function Picto(props: { metric: Metric; colour: string }) {
  const paths: Record<Metric, string> = {
    stations: 'M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-3 8h16M8 15h.01M16 15h.01M8 18l-2 3M16 18l2 3',
    free: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    boutiques: 'M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2',
    spending: 'M4 7a2 2 0 0 1 2-2h12v4M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2Zm12 7h.01',
  }
  return (
    <span className="detail-picto" style={{ color: props.colour, background: `${props.colour}1f` }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={paths[props.metric]} />
      </svg>
    </span>
  )
}
