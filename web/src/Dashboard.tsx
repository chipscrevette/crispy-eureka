import { useEffect, useMemo, useRef, useState } from 'react'
import { loadData, type Data } from './appData'
import { ATLAS, atlasKey, cssVar as css, fills, sizeCanvas, useOutline } from './atlasLayers'
import { OPEN_RULE, openKey } from './dashboardData'
import { cellAt, cellIndex } from './geo'
import { formatValue, type CellProps } from './grid'
import { fmt, lang, switchLang, tr } from './i18n'
import { coloursOf, isDark, profileColour, rampFor } from './palette'
import { SCORE_BREAKS, placeOf, rankText, scoreKey } from './scores'
import { PROFILES, countByProfile, type ProfileId } from './stores'
import { connect, sameShared, type Shared } from './sync'

/** "Paris 8e Arrondissement" → "8e". */
const short = (p: CellProps) => placeOf(p).replace(/^Paris /, '').replace(/ Arrondissement$/, '')
const num = (p: CellProps, k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null)
const pc = () => (lang() === 'fr' ? ' %' : '%')

const SHORT: Record<ProfileId, string> = {
  'jewellery-watches': tr('Joaillerie', 'Jewellery'),
  'fashion-house': tr('Mode', 'Fashion'),
  beauty: tr('Beauté', 'Beauty'),
}

/** The layers that explain the potential: a block's reasons. */
const REASONS = ATLAS.filter((l) => l.id !== 'score')

type ArrRow = { scores: number[]; open: number; boutiques: number; best: CellProps | null }

function switchTheme() {
  try {
    localStorage.setItem('adresse-theme', isDark() ? 'light' : 'dark')
  } catch {
    return
  }
  window.location.reload()
}

/** Share of blocks with a lower value, 0 to 100: where a value stands in Paris. */
function percentile(sorted: number[] | undefined, v: number) {
  if (!sorted?.length) return 0
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < v) lo = mid + 1
    else hi = mid
  }
  return (100 * lo) / sorted.length
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shared, setShared] = useState<Shared>({ profile: 'jewellery-watches', layer: 'score', cell: null, fresh: true })
  const [linked, setLinked] = useState(false)
  const applied = useRef<Shared | null>(null)
  const sharedRef = useRef(shared)
  sharedRef.current = shared
  const link = useRef<ReturnType<typeof connect> | null>(null)

  useEffect(() => {
    loadData().then(setData, (e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    const l = connect('dashboard', {
      onState: (s) => {
        applied.current = s
        setLinked(true)
        setShared(s)
      },
      onHello: () => {
        setLinked(true)
        l.send(sharedRef.current)
      },
      onBye: () => setLinked(false),
    })
    link.current = l
    return l.close
  }, [])
  useEffect(() => {
    // what came from the map is not sent back to it
    if (!sameShared(shared, applied.current)) link.current?.send(shared)
  }, [shared])

  const set = (patch: Partial<Shared>) => setShared((s) => ({ ...s, ...patch }))
  const { profile, layer, cell, fresh } = shared
  const key = scoreKey(profile)
  const cells = useMemo(() => (data ? cellIndex(data.grid) : null), [data])
  const block = (cell && cells?.get(cell)?.properties) || null

  // every layer's values in order, to place a block in Paris
  const sorted = useMemo(() => {
    const out = new Map<string, number[]>()
    for (const l of ATLAS) {
      const k = atlasKey(l.id, profile)
      out.set(
        k,
        (data?.grid.features ?? [])
          .map((f) => num(f.properties, k))
          .filter((v): v is number => v !== null)
          .sort((a, b) => a - b),
      )
    }
    return out
  }, [data, profile])

  const open = useMemo(
    () =>
      (data?.grid.features ?? [])
        .map((f) => f.properties)
        .filter((p) => p[openKey(key)] === 1)
        .sort((a, b) => (num(b, key) ?? 0) - (num(a, key) ?? 0)),
    [data, key],
  )

  // the arrondissements: average potential, free spots, boutiques of the type, best block
  const arrondissements = useMemo(() => {
    const rows = new Map<string, ArrRow>()
    if (!data || !cells) return rows
    const row = (name: string) => {
      if (!rows.has(name)) rows.set(name, { scores: [], open: 0, boutiques: 0, best: null })
      return rows.get(name)!
    }
    for (const f of data.grid.features) {
      const p = f.properties
      const s = num(p, key)
      if (!p.arrondissement || s === null) continue
      const r = row(short(p))
      r.scores.push(s)
      if (p[openKey(key)] === 1) r.open += 1
      if (!r.best || s > (num(r.best, key) ?? 0)) r.best = p
    }
    for (const s of data.stores.features) {
      if (s.properties.profile !== profile) continue
      const c = cellAt(data.grid, s.geometry.coordinates as [number, number])
      const p = c ? cells.get(c)?.properties : undefined
      if (p?.arrondissement) row(short(p)).boutiques += 1
    }
    return rows
  }, [data, cells, key, profile])

  // per tenth of potential: the share of blocks that already have a boutique of the type around
  const tenths = useMemo(() => {
    const bins = Array.from({ length: 10 }, () => ({ blocks: 0, taken: 0 }))
    const lux = atlasKey('luxury', profile)
    for (const f of data?.grid.features ?? []) {
      const s = num(f.properties, key)
      if (s === null) continue
      const b = bins[Math.min(9, Math.floor(s / 10))]
      b.blocks += 1
      if ((num(f.properties, lux) ?? 0) > 0) b.taken += 1
    }
    return bins
  }, [data, key, profile])

  if (error) return <p className="dash-error">{tr('Les données n’ont pas pu être chargées : ', 'The data could not load: ') + error}</p>

  const counts = data ? countByProfile(data.stores) : null
  const layerInfo = ATLAS.find((l) => l.id === layer) ?? ATLAS[0]

  return (
    <div className="dash">
      <header className="dash-head">
        <p className="wordmark">
          <span className="wordmark-dot" aria-hidden="true" />
          Adresse
        </p>
        <div className="profiles dash-profiles" role="radiogroup" aria-label={tr('Type de marque', 'Type of brand')}>
          {PROFILES.map((p) => (
            <button key={p.id} role="radio" aria-checked={profile === p.id} onClick={() => set({ profile: p.id })}>
              {SHORT[p.id]}
              {counts && <span className="profile-count">{counts[p.id]}</span>}
            </button>
          ))}
        </div>
        <div className="dash-seg" role="group" aria-label={tr('Ce que montre la carte', 'What the map shows')}>
          <button aria-pressed={fresh} onClick={() => set({ fresh: true })}>
            {tr('Places libres', 'Free spots')}
          </button>
          <button aria-pressed={!fresh} onClick={() => set({ fresh: false })}>
            {tr('Déjà présents', 'Already there')}
          </button>
        </div>
        <p className="dash-link" role="status">
          <span className={linked ? 'dash-live on' : 'dash-live'} aria-hidden="true" />
          {linked ? (
            tr('Lié à la carte', 'Linked to the map')
          ) : (
            <a href="./" target="_blank" rel="noreferrer">
              {tr('Ouvrir la carte', 'Open the map')}
            </a>
          )}
        </p>
        <button
          className="lang-toggle"
          onClick={switchLang}
          lang={lang() === 'en' ? 'fr' : 'en'}
          aria-label={tr('Read this site in English', 'Lire le site en français')}
          title={tr('English', 'Français')}
        >
          {lang() === 'en' ? 'FR' : 'EN'}
        </button>
        <button
          className="theme-toggle"
          onClick={switchTheme}
          aria-label={isDark() ? tr('Passer au thème clair', 'Switch to the light theme') : tr('Passer au thème sombre', 'Switch to the dark theme')}
          title={isDark() ? tr('Thème clair', 'Light theme') : tr('Thème sombre', 'Dark theme')}
        >
          <span aria-hidden="true">{isDark() ? '☀' : '☾'}</span>
        </button>
      </header>

      {!data ? (
        <p className="dash-loading">{tr('Chargement des données…', 'Loading the data…')}</p>
      ) : (
        <main className="dash-board">
          <section className="dash-hero" aria-label={tr('Carte', 'Map')}>
            <div className="dash-hero-head">
              <p className="dash-kicker">{tr('Sur la carte', 'On the map')}</p>
              <h1 className="dash-title">{layerInfo.label}</h1>
              <p className="muted">{layerInfo.note}</p>
              <div className="dash-layer-pick" role="radiogroup" aria-label={tr('Couche de la carte', 'Map layer')}>
                {ATLAS.map((l) => (
                  <button
                    key={l.id}
                    role="radio"
                    aria-checked={layer === l.id}
                    aria-label={l.label}
                    title={l.label}
                    onClick={() => set({ layer: l.id })}
                    style={{ background: coloursOf(rampFor(atlasKey(l.id, profile)))[3] }}
                  />
                ))}
              </div>
              <Figure value={fmt(open.length)} label={tr('places libres', 'free spots')} accent />
              <Figure value={fmt(counts![profile])} label={tr('boutiques aujourd’hui', 'boutiques today')} />
            </div>
            <HeroMap data={data} profile={profile} layer={layer} cell={cell} fresh={fresh} open={open} onBlock={(c) => set({ cell: c })} />
          </section>

          <section className="dash-portrait" aria-live="polite">
            <Portrait
              block={block}
              open={open}
              profile={profile}
              layer={layer}
              sorted={sorted}
              onLayer={(id) => set({ layer: id })}
              onClear={() => set({ cell: null })}
            />
          </section>

          <section className="dash-strip">
            <div className="dash-card">
              <p className="dash-kicker">{tr('Les places libres, de la meilleure à la moins bonne', 'The free spots, best first')}</p>
              <Spots open={open} cell={cell} profile={profile} onBlock={(c) => set({ cell: c })} />
            </div>
            <div className="dash-card">
              <p className="dash-kicker">
                {fresh ? tr('Places libres par arrondissement', 'Free spots by arrondissement') : tr('Boutiques par arrondissement', 'Boutiques by arrondissement')}
              </p>
              <TileMap rows={arrondissements} profile={profile} fresh={fresh} chosen={block ? short(block) : null} onBlock={(c) => set({ cell: c })} />
            </div>
            <div className="dash-card">
              <p className="dash-kicker">{tr('Le luxe est déjà là où le potentiel est haut', 'Luxury is already where potential is high')}</p>
              <Tenths bins={tenths} mark={block ? num(block, key) : null} colour={coloursOf(rampFor(key))[3]} />
            </div>
          </section>
        </main>
      )}
    </div>
  )
}

function Figure(props: { value: string; label: string; accent?: boolean }) {
  return (
    <p className={props.accent ? 'dash-figure accent' : 'dash-figure'}>
      <span className="dash-figure-value">{props.value}</span>
      <span className="dash-figure-label">{props.label}</span>
    </p>
  )
}

/** Paris block by block, coloured like the big map; the free spots numbered, or the boutiques already there. */
function HeroMap(props: {
  data: Data
  profile: ProfileId
  layer: string
  cell: string | null
  fresh: boolean
  open: CellProps[]
  onBlock: (cell: string) => void
}) {
  const { data, profile, layer, cell, fresh, open, onBlock } = props
  const ref = useRef<HTMLCanvasElement>(null)
  const outline = useOutline(data.grid)
  const key = atlasKey(layer, profile)
  const colours = useMemo(() => fills(data.grid, key, layer === 'score'), [data, key, layer])
  const geo = useRef({ s: 1, ox: 0, oy: 0 })
  const [hover, setHover] = useState<{ x: number; y: number; p: CellProps } | null>(null)
  const byCell = useMemo(() => cellIndex(data.grid), [data])
  const rank = useMemo(() => new Map(open.map((p, i) => [p.cell, i + 1])), [open])

  useEffect(() => {
    const draw = () => {
      const { ctx, width, height } = sizeCanvas(ref.current!)
      const s = Math.min(width, height / outline.aspect) * 0.96
      const ox = (width - s) / 2
      const oy = (height - s * outline.aspect) / 2
      geo.current = { s, ox, oy }
      const quiet = css('--quiet')
      const ink = css('--ink')
      ctx.clearRect(0, 0, width, height)
      for (const b of outline.blocks) {
        ctx.beginPath()
        b.ring.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * s, oy + y * s) : ctx.moveTo(ox + x * s, oy + y * s)))
        ctx.fillStyle = b.cell === cell ? ink : (colours.get(b.cell) ?? quiet)
        ctx.fill()
      }
      if (!fresh) {
        ctx.fillStyle = profileColour(profile)
        for (const f of data.stores.features) {
          if (f.properties.profile !== profile) continue
          const [x, y] = outline.project(f.geometry.coordinates)
          ctx.beginPath()
          ctx.arc(ox + x * s, oy + y * s, 3, 0, 2 * Math.PI)
          ctx.fill()
        }
        return
      }
      // the free spots, numbered as in the list, like the pins of the map page
      ctx.font = `500 11px ${css('--display')}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const [accent, surface] = [css('--accent'), css('--surface')]
      for (const b of outline.blocks) {
        const n = rank.get(b.cell)
        if (!n) continue
        const [x, y] = [ox + b.at[0] * s, oy + b.at[1] * s]
        ctx.beginPath()
        ctx.arc(x, y, 10, 0, 2 * Math.PI)
        ctx.fillStyle = b.cell === cell ? accent : ink
        ctx.fill()
        ctx.fillStyle = surface
        ctx.fillText(String(n), x, y + 0.5)
      }
    }
    draw()
    const obs = new ResizeObserver(draw)
    obs.observe(ref.current!)
    return () => obs.disconnect()
  }, [outline, colours, cell, fresh, profile, data, rank])

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const { s, ox, oy } = geo.current
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    let best: { d: number; cell: string; x: number; y: number } | null = null
    for (const b of outline.blocks) {
      const x = ox + b.at[0] * s
      const y = oy + b.at[1] * s
      const d = Math.hypot(x - mx, y - my)
      if (!best || d < best.d) best = { d, cell: b.cell, x, y }
    }
    // a block is about a fortieth of the city wide
    return best && best.d < s / 60 ? best : null
  }

  const value = hover ? num(hover.p, key) : null
  return (
    <div className="dash-map">
      <canvas
        ref={ref}
        role="img"
        aria-label={tr('Carte de Paris par bloc', 'Map of Paris by block')}
        onMouseMove={(e) => {
          const hit = pick(e)
          const p = hit && byCell.get(hit.cell)?.properties
          setHover(hit && p ? { x: hit.x, y: hit.y, p } : null)
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const hit = pick(e)
          if (hit) onBlock(hit.cell)
        }}
        style={{ cursor: hover ? 'pointer' : 'default' }}
      />
      {hover && (
        <span className="dash-tip" style={{ left: hover.x, top: hover.y }}>
          {short(hover.p)}
          <span className="muted"> · {layer === 'score' ? (value === null ? '–' : `${Math.round(value)} / 100`) : valueText(key, value)}</span>
        </span>
      )}
    </div>
  )
}

/**
 * The chosen block as a flower: one petal per layer, as long as the share of Paris it beats,
 * in the layer's own colour. With no block chosen, the typical free spot: the median of each layer.
 */
function Portrait(props: {
  block: CellProps | null
  open: CellProps[]
  profile: ProfileId
  layer: string
  sorted: Map<string, number[]>
  onLayer: (id: string) => void
  onClear: () => void
}) {
  const { block, open, profile, layer, sorted } = props
  const key = scoreKey(profile)
  const at = (k: string, p: CellProps) => {
    const v = num(p, k)
    return v === null ? 0 : percentile(sorted.get(k), v)
  }
  const petals = REASONS.map((l) => {
    const k = atlasKey(l.id, profile)
    let share = 0
    if (block) share = at(k, block)
    else if (open.length) {
      const v = open.map((p) => at(k, p)).sort((a, b) => a - b)
      share = v[Math.floor(v.length / 2)]
    }
    return {
      id: l.id,
      label: l.label,
      colour: coloursOf(rampFor(k))[3],
      share,
      text: block ? valueText(k, num(block, k)) : `${tr('top', 'top')} ${Math.max(1, Math.round(100 - share))}${pc()}`,
    }
  })
  const score = block ? num(block, key) : null

  const size = 300
  const c = size / 2
  const inner = 48
  const outer = 146
  const step = (2 * Math.PI) / petals.length
  const petalPath = (i: number, share: number) => {
    const r = inner + ((outer - inner) * Math.max(share, 3)) / 100
    const a0 = -Math.PI / 2 + i * step - step * 0.4
    const a1 = -Math.PI / 2 + i * step + step * 0.4
    const p = (a: number, rr: number) => `${(c + rr * Math.cos(a)).toFixed(1)} ${(c + rr * Math.sin(a)).toFixed(1)}`
    return `M ${p(a0, inner)} L ${p(a0, r)} A ${r} ${r} 0 0 1 ${p(a1, r)} L ${p(a1, inner)} A ${inner} ${inner} 0 0 0 ${p(a0, inner)} Z`
  }

  return (
    <>
      <p className="dash-kicker">{block ? tr('Le bloc choisi', 'The chosen block') : tr('La place libre type', 'The typical free spot')}</p>
      <h2 className="dash-title">{block ? short(block) : tr('Pourquoi ces places', 'Why these spots')}</h2>
      <p className="muted dash-portrait-note">
        {block
          ? score === null
            ? tr('Pas de note pour ce bloc.', 'No score for this block.')
            : `${tr('Son potentiel', 'Its potential')} ${rankText(score)}.`
          : tr('Un pétale par couche : plus il est long, plus la place libre médiane dépasse Paris.', 'One petal per layer: the longer, the more the median free spot beats Paris.')}
      </p>
      <svg className="dash-flower" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={tr('Les raisons, couche par couche', 'The reasons, layer by layer')}>
        {petals.map((p, i) => (
          <g key={p.id} className="dash-petal" onClick={() => props.onLayer(p.id)}>
            <path d={petalPath(i, 100)} className="dash-petal-track" />
            <path d={petalPath(i, p.share)} fill={p.colour} opacity={layer === p.id || !REASONS.some((r) => r.id === layer) ? 1 : 0.45} />
            <title>{`${p.label} : ${p.text}`}</title>
          </g>
        ))}
        <text x={c} y={c + 2} textAnchor="middle" className="dash-flower-score">
          {score === null ? (block ? '–' : fmt(open.length)) : Math.round(score)}
        </text>
        <text x={c} y={c + 22} textAnchor="middle" className="dash-flower-unit">
          {score === null ? (block ? '' : tr('places', 'spots')) : '/ 100'}
        </text>
      </svg>
      <ul className="dash-petal-keys">
        {petals.map((p) => (
          <li key={p.id}>
            <button aria-pressed={layer === p.id} onClick={() => props.onLayer(p.id)}>
              <span className="key-dot" style={{ background: p.colour }} aria-hidden="true" />
              <span className="dash-petal-name">{p.label}</span>
              <span className="muted">{p.text}</span>
            </button>
          </li>
        ))}
      </ul>
      {block && (
        <button className="dash-clear" onClick={props.onClear}>
          {tr('← Tout Paris', '← All of Paris')}
        </button>
      )}
    </>
  )
}

function valueText(k: string, v: number | null) {
  if (v === null) return '–'
  if (k.startsWith('score')) return `${Math.round(v)} / 100`
  if (k === 'demand') return `${fmt(v)} ${tr('(Paris = 100)', '(Paris = 100)')}`
  if (k === 'street_footfall') return `${fmt(v, 1)} ×`
  if (k === 'transit_entries_r2') return `${fmt(v / 1000)}k / ${tr('jour', 'day')}`
  if (k === 'commercial_price_m2') return `${fmt(v)} € / m²`
  if (k.startsWith('luxury')) return formatValue(v, 'boutiques')
  if (k === 'upscale_rooms_r1') return formatValue(v, 'rooms')
  return formatValue(v, 'places')
}

/** The free spots as a row of hexagons, the darker the better, numbered as on the map. */
function Spots(props: { open: CellProps[]; cell: string | null; profile: ProfileId; onBlock: (cell: string) => void }) {
  const key = scoreKey(props.profile)
  const ramp = coloursOf(rampFor(key))
  if (!props.open.length) return <p className="muted">{tr('Aucune place libre pour ce type de marque.', 'No free spot for this type of brand.')}</p>
  return (
    <ol className="dash-spots">
      {props.open.map((p, i) => {
        const s = num(p, key) ?? 0
        const chosen = p.cell === props.cell
        const shade = s >= SCORE_BREAKS[3] ? 4 : s >= SCORE_BREAKS[2] ? 3 : 2
        return (
          <li key={p.cell}>
            <button aria-current={chosen ? 'true' : undefined} onClick={() => props.onBlock(p.cell)} title={`${i + 1}. ${short(p)} · ${Math.round(s)} / 100`}>
              <svg viewBox="0 0 40 46" aria-hidden="true">
                <path d="M20 1 L39 12 L39 34 L20 45 L1 34 L1 12 Z" fill={chosen ? 'var(--ink)' : ramp[shade]} />
                <text x="20" y="23" dy="0.35em" textAnchor="middle" className={chosen || shade >= 3 ? 'on-dark' : ''}>
                  {Math.round(s)}
                </text>
              </svg>
              <span className="dash-spot-place">
                <span className="muted">{i + 1}</span> {short(p)}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** Where each arrondissement sits as a hexagon tile: column (in half steps) and row, north at the top. */
const TILES: [string, number, number][] = [
  ['17e', 1, 0], ['18e', 2, 0], ['19e', 3, 0],
  ['16e', 0.5, 1], ['8e', 1.5, 1], ['9e', 2.5, 1], ['10e', 3.5, 1], ['20e', 4.5, 1],
  ['7e', 1, 2], ['1er', 2, 2], ['2e', 3, 2], ['11e', 4, 2],
  ['15e', 0.5, 3], ['6e', 1.5, 3], ['4e', 2.5, 3], ['3e', 3.5, 3],
  ['14e', 1, 4], ['5e', 2, 4], ['13e', 3, 4], ['12e', 4, 4],
]

/** The 20 arrondissements as tiles, coloured by average potential, with the free spots or boutiques counted. */
function TileMap(props: { rows: Map<string, ArrRow>; profile: ProfileId; fresh: boolean; chosen: string | null; onBlock: (cell: string) => void }) {
  const ramp = coloursOf(rampFor(scoreKey(props.profile)))
  const R = 22
  const w = Math.sqrt(3) * R
  const h = 1.5 * R
  return (
    <svg className="dash-tiles" viewBox={`0 0 ${5 * w + 4} ${4 * h + 2 * R + 4}`} role="img" aria-label={tr('Les 20 arrondissements', 'The 20 arrondissements')}>
      {TILES.map(([name, col, row]) => {
        const r = props.rows.get(name)
        const mean = r?.scores.length ? r.scores.reduce((a, b) => a + b, 0) / r.scores.length : 0
        const shade = Math.min(4, Math.floor(mean / 20))
        const chosen = props.chosen === name
        const x = w / 2 + col * w + 2
        const y = R + row * h + 2
        const pts = Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i - Math.PI / 2
          return `${(x + (R - 1) * Math.cos(a)).toFixed(1)},${(y + (R - 1) * Math.sin(a)).toFixed(1)}`
        }).join(' ')
        const count = (props.fresh ? r?.open : r?.boutiques) ?? 0
        const tone = chosen || shade >= 3 ? 'on-dark' : ''
        return (
          <g key={name} className="dash-tile" onClick={() => r?.best && props.onBlock(r.best.cell)}>
            <polygon points={pts} fill={chosen ? 'var(--ink)' : ramp[shade]} />
            <text x={x} y={count ? y - 4 : y} dy="0.35em" textAnchor="middle" className={tone}>
              {name}
            </text>
            {count > 0 && (
              <g>
                {Array.from({ length: Math.min(count, 5) }, (_, i) => (
                  <circle
                    key={i}
                    cx={x + (i - (Math.min(count, 5) - 1) / 2) * 5}
                    cy={y + 9}
                    r={1.8}
                    className={props.fresh ? 'dash-tile-dot' : 'dash-tile-dot taken'}
                    style={props.fresh ? undefined : { fill: profileColour(props.profile) }}
                  />
                ))}
              </g>
            )}
            <title>{`${name} · ${tr('potentiel moyen', 'average potential')} ${Math.round(mean)} · ${r?.open ?? 0} ${tr('places libres', 'free spots')} · ${r?.boutiques ?? 0} ${tr('boutiques', 'boutiques')}`}</title>
          </g>
        )
      })}
    </svg>
  )
}

/** One column per tenth of potential, as high as the share of its blocks with luxury already; the chosen block's tenth in ink. */
function Tenths(props: { bins: { blocks: number; taken: number }[]; mark: number | null; colour: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const markBin = props.mark === null ? null : Math.min(9, Math.floor(props.mark / 10))
  const share = (b: { blocks: number; taken: number }) => (b.blocks ? b.taken / b.blocks : 0)
  const max = Math.max(0.01, ...props.bins.map(share))
  return (
    <>
      <div className="dash-histogram" onMouseLeave={() => setHover(null)}>
        {props.bins.map((b, i) => (
          <div key={i} className="dash-col" onMouseEnter={() => setHover(i)} title={`${i * 10}–${i * 10 + 10} · ${fmt(b.taken)} / ${fmt(b.blocks)}`}>
            {(hover === i || (hover === null && (i === 9 || i === markBin))) && (
              <span className="dash-col-value">
                {Math.round(share(b) * 100)}
                {pc()}
              </span>
            )}
            <span className="dash-col-bar" style={{ height: `${(share(b) / max) * 100}%`, background: i === markBin ? 'var(--ink)' : props.colour }} />
          </div>
        ))}
      </div>
      <div className="dash-axis muted" aria-hidden="true">
        <span>{tr('potentiel 0', 'potential 0')}</span>
        <span>100</span>
      </div>
      <p className="dash-note muted">
        {tr(
          `Part des blocs avec déjà une boutique de ce type autour. Places libres : ${OPEN_RULE.score} et plus.`,
          `Share of blocks that already have a boutique of this type around. Free spots: ${OPEN_RULE.score} and up.`,
        )}
      </p>
    </>
  )
}
