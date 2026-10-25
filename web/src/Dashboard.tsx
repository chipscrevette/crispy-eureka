import { useEffect, useMemo, useRef, useState } from 'react'
import { loadData, type Data } from './appData'
import { ATLAS, atlasKey } from './atlasLayers'
import { OPEN_RULE, openKey } from './dashboardData'
import { cellAt, cellIndex } from './geo'
import { formatValue, type CellProps } from './grid'
import { fmt, lang, switchLang, tr } from './i18n'
import { coloursOf, isDark, rampFor } from './palette'
import { placeOf, rankText, scoreKey } from './scores'
import { PROFILES, countByProfile, type ProfileId } from './stores'
import { connect, sameShared, type Shared } from './sync'

/** "Paris 8e Arrondissement" → "8e". */
const short = (p: CellProps) => placeOf(p).replace(/^Paris /, '').replace(/ Arrondissement$/, '')
const num = (p: CellProps, k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null)

const SHORT: Record<ProfileId, string> = {
  'jewellery-watches': tr('Joaillerie', 'Jewellery'),
  'fashion-house': tr('Mode', 'Fashion'),
  beauty: tr('Beauté', 'Beauty'),
}

/** Columns of the free-spot table: the reasons a block stands out, beside its potential. */
const COLUMNS = [
  { key: 'demand', label: tr('Pouvoir d’achat', 'Spending') },
  { key: 'street_footfall', label: tr('Passage', 'Footfall') },
  { key: 'transit_entries_r2', label: tr('Gares, entrées / jour', 'Stations, entries / day') },
  { key: 'commercial_price_m2', label: tr('Prix boutique / m²', 'Shop price / m²') },
]

function switchTheme() {
  try {
    localStorage.setItem('adresse-theme', isDark() ? 'light' : 'dark')
  } catch {
    return
  }
  window.location.reload()
}

/** Share of scored blocks with a lower value, 0 to 100: where a block stands in Paris on one layer. */
function usePercentiles(data: Data | null, profile: ProfileId) {
  return useMemo(() => {
    const out = new Map<string, number[]>()
    if (!data) return out
    for (const l of ATLAS) {
      const key = atlasKey(l.id, profile)
      out.set(
        key,
        data.grid.features
          .map((f) => num(f.properties, key))
          .filter((v): v is number => v !== null)
          .sort((a, b) => a - b),
      )
    }
    return out
  }, [data, profile])
}

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
  const [shared, setShared] = useState<Shared>({ profile: 'jewellery-watches', layer: 'score', cell: null })
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
  const { profile, layer, cell } = shared
  const key = scoreKey(profile)
  const pct = usePercentiles(data, profile)
  const cells = useMemo(() => (data ? cellIndex(data.grid) : null), [data])
  const block = (cell && cells?.get(cell)?.properties) || null

  // units of each layer, from the pipeline's feature list
  const units = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of [...(data?.meta.features ?? []), ...(data?.demand ?? [])]) m.set(f.key, f.unit)
    return m
  }, [data])
  const show = (k: string, v: number | null) => {
    if (v === null) return '–'
    if (k.startsWith('score')) return `${Math.round(v)}`
    if (k === 'demand') return fmt(v)
    if (k === 'street_footfall') return `${fmt(v, 1)} ×`
    if (k === 'commercial_price_m2' || k === 'transit_entries_r2') return fmt(v)
    const unit = units.get(k)
    return unit ? formatValue(v, unit) : fmt(v)
  }

  const open = useMemo(
    () =>
      data
        ? data.grid.features
            .map((f) => f.properties)
            .filter((p) => p[openKey(key)] === 1)
            .sort((a, b) => (num(b, key) ?? 0) - (num(a, key) ?? 0))
        : [],
    [data, key],
  )

  // each boutique of the profile placed in its block, then counted by arrondissement
  const arrondissements = useMemo(() => {
    if (!data || !cells) return []
    const rows = new Map<string, { name: string; scores: number[]; open: number; boutiques: number; best: CellProps | null }>()
    const row = (name: string) => {
      if (!rows.has(name)) rows.set(name, { name, scores: [], open: 0, boutiques: 0, best: null })
      return rows.get(name)!
    }
    for (const f of data.grid.features) {
      const p = f.properties
      if (!p.arrondissement) continue
      const r = row(short(p))
      const s = num(p, key)
      if (s === null) continue
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
    return [...rows.values()]
      .filter((r) => r.scores.length)
      .map((r) => ({ ...r, mean: r.scores.reduce((a, b) => a + b, 0) / r.scores.length }))
      .sort((a, b) => b.mean - a.mean)
  }, [data, cells, key, profile])

  // per tenth of the potential scale: how many blocks already have a boutique of the type in or next to them
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
  const scored = data ? data.grid.features.filter((f) => num(f.properties, key) !== null).length : 0
  const blockScore = block ? num(block, key) : null
  const scoreRamp = coloursOf(rampFor(key))
  const selectedArr = block ? short(block) : null
  const maxMean = Math.max(1, ...arrondissements.map((r) => r.mean))

  return (
    <div className="dash">
      <header className="dash-head">
        <p className="wordmark">
          <span className="wordmark-dot" aria-hidden="true" />
          Adresse <span className="dash-sub">{tr('Tableau de bord', 'Dashboard')}</span>
        </p>
        <div className="profiles dash-profiles" role="radiogroup" aria-label={tr('Type de marque', 'Type of brand')}>
          {PROFILES.map((p) => (
            <button key={p.id} role="radio" aria-checked={profile === p.id} onClick={() => set({ profile: p.id })}>
              {SHORT[p.id]}
              {counts && <span className="profile-count">{counts[p.id]}</span>}
            </button>
          ))}
        </div>
        <p className="dash-link" role="status">
          <span className={linked ? 'dash-live on' : 'dash-live'} aria-hidden="true" />
          {linked ? (
            tr('Lié à la carte', 'Linked to the map')
          ) : (
            <a href="./" target="_blank" rel="noreferrer">
              {tr('Ouvrir la carte pour la lier', 'Open the map to link it')}
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
        <main className="dash-grid">
          <section className="dash-kpis" aria-label={tr('Chiffres clés', 'Key figures')}>
            <Kpi value={fmt(open.length)} label={tr('places libres', 'free spots')} accent />
            <Kpi value={fmt(counts![profile])} label={tr('boutiques aujourd’hui', 'boutiques today')} />
            <Kpi value={fmt(scored)} label={tr('blocs notés', 'blocks scored')} />
            <Kpi
              value={blockScore === null ? '–' : `${Math.round(blockScore)}`}
              unit={blockScore === null ? undefined : '/ 100'}
              label={block ? `${tr('potentiel du bloc', 'block potential')} · ${short(block)}` : tr('aucun bloc choisi', 'no block chosen')}
            />
          </section>

          <section className="dash-card dash-spots">
            <h2 className="dash-kicker">
              {tr('Places libres, de la meilleure à la moins bonne', 'Free spots, best first')}
              <span className="dash-hint">{tr('Cliquez une ligne : la carte y va', 'Click a row: the map goes there')}</span>
            </h2>
            <table className="dash-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{tr('Lieu', 'Place')}</th>
                  <th scope="col">{tr('Potentiel', 'Potential')}</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className="num">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open.map((p, i) => {
                  const s = num(p, key) ?? 0
                  return (
                    <tr
                      key={p.cell}
                      aria-selected={p.cell === cell}
                      tabIndex={0}
                      onClick={() => set({ cell: p.cell })}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && set({ cell: p.cell })}
                    >
                      <td className="muted">{i + 1}</td>
                      <td>{short(p)}</td>
                      <td>
                        <span className="dash-bar">
                          <span style={{ width: `${s}%`, background: scoreRamp[3] }} />
                        </span>
                        <span className="dash-bar-value">{Math.round(s)}</span>
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="num">
                          {show(c.key, num(p, c.key))}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!open.length && <p className="muted">{tr('Aucune place libre pour ce type de marque.', 'No free spot for this type of brand.')}</p>}
          </section>

          <section className="dash-card dash-block" aria-live="polite">
            <h2 className="dash-kicker">{tr('Le bloc choisi face à Paris', 'The chosen block against Paris')}</h2>
            {block ? (
              <>
                <p className="dash-block-head">
                  <span className="dash-block-place">{short(block)}</span>
                  <span className="muted">
                    {blockScore === null ? tr('pas de note', 'no score') : `${tr('Le potentiel', 'Its potential')} ${rankText(blockScore)}.`}
                  </span>
                </p>
                <ul className="dash-layers">
                  {ATLAS.map((l) => {
                    const k = atlasKey(l.id, profile)
                    const v = num(block, k)
                    const at = v === null ? 0 : percentile(pct.get(k), v)
                    return (
                      <li key={l.id}>
                        <button aria-pressed={layer === l.id} onClick={() => set({ layer: l.id })} title={tr('Afficher sur la carte', 'Show on the map')}>
                          <span className="dash-layer-name">{l.label}</span>
                          <span className="dash-bar">
                            <span style={{ width: `${at}%`, background: coloursOf(rampFor(k))[3] }} />
                          </span>
                          <span className="dash-layer-value">{show(k, v)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className="dash-note muted">
                  {tr(
                    'Barre : part des blocs de Paris en dessous. Cliquez une ligne pour afficher la couche sur la carte.',
                    'Bar: share of Paris blocks below. Click a row to show the layer on the map.',
                  )}
                </p>
                <button className="dash-clear" onClick={() => set({ cell: null })}>
                  {tr('← Tout Paris', '← All of Paris')}
                </button>
              </>
            ) : (
              <p className="muted">{tr('Cliquez un bloc sur la carte, ou une ligne du tableau.', 'Click a block on the map, or a row of the table.')}</p>
            )}
          </section>

          <section className="dash-card dash-arr">
            <h2 className="dash-kicker">
              {tr('Les 20 arrondissements, par potentiel moyen', 'The 20 arrondissements, by average potential')}
              <span className="dash-hint">{tr('Cliquez : la carte va au meilleur bloc', 'Click: the map goes to the best block')}</span>
            </h2>
            <div className="dash-arr-head muted" aria-hidden="true">
              <span />
              <span />
              <span className="num">{tr('places libres', 'free spots')}</span>
              <span className="num">{tr('boutiques', 'boutiques')}</span>
            </div>
            <ol className="dash-arr-list">
              {arrondissements.map((r) => (
                <li key={r.name}>
                  <button aria-current={r.name === selectedArr ? 'true' : undefined} onClick={() => r.best && set({ cell: r.best.cell })}>
                    <span className="dash-arr-name">{r.name}</span>
                    <span className="dash-arr-track">
                      <span
                        style={{ width: `${(r.mean / maxMean) * 100}%`, background: r.name === selectedArr ? scoreRamp[4] : scoreRamp[2] }}
                      />
                      <span className="dash-arr-mean">{Math.round(r.mean)}</span>
                    </span>
                    <span className="num">{r.open || '–'}</span>
                    <span className="num">{r.boutiques || '–'}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="dash-card dash-hist">
            <h2 className="dash-kicker">{tr('Le luxe est déjà là où le potentiel est haut', 'Luxury is already where potential is high')}</h2>
            <Tenths bins={tenths} mark={blockScore} colour={scoreRamp[3]} />
            <p className="dash-note muted">
              {tr(
                `Part des blocs qui ont déjà une boutique de ce type, dans le bloc ou juste à côté, par tranche de potentiel. Le potentiel est un rang : 50 est la moitié de Paris. Les places libres partent de ${OPEN_RULE.score}.`,
                `Share of blocks that already have a boutique of this type, in the block or next to it, by band of potential. Potential is a rank: 50 is the middle of Paris. Free spots start at ${OPEN_RULE.score}.`,
              )}
            </p>
          </section>
        </main>
      )}
      <footer className="dash-foot muted">
        {tr(
          'Données ouvertes : Overture Maps, OpenStreetMap, INSEE, DGFiP, Île-de-France Mobilités, Atout France, Apur. Chaque chiffre vient des scripts du dépôt.',
          'Open data: Overture Maps, OpenStreetMap, INSEE, DGFiP, Île-de-France Mobilités, Atout France, Apur. Every number comes from the repository’s scripts.',
        )}
      </footer>
    </div>
  )
}

function Kpi(props: { value: string; unit?: string; label: string; accent?: boolean }) {
  return (
    <p className={props.accent ? 'dash-kpi accent' : 'dash-kpi'}>
      <span className="dash-kpi-value">
        {props.value}
        {props.unit && <span className="dash-kpi-unit"> {props.unit}</span>}
      </span>
      <span className="dash-kpi-label">{props.label}</span>
    </p>
  )
}

/** One column per tenth of potential, as high as the share of its blocks with luxury already; the chosen block's tenth in ink. */
function Tenths(props: { bins: { blocks: number; taken: number }[]; mark: number | null; colour: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const markBin = props.mark === null ? null : Math.min(9, Math.floor(props.mark / 10))
  const share = (b: { blocks: number; taken: number }) => (b.blocks ? b.taken / b.blocks : 0)
  const max = Math.max(0.01, ...props.bins.map(share))
  const pc = lang() === 'fr' ? ' %' : '%'
  return (
    <div className="dash-histogram" onMouseLeave={() => setHover(null)}>
      {props.bins.map((b, i) => (
        <div key={i} className="dash-col" onMouseEnter={() => setHover(i)}>
          {hover === i && (
            <span className="dash-col-tip">
              {Math.round(share(b) * 100)}
              {pc} · {fmt(b.taken)} / {fmt(b.blocks)} {tr('blocs', 'blocks')}
            </span>
          )}
          {(i === 9 || i === markBin) && hover === null && (
            <span className="dash-col-value">
              {Math.round(share(b) * 100)}
              {pc}
            </span>
          )}
          <span
            className="dash-col-bar"
            style={{ height: `${(share(b) / max) * 100}%`, background: i === markBin ? 'var(--ink)' : props.colour }}
          />
          <span className="dash-col-label">{i * 10}</span>
        </div>
      ))}
    </div>
  )
}
