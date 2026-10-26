import { useEffect, useMemo, useRef, useState } from 'react'
import { loadRawData, localData, type Data } from './appData'
import { ATLAS, atlasKey, shadeOf } from './atlasLayers'
import { loadBorders, type Borders } from './borders'
import { OPEN_RULE, openKey } from './dashboardData'
import { cellAt, cellIndex, type LonLat } from './geo'
import type { CellProps } from './grid'
import { fmt, lang, switchLang, tr, useLang } from './i18n'
import { coloursOf, isDark, profileColour, rampFor, switchTheme, useTheme, walkColour } from './palette'
import { SCORE_BREAKS, ordinal, rankText, scoreKey } from './scores'
import { PROFILES, countByProfile, type ProfileId } from './stores'
import type { Shared } from './sync'
import LayerStack from './LayerStack'
import HeroMap from './HeroMap'
import Detail, { type Metric } from './Detail'
import { kilo, num, short, valueText, zoneStats, type Placed } from './blocks'
import Search, { type Address } from './Search'
import { bandsOf, fromCatchments, loadWalkZones, type WalkZones } from './walkZones'
import { loadStations, type Stations } from './stations'
import { lineColours, loadNetwork, type LineColours, type Network } from './network'

const pc = () => (lang() === 'fr' ? ' %' : '%')

const SHORT: Record<ProfileId, string> = {
  get 'jewellery-watches'() { return tr('Joaillerie', 'Jewellery') },
  get 'fashion-house'() { return tr('Mode', 'Fashion') },
  get beauty() { return tr('Beauté', 'Beauty') },
}

/** The layers that explain the potential: a block's reasons. */
const REASONS = ATLAS.filter((l) => l.id !== 'score')

const SECTIONS = [
  { id: 'overview', get label() { return tr('Vue d’ensemble', 'Overview') } },
  { id: 'method', get label() { return tr('Méthode', 'Method') } },
] as const
type Section = (typeof SECTIONS)[number]['id']
const readSection = (): Section => SECTIONS.find((x) => `#${x.id}` === window.location.hash)?.id ?? 'overview'

/** What opens over the overview: the chosen block in full, Paris by arrondissement, or the brands already there. */
type View = 'block' | 'arrondissements' | 'brands'

type ArrRow = { scores: number[]; open: number; boutiques: number; best: CellProps | null }

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
  // the data as the files have it; its layer names follow the language, which switches in place
  const [raw, setRaw] = useState<Data | null>(null)
  const language = useLang()
  // colours are computed from the data in script, so a new object on a theme switch recomputes and redraws them
  const theme = useTheme()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- localData reads the language
  const data = useMemo(() => (raw ? localData(raw) : null), [raw, language, theme])
  useEffect(() => {
    document.title = tr('Adresse · Choisir l’emplacement d’une boutique de luxe à Paris', 'Adresse · Luxury retail site selection in Paris')
  }, [language])
  const [error, setError] = useState<string | null>(null)
  const [shared, setShared] = useState<Shared>({ profile: 'jewellery-watches', layer: 'score', cell: null, fresh: true })

  // the map's landmarks: arrondissements and metro lines, both small; the map works without them
  const [borders, setBorders] = useState<Borders | null>(null)
  const [network, setNetwork] = useState<Network | null>(null)
  useEffect(() => {
    loadRawData().then(setRaw, (e: Error) => setError(e.message))
    loadBorders().then(setBorders, () => setBorders(null))
    loadNetwork().then(setNetwork, () => setNetwork(null))
  }, [])


  const set = (patch: Partial<Shared>) => setShared((s) => ({ ...s, ...patch }))
  // the section is the dashboard's own, kept in the address so a link opens on it
  const [section, setSection] = useState<Section>(readSection)
  const go = (id: Section) => {
    setSection(id)
    setDetail(null)
    setView(null)
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
  const colours = useMemo<LineColours | null>(() => (network ? lineColours(network) : null), [network])
  useEffect(() => {
    if (!cell || zones || !data) return
    loadWalkZones().then(setZones, () => setZones(fromCatchments(data.catchments)))
    loadStations().then(setStations, () => setStations(null))
  }, [cell, zones, data])
  // until the data build has made every band, the one band there is stands in
  const walkMin = zones && !zones.bands.includes(minutes) ? zones.bands[zones.bands.length - 1] : minutes
  // the minutes at which each block is first reached from the chosen block: the rings on the map
  const rings = useMemo(() => (block && zones ? bandsOf(zones, block.cell) : null), [block, zones])
  const zone = useMemo(() => (rings ? new Set([...rings].filter(([, m]) => m <= walkMin).map(([c]) => c)) : null), [rings, walkMin])
  // a searched address: its pin, and the map closes in on its widest walk until "All of Paris"
  const [found, setFound] = useState<(Address & { cell: string }) | null>(null)
  const [searchNote, setSearchNote] = useState('')
  // one number of the walk opened up in its own view, until Back or Escape
  const [detail, setDetail] = useState<Metric | null>(null)
  const [view, setView] = useState<View | null>(null)
  // the block's view closes by itself once no block is chosen
  const open_ = view === 'block' && !block ? null : view
  // in the arrondissements view, the one framed on the map
  const [arr, setArr] = useState<string | null>(null)
  useEffect(() => {
    if (!view) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setView(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])
  const focus = useMemo(() => (found && zones ? new Set(bandsOf(zones, found.cell).keys()) : null), [found, zones])
  // one brand picked in the legend: its boutiques stand out on the map
  const [brand, setBrand] = useState<string | null>(null)
  useEffect(() => setBrand(null), [profile])
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
      .map((f) => ({ p: f.properties, at: f.geometry.coordinates as LonLat, cell: cellAt(data.grid, f.geometry.coordinates as [number, number]) }))
      .filter((x): x is Placed & { at: LonLat } => !!x.cell)
  }, [data, stations])

  const brandStores = useMemo(
    () => (brand && data ? data.stores.features.filter((f) => f.properties.profile === profile && f.properties.brand === brand) : []),
    [brand, data, profile],
  )
  const brandCount = brandStores.length
  const brandFocus = useMemo(
    () => (brandStores.length ? new Set(brandStores.map((f) => placed.get(f.properties.id)).filter((c): c is string => !!c)) : null),
    [brandStores, placed],
  )

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

  // the first answer on screen is the best free spot, already open; "All of Paris" clears it
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !open.length) return
    seeded.current = true
    setShared((s) => (s.cell ? s : { ...s, cell: open[0].cell }))
  }, [open])

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
  // the blocks of the arrondissement framed in its view
  const arrFocus = useMemo(
    () => (arr && data ? new Set(data.grid.features.filter((f) => f.properties.arrondissement && short(f.properties) === arr).map((f) => f.properties.cell)) : null),
    [arr, data],
  )

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
  const onFound = (a: Address) => {
    const c = data && cellAt(data.grid, a.at)
    if (!c) {
      setSearchNote(tr(`${a.label} est hors des blocs que nous notons.`, `${a.label} is outside the blocks we score.`))
      window.setTimeout(() => setSearchNote(''), 5000)
      return
    }
    setSearchNote('')
    setFound({ ...a, cell: c })
    set({ cell: c })
    if (section !== 'overview') go('overview')
  }
  const allParis = () => {
    setFound(null)
    set({ cell: null })
  }
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
        {data && (
          <div className="dash-search">
            <Search onFound={onFound} />
            {searchNote && <p className="dash-search-note">{searchNote}</p>}
          </div>
        )}
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
          </nav>

          {section === 'overview' && detail && block && rings && (
            <Detail
              metric={detail}
              onMetric={setDetail}
              onClose={() => setDetail(null)}
              data={data}
              profile={profile}
              block={block}
              rings={rings}
              bands={zones?.bands ?? [5, 10, 15, 20]}
              minutes={walkMin}
              onMinutes={setMinutes}
              placed={placed}
              stations={stationCells}
              colours={colours}
              open={open}
              borders={borders}
              network={network}
              onBlock={(c) => set({ cell: c })}
            />
          )}

          {section === 'overview' && !(detail && block && rings) && !open_ && (
            <main className="dash-page dash-overview">
              <section className="dash-hero" aria-label={tr('Carte', 'Map')}>
                <div className="dash-hero-head">
                  <p className="dash-kicker">{tr('Sur la carte', 'On the map')}</p>
                  <h1 className="dash-title">{layerInfo.label}</h1>
                  <p className="muted">{layerInfo.note}</p>
                  {layerPick}
                  <Spread data={data} layerKey={atlasKey(layer, profile)} isScore={layer === 'score'} block={block} />
                  {fresh ? (
                    <div className="dash-hero-figures">
                      <Figure value={fmt(open.length)} label={tr('places libres', 'free spots')} accent onClick={() => setView('arrondissements')} />
                      <Figure value={fmt(counts![profile])} label={tr('boutiques aujourd’hui', 'boutiques today')} onClick={() => setView('brands')} />
                    </div>
                  ) : (
                    <div className="dash-hero-figures">
                      <Brands data={data} profile={profile} limit={6} brand={brand} onBrand={setBrand} compact />
                      <Figure value={fmt(brand ? brandCount : counts![profile])} label={brand ? `${tr('boutiques', 'boutiques')} ${brand}` : tr('boutiques aujourd’hui', 'boutiques today')} onClick={() => setView('brands')} />
                    </div>
                  )}
                </div>
                <HeroMap
                  data={data}
                  profile={profile}
                  layer={layer}
                  cell={cell}
                  dots={fresh ? 'free' : 'boutiques'}
                  open={open}
                  zone={zone}
                  rings={rings}
                  minutes={walkMin}
                  focus={focus}
                  pin={found?.at ?? null}
                  brand={brand}
                  placed={placed}
                  borders={borders}
                  network={network}
                  onBlock={(c) => (c ? set({ cell: c }) : allParis())}
                  onAllParis={allParis}
                />
                <ZoneBar
                  data={data}
                  profile={profile}
                  bands={zones?.bands ?? [5, 10, 15, 20]}
                  minutes={walkMin}
                  onMinutes={setMinutes}
                  zone={block ? zone : null}
                  placed={placed}
                  stations={stationCells}
                  onMetric={setDetail}
                />
              </section>

              <section className="dash-card dash-why" aria-live="polite">
                {block ? (
                  <>
                    {found?.cell === block.cell && <p className="dash-kicker dash-found">{found.label}</p>}
                    <BlockHead block={block} profile={profile} />
                    <LayerStack grid={data.grid} cell={block} profile={profile} fill />
                    <div className="dash-why-foot">
                      <button className="dash-clear" onClick={allParis}>
                        {tr('← Tout Paris', '← All of Paris')}
                      </button>
                      <button className="dash-more" onClick={() => setView('block')}>
                        {tr('Tout sur ce bloc →', 'All about this block →')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="dash-kicker">{tr('Par où commencer', 'Where to start')}</p>
                    <h2 className="dash-title">{tr('Les places libres', 'The free spots')}</h2>
                    <p className="muted dash-start-note">
                      {tr('Les blocs au fort potentiel sans boutique de ce type autour. Choisissez-en un, ou cliquez la carte.', 'High-potential blocks with no boutique of this type around. Pick one, or click the map.')}
                    </p>
                    <Spots open={open} cell={cell} profile={profile} onBlock={(c) => set({ cell: c })} />
                  </>
                )}
              </section>
            </main>
          )}

          {section === 'overview' && open_ === 'block' && block && (
            <main className="dash-page detail view-block">
              <ViewHead kicker={tr('Le bloc en détail', 'The block in detail')} title={tr(`Un bloc du ${short(block)}`, `A block in the ${short(block)}`)} onClose={() => setView(null)} />
              <section className="dash-card dash-why">
                <BlockHead block={block} profile={profile} />
                <LayerStack grid={data.grid} cell={block} profile={profile} fill />
              </section>
              <section className="dash-card view-block-side">
                <Portrait
                  block={block}
                  open={open}
                  profile={profile}
                  layer={layer}
                  sorted={sorted}
                  onLayer={(id) => {
                    set({ layer: id })
                    setView(null)
                  }}
                  head={false}
                />
                <div className="dash-subcard">
                  <p className="dash-kicker">{tr('Ce qui fait la note du bloc', 'What makes the block’s score')}</p>
                  <Drivers data={data} profile={profile} block={block} />
                </div>
                <div className="dash-subcard">
                  <p className="dash-kicker">{tr('Le bloc pour chaque type de marque', 'The block for each type of brand')}</p>
                  <Profiles data={data} block={block} profile={profile} onProfile={(p) => set({ profile: p })} onBlock={(c) => set({ cell: c })} />
                </div>
              </section>
            </main>
          )}

          {section === 'overview' && open_ === 'arrondissements' && (
            <main className="dash-page detail">
              <ViewHead kicker={tr('Paris en 20 arrondissements', 'Paris in 20 arrondissements')} title={arr ?? tr('Où chercher', 'Where to look')} onClose={() => setView(null)} />
              <section className="dash-hero detail-map" aria-label={tr('Carte', 'Map')}>
                <HeroMap
                  data={data}
                  profile={profile}
                  layer="score"
                  cell={cell}
                  dots={fresh ? 'free' : 'boutiques'}
                  open={open}
                  zone={arrFocus}
                  rings={null}
                  minutes={walkMin}
                  focus={arrFocus}
                  pin={null}
                  brand={null}
                  placed={placed}
                  borders={borders}
                  network={network}
                  onBlock={(c) => (c ? set({ cell: c }) : setArr(null))}
                  onAllParis={() => setArr(null)}
                />
              </section>
              <section className="dash-card detail-side">
                <p className="muted view-note">
                  {tr('Potentiel moyen des blocs de chaque arrondissement. Cliquez une ligne : la carte s’y rapproche et montre son meilleur bloc.', 'Average potential of each arrondissement’s blocks. Click a row: the map closes in and shows its best block.')}
                </p>
                <p className="dash-rank-legend muted">
                  <span>
                    <span className="dash-rank-dot" aria-hidden="true" />
                    {tr('places libres', 'free spots')}
                  </span>
                  <span>
                    <span className="dash-rank-dot" style={{ background: profileColour(profile) }} aria-hidden="true" />
                    {tr('boutiques déjà là', 'boutiques already there')}
                  </span>
                </p>
                <ArrRanking
                  rows={arrondissements}
                  profile={profile}
                  chosen={arr}
                  onPick={(name, best) => {
                    setArr(name)
                    if (best) set({ cell: best })
                  }}
                />
                {arr && block && short(block) === arr && (
                  <button className="dash-more" onClick={() => setView(null)}>
                    {tr(`Voir le meilleur bloc du ${arr} →`, `See the best block in the ${arr} →`)}
                  </button>
                )}
              </section>
            </main>
          )}

          {section === 'overview' && open_ === 'brands' && (
            <main className="dash-page detail">
              <ViewHead
                kicker={tr('Les boutiques déjà là', 'The boutiques already there')}
                title={brand ? `${brand} · ${fmt(brandCount)}` : `${PROFILES.find((p) => p.id === profile)?.label} · ${fmt(counts![profile])}`}
                onClose={() => setView(null)}
              />
              <section className="dash-hero detail-map" aria-label={tr('Carte', 'Map')}>
                <HeroMap
                  data={data}
                  profile={profile}
                  layer={layer}
                  cell={cell}
                  dots="boutiques"
                  open={open}
                  zone={null}
                  rings={null}
                  minutes={walkMin}
                  focus={brandFocus}
                  pin={null}
                  brand={brand}
                  placed={placed}
                  borders={borders}
                  network={network}
                  onBlock={(c) => (c ? set({ cell: c }) : setBrand(null))}
                  onAllParis={() => setBrand(null)}
                />
              </section>
              <section className="dash-card detail-side">
                <p className="muted view-note">
                  {tr('Un point par boutique du catalogue. Cliquez une marque pour la voir seule sur la carte.', 'One dot per catalogue boutique. Click a brand to see it alone on the map.')}
                </p>
                <Brands data={data} profile={profile} brand={brand} onBrand={setBrand} />
              </section>
            </main>
          )}

          {section === 'method' && (
            <main className="dash-page dash-method-page">
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

/** The head of a view opened over the overview: back, what it is about, and its title. */
function ViewHead(props: { kicker: string; title: string; onClose: () => void }) {
  return (
    <header className="detail-head">
      <button className="detail-back" onClick={props.onClose}>
        {tr('← Retour', '← Back')}
      </button>
      <div className="view-title">
        <p className="dash-kicker">{props.kicker}</p>
        <h1 className="dash-title">{props.title}</h1>
      </div>
    </header>
  )
}

/** A number and what it counts; with `onClick`, a button that opens the number's own view. */
function Figure(props: { value: string; label: string; accent?: boolean; onClick?: () => void }) {
  const className = props.accent ? 'dash-figure accent' : 'dash-figure'
  const body = (
    <>
      <span className="dash-figure-value">{props.value}</span>
      <span className="dash-figure-label">{props.label}</span>
    </>
  )
  if (!props.onClick) return <p className={className}>{body}</p>
  return (
    <button className={`${className} opens`} onClick={props.onClick} title={tr('Voir le détail', 'See the detail')}>
      {body}
      <span className="dash-figure-open" aria-hidden="true">→</span>
    </button>
  )
}

/**
 * How the layer's values spread over Paris: a histogram whose bars take the map's colours, with
 * the chosen block marked. The long tail is folded into the last bar so the bulk stays readable.
 */
function Spread(props: { data: Data; layerKey: string; isScore: boolean; block: CellProps | null }) {
  const { data, layerKey, isScore, block } = props
  const bins = 28
  const spread = useMemo(() => {
    const values = data.grid.features
      .map((f) => f.properties[layerKey])
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b)
    const lo = isScore ? 0 : values[0] ?? 0
    const hi = isScore ? 100 : (values[Math.floor(values.length * 0.97)] ?? 1)
    const counts = Array.from({ length: bins }, () => 0)
    const at = (v: number) => Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo || 1)) * bins)))
    for (const v of values) counts[at(v)] += 1
    // each bar in the colour the map gives its middle value
    const shade = shadeOf(data.grid, layerKey, isScore)
    const colours = counts.map((_, i) => shade(lo + ((i + 0.5) * (hi - lo)) / bins))
    return { counts, colours, at, max: Math.max(...counts), total: values.length }
  }, [data, layerKey, isScore])
  const v = block ? block[layerKey] : undefined
  const mark = typeof v === 'number' ? spread.at(v) : null
  return (
    <figure className="dash-spread" aria-label={tr('Répartition des blocs de Paris', 'How the Paris blocks spread')}>
      <div className="dash-spread-bars">
        {spread.counts.map((n, i) => (
          <span
            key={i}
            className={i === mark ? 'on' : undefined}
            style={{ height: `${Math.max(3, (Math.sqrt(n) / Math.sqrt(spread.max || 1)) * 100)}%`, background: i === mark ? 'var(--ink)' : (spread.colours[i] ?? 'var(--quiet)') }}
            title={`${fmt(n)} ${tr('blocs', 'blocks')}`}
          />
        ))}
      </div>
      <figcaption className="muted">
        <span>{tr('faible', 'low')}</span>
        <span>{mark !== null ? (
            <>
              <span className="dash-spread-key" aria-hidden="true" /> {tr('le bloc choisi', 'the chosen block')}
            </>
          ) : (
            `${fmt(spread.total)} ${tr('blocs', 'blocks')}`
          )}</span>
        <span>{tr('fort', 'high')}</span>
      </figcaption>
    </figure>
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
  onClear?: () => void
  /** false where the block's name and verdict are already on screen */
  head?: boolean
}) {
  const { block, open, profile, layer, sorted, head = true } = props
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
      {!head && <p className="dash-kicker">{tr('Chaque couche face à Paris', 'Each layer against Paris')}</p>}
      {head && (
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
        </>
      )}
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
      {block && props.onClear && (
        <button className="dash-clear" onClick={props.onClear}>
          {tr('← Tout Paris', '← All of Paris')}
        </button>
      )}
    </>
  )
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

/** The brands of the type in the catalogue, by number of Paris boutiques (open data, no logos); a click shows one alone. */
function Brands(props: { data: Data; profile: ProfileId; limit?: number; brand: string | null; onBrand: (b: string | null) => void; compact?: boolean }) {
  const counts = new Map<string, number>()
  for (const f of props.data.stores.features) {
    if (f.properties.profile !== props.profile) continue
    counts.set(f.properties.brand, (counts.get(f.properties.brand) ?? 0) + 1)
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const top = ranked.slice(0, props.limit ?? ranked.length)
  // a brand picked further down the list stays in view
  const picked = ranked.find(([b]) => b === props.brand)
  if (picked && !top.includes(picked)) top.push(picked)
  const max = top[0]?.[1] ?? 1
  return (
    <>
      <ul className={props.compact ? 'dash-brands compact' : 'dash-brands'}>
        {top.map(([brand, n]) => (
          <li key={brand}>
            <button aria-pressed={props.brand === brand} onClick={() => props.onBrand(props.brand === brand ? null : brand)}>
              {props.compact && <span className="key-dot" style={{ background: profileColour(props.profile) }} aria-hidden="true" />}
              <span className="dash-brand-name">{brand}</span>
              {!props.compact && (
                <span className="dash-brand-track">
                  <span style={{ width: `${(n / max) * 100}%`, background: profileColour(props.profile) }} />
                </span>
              )}
              <span className="muted">{n}</span>
            </button>
          </li>
        ))}
      </ul>
      {!props.compact && (
        <p className="dash-note muted">
          {tr(`${counts.size} marques au total. Lieux : Overture Maps et OpenStreetMap.`, `${counts.size} brands in all. Places: Overture Maps and OpenStreetMap.`)}
        </p>
      )}
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
function ArrRanking(props: { rows: Map<string, ArrRow>; profile: ProfileId; chosen: string | null; onPick: (name: string, best: string | null) => void }) {
  const ramp = coloursOf(rampFor(scoreKey(props.profile)))
  const rows = [...props.rows]
    .map(([name, r]) => ({ name, ...r, mean: r.scores.length ? r.scores.reduce((a, b) => a + b, 0) / r.scores.length : 0 }))
    .sort((a, b) => b.mean - a.mean)
  return (
    <ol className="dash-ranking">
      {rows.map((r) => (
        <li key={r.name}>
          <button aria-current={props.chosen === r.name ? 'true' : undefined} onClick={() => props.onPick(r.name, r.best?.cell ?? null)}>
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


function WalkSwitch(props: { bands: number[]; minutes: number; onMinutes: (m: number) => void }) {
  return (
    <div className="dash-seg dash-walk" role="radiogroup" aria-label={tr('Zone à pied', 'Walking zone')}>
      {props.bands.map((m, i) => (
        <button key={m} role="radio" aria-checked={props.minutes === m} aria-pressed={props.minutes === m} onClick={() => props.onMinutes(m)}>
          <span className="dash-walk-key" style={{ borderColor: walkColour(i) }} aria-hidden="true" />
          {m} min
        </button>
      ))}
    </div>
  )
}

/** Under the big map: the walk around the chosen block, its length to choose, and what it holds in four numbers. */
function ZoneBar(props: {
  data: Data
  profile: ProfileId
  bands: number[]
  minutes: number
  onMinutes: (m: number) => void
  zone: Set<string> | null
  placed: Map<string, string>
  stations: Placed[]
  onMetric: (m: Metric) => void
}) {
  const { zone, onMetric } = props
  if (!zone)
    return (
      <div className="dash-zonebar idle">
        <p className="dash-kicker">{tr('Zone à pied', 'Walking zone')}</p>
        <p className="muted">{tr('Cliquez un bloc : sa zone à 5, 10, 15 ou 20 minutes à pied s’affiche sur la carte.', 'Click a block: its 5, 10, 15 or 20 minute walk shows on the map.')}</p>
      </div>
    )
  const z = zoneStats(props.data, props.profile, zone, props.placed, props.stations)
  return (
    <div className="dash-zonebar">
      <div className="dash-zonebar-head">
        <p className="dash-kicker">{tr('À pied, le long des rues', 'On foot, along the streets')}</p>
        <WalkSwitch bands={props.bands} minutes={props.minutes} onMinutes={props.onMinutes} />
      </div>
      <Figure value={fmt(z.free)} label={tr('places libres', 'free spots')} accent onClick={() => onMetric('free')} />
      <Figure value={fmt(z.boutiques)} label={tr('boutiques de ce type', 'boutiques of this type')} onClick={() => onMetric('boutiques')} />
      <Figure value={kilo(z.entries)} label={tr('entrées en gare / jour', 'station entries / day')} onClick={() => onMetric('stations')} />
      <Figure value={z.spendAvg === null ? '–' : `${fmt(z.spendAvg / 100, 1)}×`} label={tr('pouvoir d’achat vs Paris', 'spending vs Paris')} onClick={() => onMetric('spending')} />
    </div>
  )
}

