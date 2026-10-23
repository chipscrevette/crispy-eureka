import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type ExpressionSpecification, type StyleSpecification } from 'maplibre-gl'
import { PROFILES, countByProfile, loadStores, type ProfileId, type StoreProps, type Stores } from './stores'
import { formatValue, loadGrid, loadGridMeta, quantileBreaks, type Grid, type GridMeta } from './grid'

const PARIS: [number, number] = [2.3325, 48.8665]
const BASEMAP: string | StyleSpecification =
  import.meta.env.VITE_BASEMAP_STYLE === 'blank'
    ? { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#E4E8E6' } }] }
    : (import.meta.env.VITE_BASEMAP_STYLE ?? 'https://tiles.openfreemap.org/styles/positron')
const RAMP_OPACITY = [0.06, 0.2, 0.36, 0.54, 0.74]

type Data = { stores: Stores; grid: Grid; meta: GridMeta }
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
  const [profile, setProfile] = useState<ProfileId>('jewellery-watches')
  const [layer, setLayer] = useState<string>('')
  const [selected, setSelected] = useState<StoreProps | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([loadStores(), loadGrid(), loadGridMeta()]).then(
      ([stores, grid, meta]) => setData({ stores, grid, meta }),
      (e: Error) => setError(e.message),
    )
  }, [])

  useEffect(() => {
    if (!container.current || !data) return
    const m = new maplibregl.Map({
      container: container.current,
      style: BASEMAP,
      center: PARIS,
      zoom: 13.2,
      attributionControl: { compact: true, customAttribution: 'Places © Overture Maps Foundation · INSEE · DGFiP' },
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
        paint: { 'fill-color': cssVar('--seine'), 'fill-opacity': 0, 'fill-outline-color': cssVar('--surface') },
      })
      m.addSource('stores', { type: 'geojson', data: data.stores, promoteId: 'id' })
      m.addLayer({
        id: 'stores-context',
        type: 'circle',
        source: 'stores',
        paint: { 'circle-radius': 3, 'circle-color': cssVar('--muted'), 'circle-opacity': 0.35 },
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
      m.on('click', 'stores-profile', (e) => {
        const f = e.features?.[0]
        if (f) setSelected(f.properties as StoreProps)
      })
      m.on('mouseenter', 'stores-profile', () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', 'stores-profile', () => (m.getCanvas().style.cursor = ''))
      setReady(true)
    })
    return () => {
      setReady(false)
      m.remove()
    }
  }, [data])

  useEffect(() => {
    if (ready) map.current!.setFilter('stores-profile', ['==', ['get', 'profile'], profile])
  }, [ready, profile])

  useEffect(() => {
    if (ready) map.current!.setFilter('stores-selected', ['==', ['get', 'id'], selected?.id ?? ''])
  }, [ready, selected])

  const breaks = useMemo(() => (data && layer ? quantileBreaks(data.grid, layer) : []), [data, layer])
  const info = data?.meta.features.find((f) => f.key === layer)

  useEffect(() => {
    if (!ready) return
    const m = map.current!
    m.setLayoutProperty('grid-fill', 'visibility', layer ? 'visible' : 'none')
    if (!layer) return
    m.setPaintProperty('grid-fill', 'fill-opacity', rampOpacity(layer, breaks))
    const onMove = (e: maplibregl.MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties
      setHover(p ? { arrondissement: p.arrondissement, value: p[layer] } : null)
    }
    const onLeave = () => setHover(null)
    m.on('mousemove', 'grid-fill', onMove)
    m.on('click', 'grid-fill', onMove)
    m.on('mouseleave', 'grid-fill', onLeave)
    return () => {
      m.off('mousemove', 'grid-fill', onMove)
      m.off('click', 'grid-fill', onMove)
      m.off('mouseleave', 'grid-fill', onLeave)
      setHover(null)
    }
  }, [ready, layer, breaks])

  const counts = useMemo(() => (data ? countByProfile(data.stores) : null), [data])
  const brands = useMemo(
    () =>
      data
        ? new Set(data.stores.features.filter((f) => f.properties.profile === profile).map((f) => f.properties.brand))
            .size
        : 0,
    [data, profile],
  )

  return (
    <div className="app">
      <div ref={container} className="map" aria-label="Map of luxury boutiques in Paris" role="region" />

      <aside className="panel">
        <header>
          <h1>Adresse</h1>
          <p className="tagline">Where should a luxury brand open its next Paris boutique, and why?</p>
        </header>

        <section aria-labelledby="profile-label">
          <h2 id="profile-label" className="label">Brand profile</h2>
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
                existing boutiques from {brands} brands. The model will learn from where they chose to be.
              </span>
            </>
          )}
        </section>

        <section className="layers">
          <label htmlFor="layer" className="label">
            Neighbourhood data
          </label>
          <select id="layer" value={layer} onChange={(e) => setLayer(e.target.value)} disabled={!data}>
            <option value="">None</option>
            {data?.meta.features.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          {info && breaks.length > 0 && (
            <div className="legend">
              <div className="ramp" aria-hidden="true">
                {RAMP_OPACITY.slice(0, breaks.length + 1).map((o) => (
                  <span key={o} style={{ opacity: o + 0.1 }} />
                ))}
              </div>
              <div className="ramp-labels">
                <span>Lower</span>
                <span>Higher</span>
              </div>
              <p className="muted small">
                {info.description}. Source: {info.source}.
              </p>
              <p className="hover" aria-live="polite">
                {hover?.value !== undefined
                  ? `${hover.arrondissement ?? 'Paris'}: ${formatValue(hover.value, info.unit)}`
                  : hover
                    ? `${hover.arrondissement ?? 'Paris'}: no data`
                    : 'Hover or tap a block to read its value.'}
              </p>
            </div>
          )}
        </section>

        {selected && (
          <section className="selected" aria-live="polite">
            <h2 className="label">Selected</h2>
            <p className="brand">{selected.brand}</p>
            <p className="muted">{selected.segment}</p>
            <button className="link" onClick={() => setSelected(null)}>
              Clear selection
            </button>
          </section>
        )}

        <footer className="muted small">
          Week 1 preview. Opportunity scores arrive in Week 3. Data: {data?.meta.sources.join(' · ') ?? 'loading'}.
        </footer>
      </aside>
    </div>
  )
}
