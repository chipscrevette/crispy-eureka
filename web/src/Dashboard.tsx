import { useEffect, useMemo, useRef, useState } from 'react'
import { loadData, type Data } from './appData'
import { ATLAS, atlasKey, cssVar as css, fills, sizeCanvas, useOutline } from './atlasLayers'
import { OPEN_RULE, openKey } from './dashboardData'
import { cellAt, cellIndex } from './geo'
import { formatValue, type CellProps } from './grid'
import { fmt, lang, switchLang, tr } from './i18n'
import { coloursOf, isDark, profileColour, rampFor } from './palette'
import { SCORE_BREAKS, ordinal, placeOf, rankText, scoreKey } from './scores'
import { PROFILES, countByProfile, type ProfileId } from './stores'
import { MAP_URL, MAP_WINDOW, connect, sameShared, type Shared } from './sync'
import LayerStack from './LayerStack'
import { fromCatchments, loadWalkZones, zoneOf, type WalkZones } from './walkZones'
import { loadStations, type Stations } from './stations'
import { badgeHtml, lineColours, loadNetwork, type LineColours } from './network'

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

const SECTIONS = [
  { id: 'overview', label: tr('Vue d’ensemble', 'Overview') },
  { id: 'block', label: tr('Le bloc', 'The block') },
  { id: 'arrondissements', label: tr('Arrondissements', 'Arrondissements') },
  { id: 'brands', label: tr('Marques', 'Brands') },
  { id: 'method', label: tr('Méthode', 'Method') },
] as const
type Section = (typeof SECTIONS)[number]['id']
const readSection = (): Section => SECTIONS.find((x) => `#${x.id}` === window.location.hash)?.id ?? 'overview'

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
  // the section is the dashboard's own, kept in the address so a link opens on it
  const [section, setSection] = useState<Section>(readSection)
  const go = (id: Section) => {
    setSection(id)
    window.history.replaceState(null, '', `#${id}`)
    window.scrollTo(0, 0)
  }
  const { profile, layer, cell, fresh } = shared
  const key = scoreKey(profile)
  const cells = useMemo(() => (data ? cellIndex(data.grid) : null), [data])
  const block = (cell && cells?.get(cell)?.properties) || null
  // the walking zone around the chosen block, loaded the first time a block is chosen
  const [minutes, setMinutes] = useState(10)
  const [zones, setZones] = useState<WalkZones | null>(null)
  const [stations, setStations] = useState<Stations | null>(null)
  const [colours, setColours] = useState<LineColours | null>(null)
  useEffect(() => {
    if (!cell || zones || !data) return
    loadWalkZones().then(setZones, () => setZones(fromCatchments(data.catchments)))
    loadStations().then(setStations, () => setStations(null))
    loadNetwork().then((n) => setColours(n ? lineColours(n) : null), () => setColours(null))
  }, [cell, zones, data])
  // until the data build has made every band, the one band there is stands in
  const walkMin = zones && !zones.bands.includes(minutes) ? zones.bands[zones.bands.length - 1] : minutes
  const zone = useMemo(() => (block && zones ? zoneOf(zones, block.cell, walkMin) : null), [block, zones, walkMin])
  // what the map shows stays inside Paris: boutiques and stations are placed in their block, or left out
  const placed = useMemo(() => {
    const stores = new Map<string, string>()
    for (const f of data?.stores.features ?? []) {
      const c = cellAt(data!.grid, f.geometry.coordinates as [number, number])
      if (c) stores.set(f.properties.id, c)
    }
    return stores
  }, [data])
  const stationCells = useMemo(() => {
    if (!data || !stations) return []
    return stations.features
      .map((f) => ({ p: f.properties, cell: cellAt(data.grid, f.geometry.coordinates as [number, number]) }))
      .filter((x): x is { p: (typeof x)['p']; cell: string } => !!x.cell)
  }, [data, stations])

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
  const layerPick = (
    <div className="dash-layer-pick" role="radiogroup" aria-label={tr('Couche de la carte', 'Map layer')}>
      {ATLAS.map((l) => (
        <button key={l.id} role="radio" aria-checked={layer === l.id} onClick={() => set({ layer: l.id })}>
          <span className="key-dot" style={{ background: coloursOf(rampFor(atlasKey(l.id, profile)))[3] }} aria-hidden="true" />
          {l.label}
        </button>
      ))}
    </div>
  )

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
          {linked && (
            <>
              <span className="dash-live on" aria-hidden="true" />
              {tr('Lié à la carte 3D', 'Linked to the 3D map')}
            </>
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
        <>
          <nav className="dash-nav" aria-label={tr('Sections', 'Sections')}>
            {SECTIONS.map((x) => (
              <button key={x.id} aria-current={section === x.id ? 'page' : undefined} onClick={() => go(x.id)}>
                {x.label}
              </button>
            ))}
            <a className="dash-nav-out" href={MAP_URL} target={MAP_WINDOW}>
              {tr('Carte 3D', '3D map')} <span aria-hidden="true">↗</span>
            </a>
          </nav>

          {section === 'overview' && (
            <main className="dash-board">
              <section className="dash-hero" aria-label={tr('Carte', 'Map')}>
                <div className="dash-hero-head">
                  <p className="dash-kicker">{tr('Sur la carte', 'On the map')}</p>
                  <h1 className="dash-title">{layerInfo.label}</h1>
                  <p className="muted">{layerInfo.note}</p>
                  {layerPick}
                  {block && (
                    <div className="dash-walk" role="radiogroup" aria-label={tr('Zone à pied', 'Walking zone')}>
                      <p className="dash-kicker">{tr('Zone à pied', 'Walking zone')}</p>
                      <div className="dash-seg">
                        {(zones?.bands ?? [5, 10, 15, 20]).map((m) => (
                          <button key={m} role="radio" aria-checked={walkMin === m} aria-pressed={walkMin === m} onClick={() => setMinutes(m)}>
                            {m} min
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <Figure value={fmt(open.length)} label={tr('places libres', 'free spots')} accent />
                  <Figure value={fmt(counts![profile])} label={tr('boutiques aujourd’hui', 'boutiques today')} />
                </div>
                <HeroMap data={data} profile={profile} layer={layer} cell={cell} fresh={fresh} open={open} zone={zone} placed={placed} onBlock={(c) => set({ cell: c })} />
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
                {block && (
                  <button className="dash-more" onClick={() => go('block')}>
                    {tr('Tout sur ce bloc →', 'All about this block →')}
                  </button>
                )}
              </section>

              {block ? (
                <section className="dash-detail">
                  <div className="dash-card dash-stack">
                    <BlockHead block={block} profile={profile} />
                    <LayerStack grid={data.grid} cell={block} profile={profile} />
                  </div>
                  <div className="dash-card dash-zone">
                    <ZoneBox
                      data={data}
                      profile={profile}
                      minutes={walkMin}
                      zone={zone}
                      placed={placed}
                      stations={stationCells}
                      colours={colours}
                    />
                  </div>
                </section>
              ) : (
                <section className="dash-start">
                  <div className="dash-card">
                    <p className="dash-kicker">{tr('Commencez par une place libre', 'Start with a free spot')}</p>
                    <p className="muted dash-start-note">
                      {tr('Ou cliquez n’importe quel bloc de la carte : sa zone à pied et ses raisons s’affichent ici.', 'Or click any block on the map: its walking zone and its reasons show here.')}
                    </p>
                    <Spots open={open} cell={cell} profile={profile} onBlock={(c) => set({ cell: c })} />
                  </div>
                </section>
              )}
            </main>
          )}

          {section === 'block' && (
            <main className="dash-section dash-block-page">
              {block ? (
                <>
                  <section className="dash-card dash-stack">
                    <BlockHead block={block} profile={profile} />
                    <LayerStack grid={data.grid} cell={block} profile={profile} />
                  </section>
                  <section className="dash-card dash-portrait-card">
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
                  <section className="dash-column">
                    <div className="dash-card">
                      <p className="dash-kicker">{tr('Ce qui fait la note du bloc', 'What makes the block’s score')}</p>
                      <Drivers data={data} profile={profile} block={block} />
                    </div>
                    <div className="dash-card">
                      <p className="dash-kicker">{tr('Le bloc pour chaque type de marque', 'The block for each type of brand')}</p>
                      <Profiles data={data} block={block} profile={profile} onProfile={(p) => set({ profile: p })} onBlock={(c) => set({ cell: c })} />
                    </div>
                  </section>
                </>
              ) : (
                <section className="dash-card dash-pick">
                  <p className="dash-kicker">{tr('Choisissez un bloc', 'Choose a block')}</p>
                  <h1 className="dash-title">{tr('Commencez par une place libre', 'Start with a free spot')}</h1>
                  <p className="muted">{tr('Ou cliquez un bloc sur la carte, dans l’autre onglet.', 'Or click a block on the map, in the other tab.')}</p>
                  <Spots open={open} cell={cell} profile={profile} onBlock={(c) => set({ cell: c })} />
                </section>
              )}
            </main>
          )}

          {section === 'arrondissements' && (
            <main className="dash-section dash-arr-page">
              <section className="dash-card">
                <p className="dash-kicker">{tr('Paris en 20 arrondissements', 'Paris in 20 arrondissements')}</p>
                <h1 className="dash-title">{tr('Où chercher', 'Where to look')}</h1>
                <p className="muted">
                  {tr('Couleur : potentiel moyen des blocs. Points : places libres, ou boutiques déjà là.', 'Colour: average potential of the blocks. Dots: free spots, or boutiques already there.')}
                </p>
                <TileMap rows={arrondissements} profile={profile} fresh={fresh} chosen={block ? short(block) : null} onBlock={(c) => { set({ cell: c }); go('block') }} />
              </section>
              <section className="dash-card">
                <p className="dash-kicker">{tr('Classement', 'Ranking')}</p>
                <ArrRanking rows={arrondissements} profile={profile} chosen={block ? short(block) : null} onBlock={(c) => { set({ cell: c }); go('block') }} />
              </section>
            </main>
          )}

          {section === 'brands' && (
            <main className="dash-section dash-brands-page">
              <section className="dash-hero" aria-label={tr('Carte', 'Map')}>
                <div className="dash-hero-head">
                  <p className="dash-kicker">{tr('Les boutiques déjà là', 'The boutiques already there')}</p>
                  <h1 className="dash-title">{PROFILES.find((p) => p.id === profile)?.label}</h1>
                  <p className="muted">{tr('Un point par boutique du catalogue, sur la couche choisie.', 'One dot per catalogue boutique, on the chosen layer.')}</p>
                  {layerPick}
                  <Figure value={fmt(counts![profile])} label={tr('boutiques', 'boutiques')} accent />
                </div>
                <HeroMap data={data} profile={profile} layer={layer} cell={cell} fresh={false} open={open} zone={null} placed={placed} onBlock={(c) => set({ cell: c })} />
              </section>
              <section className="dash-card">
                <p className="dash-kicker">{tr('Les marques, par nombre de boutiques', 'The brands, by number of boutiques')}</p>
                <Brands data={data} profile={profile} limit={16} />
              </section>
            </main>
          )}

          {section === 'method' && (
            <main className="dash-section dash-method-page">
              <section className="dash-card">
                <p className="dash-kicker">{tr('Test à l’aveugle', 'Blind test')}</p>
                <h1 className="dash-title">{tr('Le modèle tient-il ?', 'Does the model hold up?')}</h1>
                <BlindTest data={data} profile={profile} />
              </section>
              <section className="dash-card">
                <p className="dash-kicker">{tr('Ce qui compte le plus pour le modèle', 'What matters most to the model')}</p>
                <Drivers data={data} profile={profile} block={null} />
              </section>
              <section className="dash-card">
                <p className="dash-kicker">{tr('Le luxe est déjà là où le potentiel est haut', 'Luxury is already where potential is high')}</p>
                <Tenths bins={tenths} mark={block ? num(block, key) : null} colour={coloursOf(rampFor(key))[3]} />
              </section>
              <section className="dash-card dash-sources">
                <p className="dash-kicker">{tr('Données ouvertes', 'Open data')}</p>
                <ul>
                  {(data.meta.sources ?? []).map((src) => (
                    <li key={src}>{src}</li>
                  ))}
                </ul>
                <p className="dash-note muted">
                  {tr('Chaque chiffre vient d’un script du dépôt et d’une publication datée.', 'Every number comes from a script in the repository and a dated data release.')}{' '}
                  <a href="https://github.com/chipscrevette/crispy-eureka" target="_blank" rel="noreferrer">GitHub ↗</a>
                </p>
              </section>
            </main>
          )}
        </>
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
  zone: Set<string> | null
  placed: Map<string, string>
  onBlock: (cell: string) => void
}) {
  const { data, profile, layer, cell, fresh, open, zone, placed, onBlock } = props
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
        // around a chosen block, what is beyond the walk steps back
        ctx.globalAlpha = zone && !zone.has(b.cell) ? 0.38 : 1
        ctx.fill()
      }
      ctx.globalAlpha = 1
      if (!fresh) {
        ctx.fillStyle = profileColour(profile)
        for (const f of data.stores.features) {
          const at = placed.get(f.properties.id)
          if (f.properties.profile !== profile || !at) continue
          ctx.globalAlpha = zone && !zone.has(at) ? 0.4 : 1
          const [x, y] = outline.project(f.geometry.coordinates)
          ctx.beginPath()
          ctx.arc(ox + x * s, oy + y * s, 3, 0, 2 * Math.PI)
          ctx.fill()
        }
        ctx.globalAlpha = 1
        return
      }
      // the free spots, numbered as in the list, like the pins of the map page
      ctx.font = `500 11px ${css('--display')}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const [accent, surface] = [css('--accent'), css('--surface')]
      for (const b of outline.blocks) {
        const n = rank.get(b.cell)
        if (!n || (zone && !zone.has(b.cell))) continue
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
  }, [outline, colours, cell, fresh, profile, data, rank, zone, placed])

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
    <svg className="dash-tiles" viewBox={`0 0 ${5.5 * w + 4} ${4 * h + 2 * R + 4}`} role="img" aria-label={tr('Les 20 arrondissements', 'The 20 arrondissements')}>
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

const featureName = (data: Data, k: string) =>
  data.scores.features.find((f) => f.key === k)?.label ?? data.meta.features.find((f) => f.key === k)?.label ?? k

/**
 * Why the model scores as it does. For a block: the four layers that moved its score most, up or
 * down (SHAP contributions in log-odds, from scores.json). With no block: the model's average weight of each layer.
 */
function Drivers(props: { data: Data; profile: ProfileId; block: CellProps | null }) {
  const { data, profile, block } = props
  const rows: { key: string; v: number }[] = block
    ? (data.scores.profiles[profile].cells[block.cell]?.[1] ?? []).map(([key, v]) => ({ key, v }))
    : data.scores.importance[profile].slice(0, 6).map(([key, v]) => ({ key, v }))
  if (!rows.length) return <p className="muted">{tr('Pas de détail pour ce bloc.', 'No detail for this block.')}</p>
  const max = Math.max(...rows.map((r) => Math.abs(r.v)))
  const [up, down] = [coloursOf(rampFor(scoreKey(profile)))[3], 'var(--muted)']
  return (
    <>
      <ul className="dash-drivers">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="dash-driver-name">{featureName(data, r.key)}</span>
            <span className={block ? 'dash-driver-track diverging' : 'dash-driver-track'}>
              <span
                style={{
                  width: `${(Math.abs(r.v) / max) * (block ? 50 : 100)}%`,
                  background: r.v >= 0 ? up : down,
                  ...(block ? (r.v >= 0 ? { left: '50%' } : { right: '50%' }) : { left: 0 }),
                }}
              />
            </span>
            {block && <span className="dash-driver-sign muted">{r.v >= 0 ? tr('pousse', 'lifts') : tr('freine', 'holds back')}</span>}
          </li>
        ))}
      </ul>
      <p className="dash-note muted">
        {block
          ? tr('Les quatre couches qui ont le plus monté ou baissé la note de ce bloc (valeurs SHAP).', 'The four layers that raised or lowered this block’s score most (SHAP values).')
          : tr('Poids moyen de chaque couche dans les notes (SHAP). Choisissez un bloc pour voir les siennes.', 'Average weight of each layer in the scores (SHAP). Choose a block to see its own.')}
      </p>
    </>
  )
}

/** The block's potential for the three types of brand, or each type's best free spot; a click switches the type. */
function Profiles(props: { data: Data; block: CellProps | null; profile: ProfileId; onProfile: (p: ProfileId) => void; onBlock: (cell: string) => void }) {
  const { data, block, profile } = props
  const groups = data.groups
  return (
    <>
      <div className="dash-rings">
        {PROFILES.map((p) => {
          const k = scoreKey(p.id)
          const best = block ? null : data.grid.features.map((f) => f.properties).filter((x) => x[openKey(k)] === 1).sort((a, b) => (num(b, k) ?? 0) - (num(a, k) ?? 0))[0]
          const s = num(block ?? best ?? { cell: '' }, k)
          const r = 26
          const c = 2 * Math.PI * r
          return (
            <button
              key={p.id}
              aria-pressed={profile === p.id}
              onClick={() => {
                props.onProfile(p.id)
                if (best) props.onBlock(best.cell)
              }}
            >
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <circle cx="32" cy="32" r={r} className="dash-ring-track" />
                <circle
                  cx="32"
                  cy="32"
                  r={r}
                  className="dash-ring-value"
                  stroke={profileColour(p.id)}
                  strokeDasharray={`${(c * (s ?? 0)) / 100} ${c}`}
                  transform="rotate(-90 32 32)"
                />
                <text x="32" y="32" dy="0.35em" textAnchor="middle">
                  {s === null ? '–' : Math.round(s)}
                </text>
              </svg>
              <span>{SHORT[p.id]}</span>
              {best && <span className="muted">{short(best)}</span>}
            </button>
          )
        })}
      </div>
      {block && (
        <div className="dash-mix">
          <p className="dash-note muted">{tr('Pouvoir d’achat du bloc, Paris = 100', 'Block spending, Paris = 100')}</p>
          {groups.map((g, i) => {
            const v = num(block, `demand_${g.key}`) ?? 0
            return (
              <p key={g.key} className="dash-mix-row">
                <span>{g.label}</span>
                <span className="dash-mix-track">
                  <span style={{ width: `${Math.min(v, 400) / 4}%`, background: coloursOf(rampFor('demand'))[2 + i] }} />
                  <span className="dash-mix-avg" aria-hidden="true" />
                </span>
                <span className="muted">{fmt(v)}</span>
              </p>
            )
          })}
        </div>
      )}
    </>
  )
}

/** The brands of the type in the catalogue, by number of Paris boutiques (open data, no logos). */
function Brands(props: { data: Data; profile: ProfileId; limit?: number }) {
  const counts = new Map<string, number>()
  for (const f of props.data.stores.features) {
    if (f.properties.profile !== props.profile) continue
    counts.set(f.properties.brand, (counts.get(f.properties.brand) ?? 0) + 1)
  }
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, props.limit ?? 8)
  const max = top[0]?.[1] ?? 1
  return (
    <>
      <ul className="dash-brands">
        {top.map(([brand, n]) => (
          <li key={brand}>
            <span className="dash-brand-name">{brand}</span>
            <span className="dash-brand-track">
              <span style={{ width: `${(n / max) * 100}%`, background: profileColour(props.profile) }} />
            </span>
            <span className="muted">{n}</span>
          </li>
        ))}
      </ul>
      <p className="dash-note muted">
        {tr(`${counts.size} marques au total. Lieux : Overture Maps et OpenStreetMap.`, `${counts.size} brands in all. Places: Overture Maps and OpenStreetMap.`)}
      </p>
    </>
  )
}

/**
 * The model's hold-out test: boutiques hidden from it, then ranked. Where it placed them, against two
 * simple rules (luxury nearby, apartment price), from scores.json.
 */
function BlindTest(props: { data: Data; profile: ProfileId }) {
  const v = props.data.scores.validation[props.profile]
  const setup = props.data.scores.validation_setup
  const rows: { id: keyof typeof v; label: string }[] = [
    { id: 'model', label: tr('Notre modèle', 'Our model') },
    { id: 'luxury neighbours', label: tr('Règle : luxe autour', 'Rule: luxury nearby') },
    { id: 'apartment price', label: tr('Règle : prix au m²', 'Rule: price per m²') },
  ]
  return (
    <>
      <ul className="dash-brands dash-test">
        {rows.map((r) => (
          <li key={r.id} className={r.id === 'model' ? 'model' : ''}>
            <span className="dash-brand-name">{r.label}</span>
            <span className="dash-brand-track">
              <span style={{ width: `${v[r.id].mean_percentile}%`, background: r.id === 'model' ? 'var(--accent)' : 'var(--muted)' }} />
            </span>
            <span className="muted">{ordinal(v[r.id].mean_percentile)}</span>
          </li>
        ))}
      </ul>
      <p className="dash-note muted">
        {tr(
          `Des marques entières sont cachées au modèle (${setup.folds} plis). Centile moyen où tombent leurs ${v.model.held_out_cells} blocs à boutique ; 100 = tout en haut.`,
          `Whole brands are hidden from the model (${setup.folds} folds). Average percentile of their ${v.model.held_out_cells} boutique blocks; 100 = the very top.`,
        )}
      </p>
    </>
  )
}

/** The chosen block's score as a ring, with a plain verdict, as on the map page. */
function BlockHead(props: { block: CellProps; profile: ProfileId }) {
  const s = num(props.block, scoreKey(props.profile))
  const r = 30
  const c = 2 * Math.PI * r
  const verdict =
    s === null
      ? tr('Pas de note pour ce bloc.', 'No score for this block.')
      : s >= 95
        ? tr('Une des meilleures adresses de Paris', 'One of the best addresses in Paris')
        : s >= 75
          ? tr('Une très bonne adresse', 'A very good address')
          : s >= 50
            ? tr('Une adresse correcte', 'A fair address')
            : tr('Une adresse faible', 'A weak address')
  return (
    <div className="dash-block-head">
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle cx="36" cy="36" r={r} className="dash-ring-track" />
        <circle
          cx="36"
          cy="36"
          r={r}
          className="dash-ring-value"
          stroke={coloursOf(rampFor(scoreKey(props.profile)))[3]}
          strokeDasharray={`${(c * (s ?? 0)) / 100} ${c}`}
          transform="rotate(-90 36 36)"
        />
        <text x="36" y="36" dy="0.35em" textAnchor="middle">
          {s === null ? '–' : Math.round(s)}
        </text>
      </svg>
      <div>
        <h1 className="dash-title">{short(props.block)}</h1>
        <p className="muted">
          {verdict}
          {s !== null && <>. {tr('Ce bloc', 'This block')} {rankText(s)}.</>}
        </p>
      </div>
    </div>
  )
}

/** The 20 arrondissements ranked by average potential, with their free spots and boutiques. */
function ArrRanking(props: { rows: Map<string, ArrRow>; profile: ProfileId; chosen: string | null; onBlock: (cell: string) => void }) {
  const ramp = coloursOf(rampFor(scoreKey(props.profile)))
  const rows = [...props.rows]
    .map(([name, r]) => ({ name, ...r, mean: r.scores.length ? r.scores.reduce((a, b) => a + b, 0) / r.scores.length : 0 }))
    .sort((a, b) => b.mean - a.mean)
  return (
    <ol className="dash-ranking">
      {rows.map((r) => (
        <li key={r.name}>
          <button aria-current={props.chosen === r.name ? 'true' : undefined} onClick={() => r.best && props.onBlock(r.best.cell)}>
            <span className="dash-rank-name">{r.name}</span>
            <span className="dash-brand-track">
              <span style={{ width: `${r.mean}%`, background: ramp[Math.min(4, Math.floor(r.mean / 20))] }} />
            </span>
            <span className="muted">{Math.round(r.mean)}</span>
            <span className="dash-rank-dots" aria-label={`${r.open} ${tr('places libres', 'free spots')}`}>
              {Array.from({ length: Math.min(r.open, 6) }, (_, i) => (
                <span key={i} className="dash-rank-dot" />
              ))}
            </span>
            <span className="dash-rank-dots" aria-label={`${r.boutiques} ${tr('boutiques', 'boutiques')}`}>
              {Array.from({ length: Math.min(r.boutiques, 12) }, (_, i) => (
                <span key={i} className="dash-rank-dot taken" style={{ background: profileColour(props.profile) }} />
              ))}
              {r.boutiques > 12 && <span className="muted"> +{r.boutiques - 12}</span>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/**
 * What is within the walk of the chosen block: free spots, boutiques of the type and their brands,
 * stations with their lines and daily entries, spending and the busiest street. Counts come from
 * points placed in blocks, never from the blocks' own neighbourhood sums, so nothing is counted twice.
 */
function ZoneBox(props: {
  data: Data
  profile: ProfileId
  minutes: number
  zone: Set<string> | null
  placed: Map<string, string>
  stations: { p: { name: string; entries: number; lines?: string[] }; cell: string }[]
  colours: LineColours | null
}) {
  const { data, profile, minutes, zone, placed, stations, colours } = props
  if (!zone) return <p className="muted">{tr('Calcul de la zone à pied…', 'Working out the walking zone…')}</p>
  const key = scoreKey(profile)
  const blocks = data.grid.features.map((f) => f.properties).filter((p) => zone.has(p.cell))
  const free = blocks.filter((p) => p[openKey(key)] === 1).length
  const brands = new Map<string, number>()
  for (const f of data.stores.features) {
    const at = placed.get(f.properties.id)
    if (f.properties.profile === profile && at && zone.has(at)) brands.set(f.properties.brand, (brands.get(f.properties.brand) ?? 0) + 1)
  }
  const boutiques = [...brands.values()].reduce((a, b) => a + b, 0)
  const near = stations.filter((s) => zone.has(s.cell)).sort((a, b) => b.p.entries - a.p.entries)
  const entries = near.reduce((a, s) => a + s.p.entries, 0)
  const spend = blocks.map((p) => num(p, 'demand')).filter((v): v is number => v !== null)
  const spendAvg = spend.length ? spend.reduce((a, b) => a + b, 0) / spend.length : null
  const busiest = Math.max(0, ...blocks.map((p) => num(p, 'street_footfall') ?? 0))
  return (
    <>
      <p className="dash-kicker">{tr('Dans la zone à pied', 'Within the walk')}</p>
      <h2 className="dash-title">
        {minutes} min <span className="muted dash-title-note">· {fmt(blocks.length)} {tr('blocs, le long des rues', 'blocks, along the streets')}</span>
      </h2>
      <div className="dash-zone-figures">
        <Figure value={fmt(free)} label={tr('places libres', 'free spots')} accent />
        <Figure value={fmt(boutiques)} label={tr('boutiques de ce type', 'boutiques of this type')} />
        <Figure value={entries >= 1000 ? `${fmt(entries / 1000)}k` : fmt(entries)} label={tr('entrées en gare par jour', 'station entries a day')} />
        <Figure value={busiest ? `${fmt(busiest, 1)}×` : '–'} label={tr('la rue la plus passante, en rues types', 'busiest street, in typical streets')} />
      </div>
      {spendAvg !== null && (
        <div className="dash-zone-spend">
          <span>{tr('Pouvoir d’achat moyen', 'Average spending')}</span>
          <span className="dash-mix-track">
            <span style={{ width: `${Math.min(spendAvg, 400) / 4}%`, background: coloursOf(rampFor('demand'))[3] }} />
            <span className="dash-mix-avg" aria-hidden="true" />
          </span>
          <span className="muted">{fmt(spendAvg)} {tr('(Paris = 100)', '(Paris = 100)')}</span>
        </div>
      )}
      <div className="dash-zone-lists">
        <div>
          <p className="dash-note muted">{tr('Déjà là', 'Already there')}</p>
          {brands.size ? (
            <ul className="dash-chips">
              {[...brands]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([b, n]) => (
                  <li key={b}>
                    <span className="key-dot" style={{ background: profileColour(profile) }} aria-hidden="true" />
                    {b}
                    {n > 1 && <span className="muted"> ×{n}</span>}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="dash-empty">{tr('Aucune boutique de ce type : la place est libre.', 'No boutique of this type: the field is open.')}</p>
          )}
        </div>
        <div>
          <p className="dash-note muted">{tr('Gares', 'Stations')}</p>
          {near.length ? (
            <ul className="dash-stations">
              {near.slice(0, 6).map((s) => (
                <li key={s.p.name}>
                  <span
                    className="tip-badges"
                    dangerouslySetInnerHTML={{ __html: colours ? (s.p.lines ?? []).map((l) => badgeHtml(l, colours)).join('') : '' }}
                  />
                  <span className="dash-station-name">{s.p.name}</span>
                  <span className="muted">{s.p.entries >= 1000 ? `${fmt(s.p.entries / 1000)}k` : fmt(s.p.entries)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dash-empty">{tr('Aucune gare dans la zone.', 'No station in the zone.')}</p>
          )}
        </div>
      </div>
    </>
  )
}
