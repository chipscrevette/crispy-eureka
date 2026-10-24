import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type ExpressionSpecification, type StyleSpecification } from 'maplibre-gl'
import { PROFILES, countByProfile, loadStores, type ProfileId, type StoreProps, type Stores } from './stores'
import {
  formatValue,
  loadGrid,
  loadGridMeta,
  quantileBreaks,
  type CellProps,
  type FeatureInfo,
  type Grid,
  type GridMeta,
} from './grid'
import { SCORE_BREAKS, loadScores, ordinal, scoreKey, withScores, type Scores } from './scores'
import { CellScore, Compare } from './CellPanels'
import { cellIndex, centroid } from './geo'
import { readHash, writeHash } from './hash'
import Memo from './Memo'
import Method from './Method'
import Ask from './Ask'
import { loadAnswers, type AskAnswer } from './answers'
import { loadCatchments, reachOf, type Catchments } from './catchments'
import { demandLayers, loadDemand, withDemand } from './demand'

const PARIS: [number, number] = [2.3325, 48.8665]
const BASEMAP: string | StyleSpecification =
  import.meta.env.VITE_BASEMAP_STYLE === 'blank'
    ? {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'bg',
            type: 'background',
            paint: { 'background-color': '#E4E8E6' },
          },
        ],
      }
    : (import.meta.env.VITE_BASEMAP_STYLE ?? 'https://tiles.openfreemap.org/styles/positron')
const RAMP_OPACITY = [0.06, 0.2, 0.36, 0.54, 0.74]
const SCORE = 'score'

type Data = {
  stores: Stores
  grid: Grid
  meta: GridMeta
  scores: Scores
  catchments: Catchments
  demand: FeatureInfo[]
}
type Hover = { arrondissement?: string; value?: number }

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function rampOpacity(key: string, breaks: number[]): ExpressionSpecification {
  const steps = breaks.flatMap((b, i) => [b, RAMP_OPACITY[i + 1]])
  return ['case', ['has', key], ['step', ['get', key], RAMP_OPACITY[0], ...steps], 0]
}

export default function App() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const initial = useMemo(readHash, [])
  const [profile, setProfile] = useState<ProfileId>(initial.profile)
  const [layer, setLayer] = useState<string>(SCORE)
  const [selected, setSelected] = useState<StoreProps | null>(null)
  const [cellA, setCellA] = useState<string | null>(initial.a)
  const [cellB, setCellB] = useState<string | null>(initial.b)
  const [picking, setPicking] = useState(false)
  const [memo, setMemo] = useState(initial.memo)
  const [method, setMethod] = useState(initial.method)
  const [sheetOpen, setSheetOpen] = useState(true)
  const [ask, setAsk] = useState<string | null>(initial.ask)
  const [answers, setAnswers] = useState<AskAnswer[] | null>(null)
  const [answerCells, setAnswerCells] = useState<string[]>([])
  const pickingRef = useRef(picking)
  pickingRef.current = picking
  const [hover, setHover] = useState<Hover | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([loadStores(), loadGrid(), loadGridMeta(), loadScores(), loadCatchments(), loadDemand()]).then(
      ([stores, grid, meta, scores, catchments, demand]) =>
        setData({
          stores,
          grid: withDemand(withScores(grid, scores), demand),
          meta,
          scores,
          catchments,
          demand: demandLayers(demand),
        }),
      (e: Error) => setError(e.message),
    )
  }, [])

  useEffect(() => {
    if (!container.current || !data) return
    // a shared link opens on its block, not on the city centre
    const shared = initial.a ? data.grid.features.find((f) => f.properties.cell === initial.a) : undefined
    const m = new maplibregl.Map({
      container: container.current,
      style: BASEMAP,
      center: shared ? centroid(shared.geometry.coordinates[0]) : PARIS,
      zoom: 13.2,
      attributionControl: {
        compact: true,
        customAttribution:
          'Places and streets © Overture Maps Foundation, OpenStreetMap contributors · INSEE · DGFiP · Île-de-France Mobilités',
      },
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    m.on('load', () => {
      m.addSource('grid', { type: 'geojson', data: data.grid })
      m.addLayer({
        id: 'grid-fill',
        type: 'fill',
        source: 'grid',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': cssVar('--seine'),
          'fill-opacity': 0,
          'fill-outline-color': cssVar('--surface'),
        },
      })
      m.addLayer({
        id: 'grid-hit',
        type: 'fill',
        source: 'grid',
        paint: { 'fill-opacity': 0 },
      })
      m.addLayer({
        id: 'grid-catchment',
        type: 'fill',
        source: 'grid',
        filter: ['in', ['get', 'cell'], ['literal', []]],
        paint: { 'fill-color': cssVar('--ink'), 'fill-opacity': 0.14 },
      })
      m.addLayer({
        id: 'grid-answer',
        type: 'line',
        source: 'grid',
        filter: ['in', ['get', 'cell'], ['literal', []]],
        paint: { 'line-color': cssVar('--ink'), 'line-width': 1.5 },
      })
      m.addLayer({
        id: 'grid-selected',
        type: 'line',
        source: 'grid',
        filter: ['==', ['get', 'cell'], ''],
        paint: { 'line-color': cssVar('--brass'), 'line-width': 2.5 },
      })
      m.addLayer({
        id: 'grid-compare',
        type: 'line',
        source: 'grid',
        filter: ['==', ['get', 'cell'], ''],
        paint: { 'line-color': cssVar('--ink'), 'line-width': 2.5, 'line-dasharray': [2, 1] },
      })
      m.addSource('stores', {
        type: 'geojson',
        data: data.stores,
        promoteId: 'id',
      })
      m.addLayer({
        id: 'stores-context',
        type: 'circle',
        source: 'stores',
        paint: {
          'circle-radius': 3,
          'circle-color': cssVar('--muted'),
          'circle-opacity': 0.35,
        },
      })
      m.addLayer({
        id: 'stores-profile',
        type: 'circle',
        source: 'stores',
        filter: ['==', ['get', 'profile'], 'jewellery-watches'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 8],
          'circle-color': cssVar('--seine'),
          'circle-stroke-color': cssVar('--surface'),
          'circle-stroke-width': 1.5,
        },
      })
      m.addLayer({
        id: 'stores-selected',
        type: 'circle',
        source: 'stores',
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 16, 12],
          'circle-color': cssVar('--brass'),
          'circle-stroke-color': cssVar('--surface'),
          'circle-stroke-width': 2,
        },
      })
      m.on('click', (e) => {
        const store = m.queryRenderedFeatures(e.point, {
          layers: ['stores-profile'],
        })[0]
        const block = m.queryRenderedFeatures(e.point, {
          layers: ['grid-hit'],
        })[0]
        const id = block ? (block.properties as CellProps).cell : null
        if (pickingRef.current) {
          if (id) setCellB(id)
          setPicking(false)
          return
        }
        setSelected(store ? (store.properties as StoreProps) : null)
        setCellA(id)
        setCellB(null)
        if (id) setSheetOpen(true)
      })
      m.on('mouseenter', 'stores-profile', () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', 'stores-profile', () => (m.getCanvas().style.cursor = ''))
      setReady(true)
    })
    return () => {
      setReady(false)
      m.remove()
    }
  }, [data, initial.a])

  useEffect(() => {
    if (ready) map.current!.setFilter('stores-profile', ['==', ['get', 'profile'], profile])
  }, [ready, profile])

  useEffect(() => {
    if (ready) map.current!.setFilter('stores-selected', ['==', ['get', 'id'], selected?.id ?? ''])
  }, [ready, selected])

  useEffect(() => {
    if (!ready) return
    map.current!.setFilter('grid-selected', ['==', ['get', 'cell'], cellA ?? ''])
    map.current!.setFilter('grid-compare', ['==', ['get', 'cell'], cellB ?? ''])
    const reach = cellA && !cellB && data ? reachOf(data.catchments, cellA) : []
    map.current!.setFilter('grid-catchment', ['in', ['get', 'cell'], ['literal', reach]])
  }, [ready, cellA, cellB, data])

  useEffect(() => {
    if (ready) map.current!.setFilter('grid-answer', ['in', ['get', 'cell'], ['literal', answerCells]])
  }, [ready, answerCells])

  useEffect(() => {
    if (ask === null || answers) return
    loadAnswers().then(setAnswers, (e: Error) => setError(e.message))
  }, [ask, answers])

  useEffect(
    () => writeHash({ profile, a: cellA, b: cellB, memo, method, ask }),
    [profile, cellA, cellB, memo, method, ask],
  )

  const cells = useMemo(() => (data ? cellIndex(data.grid) : null), [data])
  const a = (cellA && cells?.get(cellA)?.properties) || null
  const b = (cellB && cells?.get(cellB)?.properties) || null
  const closeMemo = useCallback(() => setMemo(false), [])
  const closeMethod = useCallback(() => setMethod(false), [])
  const closeAsk = useCallback(() => setAsk(null), [])
  const onAsked = useCallback((id: string) => setAsk(id), [])

  const showAnswer = (ans: AskAnswer, withMemo = false) => {
    if (ans.profile) setProfile(ans.profile)
    setLayer(SCORE)
    setSelected(null)
    setPicking(false)
    setCellA(ans.cells[0] ?? null)
    setCellB(ans.compare ? (ans.cells[1] ?? null) : null)
    setAnswerCells(ans.cells)
    setSheetOpen(true)
    setMemo(withMemo)
    const points = ans.cells.flatMap((c) => {
      const f = cells?.get(c)
      return f ? [centroid(f.geometry.coordinates[0])] : []
    })
    if (points.length && map.current) {
      const bounds = points.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(points[0], points[0]))
      const phone = window.matchMedia('(max-width: 600px)').matches
      map.current.fitBounds(bounds, {
        maxZoom: 15,
        padding: phone ? { top: 60, bottom: 320, left: 40, right: 40 } : { top: 80, bottom: 80, left: 400, right: 470 },
      })
    }
    // on a phone the drawer covers the map, so step aside; a shared link still reopens it
    if (window.matchMedia('(max-width: 600px)').matches) setAsk(null)
  }

  const isScore = layer === SCORE
  const key = isScore ? scoreKey(profile) : layer
  const breaks = useMemo(
    () => (isScore ? SCORE_BREAKS : data && key ? quantileBreaks(data.grid, key) : []),
    [data, key, isScore],
  )
  const info = isScore
    ? undefined
    : [...(data?.meta.features ?? []), ...(data?.demand ?? [])].find((f) => f.key === layer)

  useEffect(() => {
    if (!ready) return
    const m = map.current!
    m.setLayoutProperty('grid-fill', 'visibility', key ? 'visible' : 'none')
    if (!key) return
    m.setPaintProperty('grid-fill', 'fill-opacity', rampOpacity(key, breaks))
    const onMove = (e: maplibregl.MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties
      setHover(p ? { arrondissement: p.arrondissement, value: p[key] } : null)
    }
    const onLeave = () => setHover(null)
    m.on('mousemove', 'grid-fill', onMove)
    m.on('mouseleave', 'grid-fill', onLeave)
    return () => {
      m.off('mousemove', 'grid-fill', onMove)
      m.off('mouseleave', 'grid-fill', onLeave)
      setHover(null)
    }
  }, [ready, key, breaks])

  const counts = useMemo(() => (data ? countByProfile(data.stores) : null), [data])
  const brands = useMemo(
    () =>
      data
        ? new Set(data.stores.features.filter((f) => f.properties.profile === profile).map((f) => f.properties.brand))
            .size
        : 0,
    [data, profile],
  )

  const validation = data?.scores.validation[profile]
  const hoverText = (unit: string) =>
    hover?.value !== undefined
      ? `${hover.arrondissement ?? 'Paris'}: ${isScore ? `${Math.round(hover.value)} / 100` : formatValue(hover.value, unit)}`
      : hover
        ? `${hover.arrondissement ?? 'Paris'}: no data`
        : 'Hover or tap a block to read its value.'

  return (
    <div className={`app${ask !== null ? ' asking' : ''}`}>
      <div ref={container} className="map" aria-label="Map of luxury boutiques in Paris" role="region" />

      <aside id="panel" className={`panel${sheetOpen ? '' : ' collapsed'}${a ? ' has-selection' : ''}`}>
        <button
          className="handle"
          aria-expanded={sheetOpen}
          aria-controls="panel"
          onClick={() => setSheetOpen((x) => !x)}
        >
          <span className="visually-hidden">{sheetOpen ? 'Hide details' : 'Show details'}</span>
        </button>
        <header>
          <h1>Adresse</h1>
          <p className="tagline">Where should a luxury brand open its next Paris boutique, and why?</p>
          <div className="header-links">
            <button className="button ask-open" onClick={() => setAsk('1')} disabled={!data}>
              Ask Adresse
            </button>
            <button className="link method-link" onClick={() => setMethod(true)} disabled={!data}>
              How it works
            </button>
          </div>
        </header>

        <section aria-labelledby="profile-label">
          <h2 id="profile-label" className="label">
            Brand profile
          </h2>
          <div className="chips" role="radiogroup" aria-labelledby="profile-label">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                id={`profile-${p.id}`}
                role="radio"
                aria-checked={profile === p.id}
                className="chip"
                onClick={() => {
                  setProfile(p.id)
                  setSelected(null)
                }}
              >
                <span>{p.label}</span>
                <span className="count">{counts ? counts[p.id] : '–'}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="stat">
          {error ? (
            <p className="error">{error}</p>
          ) : (
            <>
              <span className="big">{counts ? counts[profile] : '–'}</span>
              <span className="muted">
                existing boutiques from {brands} brands. Every block of Paris is scored by how closely it resembles
                where they chose to be.
              </span>
            </>
          )}
        </section>

        <section className="layers">
          <label htmlFor="layer" className="label">
            Map colour
          </label>
          <select id="layer" value={layer} onChange={(e) => setLayer(e.target.value)} disabled={!data}>
            <option value={SCORE}>Opportunity score</option>
            <option value="">None</option>
            <optgroup label="Spending demand">
              {data?.demand.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Neighbourhood data">
              {data?.meta.features.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          </select>
          {(isScore || info) && breaks.length > 0 && (
            <div className="legend">
              <div className="ramp" aria-hidden="true">
                {RAMP_OPACITY.slice(0, breaks.length + 1).map((o) => (
                  <span key={o} style={{ opacity: o + 0.1 }} />
                ))}
              </div>
              <div className="ramp-labels">
                {isScore ? (
                  <>
                    <span>Bottom half</span>
                    <span>Top 5%</span>
                  </>
                ) : (
                  <>
                    <span>Lower</span>
                    <span>Higher</span>
                  </>
                )}
              </div>
              {isScore && validation ? (
                <p className="muted small">
                  Tested on brands the model never saw: their boutiques landed at the{' '}
                  {ordinal(validation.model.mean_percentile)} percentile on average. Following other luxury boutiques
                  alone gives the {ordinal(validation['luxury neighbours'].mean_percentile)}.
                </p>
              ) : (
                info && (
                  <p className="muted small">
                    {info.description}. Source: {info.source}.
                  </p>
                )
              )}
              <p className="hover" aria-live="polite">
                {hoverText(info?.unit ?? '')}
              </p>
            </div>
          )}
        </section>

        {(selected || a) && data && (
          <section className="selected" aria-live="polite">
            <h2 className="label">{b ? 'Block A' : 'Selected'}</h2>
            {selected && (
              <>
                <p className="brand">{selected.brand}</p>
                <p className="muted">{selected.segment}</p>
                {selected.osm_confirmed !== undefined && (
                  <p className="muted small">
                    {selected.osm_confirmed
                      ? 'Also mapped in OpenStreetMap within 75 m.'
                      : 'Not found in OpenStreetMap. Treat this location with care.'}
                  </p>
                )}
              </>
            )}
            {a && !b && (
              <CellScore
                cell={a}
                walk={{ minutes: data.catchments.minutes, blocks: reachOf(data.catchments, a.cell).length }}
                profile={profile}
                scores={data.scores}
                picking={picking}
                onCompare={() => setPicking((x) => !x)}
                onMemo={() => setMemo(true)}
              />
            )}
            {a && b && (
              <Compare
                a={a}
                b={b}
                profile={profile}
                scores={data.scores}
                onMemo={() => setMemo(true)}
                onClear={() => setCellB(null)}
              />
            )}
            <button
              className="link"
              onClick={() => {
                setSelected(null)
                setCellA(null)
                setCellB(null)
                setPicking(false)
                setAnswerCells([])
              }}
            >
              Clear selection
            </button>
          </section>
        )}

        <footer className="muted small">Week 6 preview. Data: {data?.meta.sources.join(' · ') ?? 'loading'}.</footer>
      </aside>

      {ask !== null && data && answers && (
        <Ask
          answers={answers}
          first={ask}
          onAsked={onAsked}
          onShow={(a) => showAnswer(a)}
          onMemo={(a) => showAnswer(a, true)}
          onMethod={() => setMethod(true)}
          onClose={closeAsk}
        />
      )}

      {method && data && (
        <Method
          scores={data.scores}
          stores={data.stores}
          meta={data.meta}
          cells={data.grid.features.length}
          onClose={closeMethod}
        />
      )}

      {memo && a && data && (
        <Memo
          cell={a}
          profile={profile}
          grid={data.grid}
          stores={data.stores}
          scores={data.scores}
          meta={data.meta}
          onClose={closeMemo}
        />
      )}
    </div>
  )
}
