import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import { PROFILES, countByProfile, loadStores, type ProfileId, type StoreProps, type Stores } from './stores'

const PARIS: [number, number] = [2.3325, 48.8665]
const BASEMAP: string | StyleSpecification =
  import.meta.env.VITE_BASEMAP_STYLE === 'blank'
    ? { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#E4E8E6' } }] }
    : (import.meta.env.VITE_BASEMAP_STYLE ?? 'https://tiles.openfreemap.org/styles/positron')

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export default function App() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [stores, setStores] = useState<Stores | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileId>('jewellery-watches')
  const [selected, setSelected] = useState<StoreProps | null>(null)

  useEffect(() => {
    loadStores().then(setStores, (e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!container.current || !stores) return
    const m = new maplibregl.Map({
      container: container.current,
      style: BASEMAP,
      center: PARIS,
      zoom: 13.2,
      attributionControl: { compact: true, customAttribution: 'Places © Overture Maps Foundation' },
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    m.on('load', () => {
      m.addSource('stores', { type: 'geojson', data: stores, promoteId: 'id' })
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
    })
    return () => m.remove()
  }, [stores])

  useEffect(() => {
    const m = map.current
    if (!m?.getLayer('stores-profile')) return
    m.setFilter('stores-profile', ['==', ['get', 'profile'], profile])
  }, [profile])

  useEffect(() => {
    const m = map.current
    if (!m?.getLayer('stores-selected')) return
    m.setFilter('stores-selected', ['==', ['get', 'id'], selected?.id ?? ''])
  }, [selected])

  const counts = useMemo(() => (stores ? countByProfile(stores) : null), [stores])
  const brands = useMemo(
    () =>
      stores
        ? new Set(stores.features.filter((f) => f.properties.profile === profile).map((f) => f.properties.brand)).size
        : 0,
    [stores, profile],
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
          Week 0 preview. Opportunity scores arrive in Week 3. Data: {stores?.metadata.source ?? 'Overture Maps'}.
        </footer>
      </aside>
    </div>
  )
}
