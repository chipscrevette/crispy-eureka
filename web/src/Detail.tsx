import { useEffect, useMemo } from 'react'
import type { Data } from './appData'
import type { Borders } from './borders'
import { kilo, num, short, zoneStats, type Placed } from './blocks'
import { openKey } from './dashboardData'
import type { LonLat } from './geo'
import type { CellProps } from './grid'
import HeroMap, { type Mark } from './HeroMap'
import { fmt, tr } from './i18n'
import { badgeHtml, type LineColours, type Network } from './network'
import { coloursOf, profileColour, rampFor, useTheme } from './palette'
import { scoreKey } from './scores'
import type { ProfileId } from './stores'

/** The four numbers of the walk, each of which opens its own view. */
export type Metric = 'stations' | 'free' | 'boutiques' | 'spending'

type Stats = ReturnType<typeof zoneStats>

/** What each view puts on its map, and how it reads its number from the walk. */
const METRICS: Record<
  Metric,
  { layer: string; dots: 'free' | 'boutiques' | 'none'; value: (z: Stats) => number; text: (n: number) => string; label: () => string; colour: (p: ProfileId) => string }
> = {
  stations: {
    layer: 'transit_entries_r2',
    dots: 'none',
    value: (z) => z.entries,
    text: kilo,
    label: () => tr('entrées en gare / jour', 'station entries / day'),
    colour: () => coloursOf(rampFor('transit'))[3],
  },
  free: {
    layer: 'score',
    dots: 'free',
    value: (z) => z.free,
    text: (n) => fmt(n),
    label: () => tr('places libres', 'free spots'),
    colour: (p) => coloursOf(rampFor(scoreKey(p)))[3],
  },
  boutiques: {
    layer: 'luxury',
    dots: 'boutiques',
    value: (z) => z.boutiques,
    text: (n) => fmt(n),
    label: () => tr('boutiques de ce type', 'boutiques of this type'),
    colour: profileColour,
  },
  spending: {
    layer: 'demand',
    dots: 'none',
    value: (z) => z.spendAvg ?? 0,
    text: (n) => `${fmt(n / 100, 1)}×`,
    label: () => tr('pouvoir d’achat vs Paris', 'spending vs Paris'),
    colour: () => coloursOf(rampFor('demand'))[3],
  },
}
const ORDER: Metric[] = ['stations', 'free', 'boutiques', 'spending']

const sourceOf = (data: Data, word: string) => data.meta.sources.find((s) => s.includes(word)) ?? ''

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

  // the stations as spikes as tall as their crowds, in the stations' violet, the five busiest named
  const theme = useTheme()
  const marks = useMemo<Mark[]>(() => {
    if (metric !== 'stations' || !z.near.length) return []
    const colour = coloursOf(rampFor('transit'))[3]
    const at = new Map(data.grid.features.map((f) => [f.properties.cell, f]))
    const top = z.near[0].p.entries
    return z.near.flatMap((s, i) => {
      const f = at.get(s.cell)
      const p = s.at ?? (f ? centre(f.geometry.coordinates[0]) : null)
      const badges = (s.p.lines ?? []).flatMap((l) => {
        const c = props.colours?.get(l)
        return c ? [{ label: l.startsWith('RER ') ? l.slice(4) : l.replace('bis', 'b'), colour: c.colour, ink: c.text, rer: l.startsWith('RER ') }] : []
      })
      return p ? [{ at: p, size: s.p.entries / top, colour, badges, label: i < 5 ? `${s.p.name} · ${kilo(s.p.entries)}` : undefined }] : []
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ramp follows the theme
  }, [metric, z, data, props.colours, theme])

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
          dots={m.dots}
          marks={marks}
          muted={metric === 'stations' ? coloursOf(rampFor('transit'))[0] : undefined}
          transit={metric === 'stations'}
          open={props.open}
          zone={here.zone}
          rings={rings}
          minutes={minutes}
          focus={metric === 'stations' ? here.zone : byBand[byBand.length - 1].zone}
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
          {metric === 'free' && <FreeChart data={data} profile={profile} zone={here.zone} onBlock={props.onBlock} />}
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

/** One sentence that puts the number against Paris. */
function headline(metric: Metric, data: Data, profile: ProfileId, z: Stats) {
  const blocks = data.grid.features.map((f) => f.properties)
  if (metric === 'stations')
    return z.near.length
      ? tr(`${z.near.length} gares de métro et RER dans la zone. Chiffre : entrées moyennes par jour.`, `${z.near.length} metro and RER stations in the walk. The figure: average entries a day.`)
      : tr('Aucune gare dans la zone.', 'No station in the walk.')
  if (metric === 'free') {
    const all = blocks.filter((p) => p[openKey(scoreKey(profile))] === 1).length
    return tr(`${fmt(z.free)} des ${fmt(all)} places libres de Paris pour ce type de marque sont dans la zone.`, `${fmt(z.free)} of the ${fmt(all)} free spots in Paris for this type of brand are in the walk.`)
  }
  if (metric === 'boutiques') {
    const all = data.stores.features.filter((f) => f.properties.profile === profile).length
    return z.boutiques
      ? tr(`${fmt(z.boutiques)} des ${fmt(all)} boutiques de ce type à Paris, de ${z.brands.size} marques.`, `${fmt(z.boutiques)} of the ${fmt(all)} boutiques of this type in Paris, from ${z.brands.size} brands.`)
      : tr('Aucune boutique de ce type dans la zone : la place est libre.', 'No boutique of this type in the walk: the field is open.')
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

/** The free spots of the walk, best first; a click opens the block. */
function FreeChart(props: { data: Data; profile: ProfileId; zone: Set<string>; onBlock: (cell: string) => void }) {
  const key = scoreKey(props.profile)
  const rows = props.data.grid.features
    .map((f) => f.properties)
    .filter((p) => props.zone.has(p.cell) && p[openKey(key)] === 1)
    .sort((a, b) => (num(b, key) ?? 0) - (num(a, key) ?? 0))
  if (!rows.length) return <p className="dash-empty">{tr('Aucune place libre dans la zone pour ce type de marque.', 'No free spot in the walk for this type of brand.')}</p>
  const colour = coloursOf(rampFor(key))[3]
  return (
    <ul className="detail-bars">
      {rows.map((p) => (
        <li key={p.cell}>
          <button onClick={() => props.onBlock(p.cell)}>
            <span className="detail-bar-name">{short(p)}</span>
            <span className="dash-brand-track">
              <span style={{ width: `${num(p, key) ?? 0}%`, background: colour }} />
            </span>
            <span className="muted">{Math.round(num(p, key) ?? 0)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The brands already in the walk, by number of boutiques. */
function BrandsChart(props: { z: Stats; profile: ProfileId }) {
  const rows = [...props.z.brands].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (!rows.length) return <p className="dash-empty">{tr('Aucune boutique de ce type : la place est libre.', 'No boutique of this type: the field is open.')}</p>
  const max = rows[0][1]
  const shown = rows.slice(0, 10)
  return (
    <>
      <ul className="detail-bars">
        {shown.map(([brand, n]) => (
          <li key={brand}>
            <span className="detail-bar-name">{brand}</span>
            <span className="dash-brand-track">
              <span style={{ width: `${(n / max) * 100}%`, background: profileColour(props.profile) }} />
            </span>
            <span className="muted">{n}</span>
          </li>
        ))}
      </ul>
      {rows.length > shown.length && (
        <p className="dash-note muted">
          {tr(`Et ${rows.length - shown.length} autres marques.`, `And ${rows.length - shown.length} more brands.`)}
        </p>
      )}
    </>
  )
}

/** Spending in the walk by group of people, against Paris = 100. */
function SpendingChart(props: { data: Data; zone: Set<string> }) {
  const blocks = props.data.grid.features.map((f) => f.properties).filter((p) => props.zone.has(p.cell))
  const avg = (k: string) => {
    const v = blocks.map((p) => num(p, k)).filter((x): x is number => x !== null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
  }
  const ramp = coloursOf(rampFor('demand'))
  const rows = props.data.groups.map((g, i) => ({ label: g.label, v: avg(`demand_${g.key}`), colour: ramp[2 + i] }))
  const max = Math.max(200, ...rows.map((r) => r.v))
  return (
    <>
      <ul className="detail-bars">
        {rows.map((r) => (
          <li key={r.label}>
            <span className="detail-bar-name">{r.label}</span>
            <span className="dash-brand-track">
              <span style={{ width: `${(r.v / max) * 100}%`, background: r.colour }} />
              <span className="detail-paris" style={{ left: `${(100 / max) * 100}%` }} aria-hidden="true" />
            </span>
            <span className="muted">{fmt(r.v)}</span>
          </li>
        ))}
      </ul>
      <p className="dash-note muted">{tr('Trait : moyenne de Paris (100).', 'Line: the Paris average (100).')}</p>
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
