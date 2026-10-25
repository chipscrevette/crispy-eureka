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
import { SCORE_BREAKS, loadScores, ordinal, placeOf, scoreKey, withScores, type Scores } from './scores'
import { CellScore, Compare, type Zone } from './CellPanels'
import { cellAt, cellIndex, centroid, type LonLat } from './geo'
import Search, { type Address } from './Search'
import { readHash, writeHash } from './hash'
import Memo from './Memo'
import Method from './Method'
import Ask from './Ask'
import { loadAnswers, type AskAnswer } from './answers'
import { loadCatchments, reachOf, type Catchments } from './catchments'
import { demandLayers, loadDemand, withDemand, type Demand } from './demand'
import Plan from './Plan'
import { NEW_BRAND, loadPlanner, type Backtest, type Planner } from './planner'
import Atlas from './Atlas'
import { ATLAS, atlasKey } from './atlasLayers'
import { entriesText, loadStations, type Stations } from './stations'
import { footfallText, loadStreets, streetTitle, type StreetProps, type Streets } from './streets'
import { bestPlaces, countOpen, openKey, openPlaces, withOpenSpaces } from './dashboardData'
import { HEIGHTS, coloursOf, isDark, profileColour, rampFor, stepExpr } from './palette'
import { featureLabel, lang, localFeatures, switchLang, tr } from './i18n'

const PARIS: [number, number] = [2.3325, 48.8665]
const BASEMAP: string | StyleSpecification =
  import.meta.env.VITE_BASEMAP_STYLE === 'blank'
    ? {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': isDark() ? '#1d2128' : '#e7e5df' } }],
      }
    : (import.meta.env.VITE_BASEMAP_STYLE ??
      `https://tiles.openfreemap.org/styles/${isDark() ? 'dark' : 'positron'}`)
const SCORE = 'score'
const FILL_OPACITY = 0.78

type Data = {
  stores: Stores
  grid: Grid
  meta: GridMeta
  scores: Scores
  catchments: Catchments
  demand: FeatureInfo[]
  groups: Demand['groups']
}
type Tip = { x: number; y: number; title: string; text: string }
type Tab = 'explore' | 'plan' | 'ask' | 'method'

const TABS: { id: Tab; label: string }[] = [
  { id: 'explore', label: tr('Explorer', 'Explore') },
  { id: 'plan', label: tr('Planifier', 'Plan') },
  { id: 'ask', label: tr('Demander', 'Ask') },
  { id: 'method', label: tr('Méthode', 'Method') },
]

/** Plain names for the score classes (SCORE_BREAKS: top half, quarter, tenth, twentieth). */
const SCORE_WORDS =
  lang() === 'en'
    ? ['Below average', 'Good', 'Very good', 'Excellent', 'Best 5%']
    : ['Sous la moyenne', 'Bon', 'Très bon', 'Excellent', 'Top 5 %']
const NOUN: Record<ProfileId, string> = {
  'jewellery-watches': tr('les joailliers et horlogers', 'jewellers and watchmakers'),
  'fashion-house': tr('les maisons de mode', 'fashion houses'),
  beauty: tr('les marques de beauté', 'beauty brands'),
}
const SHORT: Record<ProfileId, string> = {
  'jewellery-watches': tr('Joaillerie', 'Jewellery'),
  'fashion-house': tr('Mode', 'Fashion'),
  beauty: tr('Beauté', 'Beauty'),
}
/** "8e" reads "8e arrondissement" in both languages. */
const arr = (place: string) => `${place} arrondissement`
const HINT_KEY = 'adresse-hint-seen'

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const phone = () => window.matchMedia('(max-width: 760px)').matches

/** The basemap and every layer colour follow the theme, so a switch reloads the page. */
function switchTheme() {
  try {
    localStorage.setItem('adresse-theme', isDark() ? 'light' : 'dark')
  } catch {
    return
  }
  window.location.reload()
}

/** Fill colour of each block: the layer's ramp, greyed outside a walk, the selected block in coral. */
function colourExpr(
  key: string,
  breaks: number[],
  colours: string[],
  focus: { cell: string | null; reach: string[] },
): ExpressionSpecification {
  let expr: ExpressionSpecification = stepExpr(key, breaks, colours)
  if (focus.reach.length)
    expr = ['case', ['in', ['get', 'cell'], ['literal', focus.reach]], expr, cssVar('--quiet')]
  if (focus.cell) expr = ['case', ['==', ['get', 'cell'], focus.cell], cssVar('--pin'), expr]
  return expr
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
  const [ask, setAsk] = useState<string | null>(initial.ask)
  const [answers, setAnswers] = useState<AskAnswer[] | null>(null)
  const [answerCells, setAnswerCells] = useState<string[]>([])
  const [plan, setPlan] = useState<string | null>(initial.plan)
  const [planCount, setPlanCount] = useState(initial.k)
  const [planner, setPlanner] = useState<[Planner, Backtest] | null>(null)
  const [threeD, setThreeD] = useState(true)
  // the first answer is where nobody is yet; where the brands already are is one click away
  const [fresh, setFresh] = useState(true)
  const markers = useRef<maplibregl.Marker[]>([])
  const pickingRef = useRef(picking)
  pickingRef.current = picking
  const tipEl = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState<(Address & { cell: string }) | null>(null)
  const [searchNote, setSearchNote] = useState('')
  const pin = useRef<maplibregl.Marker | null>(null)
  const [ready, setReady] = useState(false)
  const [stations, setStations] = useState<Stations | null>(null)
  const [showStations, setShowStations] = useState(false)
  const [streets, setStreets] = useState<Streets | null>(null)
  const [showStreets, setShowStreets] = useState(false)
  // a one-time hint on the map; storage can be blocked, so it falls back to showing once per visit
  const [hintSeen, setHintSeen] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === '1'
    } catch {
      return false
    }
  })
  const dismissHint = useCallback(() => {
    setHintSeen(true)
    try {
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      // nothing to remember the hint with; it stays closed for this visit
    }
  }, [])

  useEffect(() => {
    // an extra layer: the map works without it
    loadStations().then(setStations, () => setStations(null))
  }, [])

  useEffect(() => {
    Promise.all([loadStores(), loadGrid(), loadGridMeta(), loadScores(), loadCatchments(), loadDemand()]).then(
      ([stores, grid, meta, scores, catchments, demand]) =>
        setData({
          stores,
          grid: withOpenSpaces(
            withDemand(withScores(grid, scores), demand),
            PROFILES.map((p) => scoreKey(p.id)),
          ),
          meta: { ...meta, features: localFeatures(meta.features) },
          scores: { ...scores, features: localFeatures(scores.features) },
          catchments,
          demand: localFeatures(demandLayers(demand)),
          groups: demand.groups.map((g) => ({ ...g, label: featureLabel(`demand_${g.key}`, g.label) })),
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
      zoom: phone() ? 12.4 : 13,
      pitch: phone() ? 40 : 50,
      bearing: -12,
      // a sharp screen draws 4× the pixels for little visible gain on coloured blocks, so the map caps it
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
      fadeDuration: 0,
      maxPitch: 60,
      renderWorldCopies: false,
      attributionControl: {
        compact: true,
        customAttribution:
          tr(
            'Lieux et rues © Overture Maps Foundation, contributeurs OpenStreetMap · INSEE · DGFiP · Île-de-France Mobilités · Atout France · Apur, BDCOM 2023 · Adresses : BAN (IGN)',
            'Places and streets © Overture Maps Foundation, OpenStreetMap contributors · INSEE · DGFiP · Île-de-France Mobilités · Atout France · Apur, BDCOM 2023 · Addresses: BAN (IGN)',
          ),
      },
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')

    m.on('load', () => {
      // the credits start folded behind their (i) button, so they never cover the map on a phone
      m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      m.addSource('grid', { type: 'geojson', data: data.grid })
      m.addLayer({
        id: 'grid-fill',
        type: 'fill',
        source: 'grid',
        layout: { visibility: 'none' },
        paint: { 'fill-color': cssVar('--seine'), 'fill-opacity': 0, 'fill-outline-color': 'rgba(255,255,255,0.35)' },
      })
      m.addLayer({
        id: 'grid-3d',
        type: 'fill-extrusion',
        source: 'grid',
        layout: { visibility: 'none' },
        paint: { 'fill-extrusion-color': cssVar('--seine'), 'fill-extrusion-opacity': 0.88 },
      })
      m.addLayer({ id: 'grid-hit', type: 'fill', source: 'grid', paint: { 'fill-opacity': 0 } })
      m.addLayer({
        id: 'grid-answer',
        type: 'line',
        source: 'grid',
        filter: ['in', ['get', 'cell'], ['literal', []]],
        paint: { 'line-color': cssVar('--ink'), 'line-width': 1.5 },
      })
      m.addLayer({
        id: 'grid-plan',
        type: 'line',
        source: 'grid',
        filter: ['in', ['get', 'cell'], ['literal', []]],
        paint: { 'line-color': cssVar('--pin'), 'line-width': 3 },
      })
      m.addLayer({
        id: 'grid-selected',
        type: 'line',
        source: 'grid',
        filter: ['==', ['get', 'cell'], ''],
        paint: { 'line-color': cssVar('--pin'), 'line-width': 3 },
      })
      m.addLayer({
        id: 'grid-compare',
        type: 'line',
        source: 'grid',
        filter: ['==', ['get', 'cell'], ''],
        paint: { 'line-color': cssVar('--ink'), 'line-width': 2.5, 'line-dasharray': [2, 1] },
      })
      m.addSource('stores', { type: 'geojson', data: data.stores, promoteId: 'id' })
      // a soft halo under each boutique of the profile, so the clusters glow
      m.addLayer({
        id: 'stores-halo',
        type: 'circle',
        source: 'stores',
        filter: ['==', ['get', 'profile'], 'jewellery-watches'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 18],
          'circle-color': cssVar('--surface'),
          'circle-opacity': 0.5,
          'circle-blur': 1,
        },
      })
      m.addLayer({
        id: 'stores-profile',
        type: 'circle',
        source: 'stores',
        filter: ['==', ['get', 'profile'], 'jewellery-watches'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 8],
          'circle-color': profileColour('jewellery-watches'),
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      })
      m.addLayer({
        id: 'stores-brand',
        type: 'circle',
        source: 'stores',
        filter: ['==', ['get', 'brand'], ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 9],
          'circle-color': '#ffffff',
          'circle-stroke-color': cssVar('--pin'),
          'circle-stroke-width': 2.5,
        },
      })
      m.addLayer({
        id: 'stores-selected',
        type: 'circle',
        source: 'stores',
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 16, 12],
          'circle-color': cssVar('--pin'),
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      m.on('click', (e) => {
        const store = m.queryRenderedFeatures(e.point, { layers: ['stores-profile'] })[0]
        // in 3D the raised top of a block is what the visitor clicks, not its footprint
        const raised = m.getLayoutProperty('grid-3d', 'visibility') === 'visible'
        const block = m.queryRenderedFeatures(e.point, { layers: raised ? ['grid-3d', 'grid-hit'] : ['grid-hit'] })[0]
        const id = block ? (block.properties as CellProps).cell : null
        if (pickingRef.current) {
          if (id) setCellB(id)
          setPicking(false)
          return
        }
        setSelected(store ? (store.properties as StoreProps) : null)
        setCellA(id)
        setCellB(null)
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
    if (!ready) return
    const m = map.current!
    for (const id of ['stores-profile', 'stores-halo']) m.setFilter(id, ['==', ['get', 'profile'], profile])
    m.setPaintProperty('stores-profile', 'circle-color', profileColour(profile))
  }, [ready, profile])

  useEffect(() => {
    if (cellA) dismissHint()
  }, [cellA, dismissHint])

  useEffect(() => {
    if (ready) map.current!.setFilter('stores-selected', ['==', ['get', 'id'], selected?.id ?? ''])
  }, [ready, selected])

  useEffect(() => {
    if (!ready) return
    map.current!.setFilter('grid-selected', ['==', ['get', 'cell'], cellA ?? ''])
    map.current!.setFilter('grid-compare', ['==', ['get', 'cell'], cellB ?? ''])
  }, [ready, cellA, cellB])

  useEffect(() => {
    if (ready) map.current!.setFilter('grid-answer', ['in', ['get', 'cell'], ['literal', answerCells]])
  }, [ready, answerCells])

  useEffect(() => {
    if (ask === null || answers) return
    loadAnswers().then(setAnswers, (e: Error) => setError(e.message))
  }, [ask, answers])

  useEffect(() => {
    if (plan === null || planner) return
    loadPlanner().then(setPlanner, (e: Error) => setError(e.message))
  }, [plan, planner])

  // the brand's existing boutiques and its next sites, numbered in the order the planner picks them
  const picks = useMemo(() => {
    if (plan === null || !planner) return []
    const plans = planner[0].profiles[profile].plans
    return (plans[plan] ?? plans[NEW_BRAND]).picks.slice(0, planCount).map((p) => p.cell)
  }, [plan, planner, profile, planCount])

  const fitPadding = () =>
    phone() ? { top: 40, bottom: 40, left: 30, right: 30 } : { top: 60, bottom: 60, left: 60, right: 60 }

  useEffect(() => {
    if (!ready || !data) return
    const m = map.current!
    m.setFilter('grid-plan', ['in', ['get', 'cell'], ['literal', picks]])
    m.setFilter('stores-brand', ['==', ['get', 'brand'], plan && plan !== NEW_BRAND ? plan : ''])
    markers.current.forEach((mk) => mk.remove())
    const at = picks.flatMap((c) => {
      const f = data.grid.features.find((g) => g.properties.cell === c)
      return f ? [centroid(f.geometry.coordinates[0])] : []
    })
    markers.current = at.map((ll, i) => {
      const el = document.createElement('span')
      el.className = 'plan-marker'
      el.textContent = String(i + 1)
      el.setAttribute('aria-hidden', 'true')
      return new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(m)
    })
    if (at.length) {
      const bounds = at.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(at[0], at[0]))
      m.fitBounds(bounds, { maxZoom: 14.5, padding: fitPadding() })
    }
  }, [ready, data, picks, plan])

  useEffect(
    () => writeHash({ profile, a: cellA, b: cellB, memo, method, ask, plan, k: planCount }),
    [profile, cellA, cellB, memo, method, ask, plan, planCount],
  )

  const cells = useMemo(() => (data ? cellIndex(data.grid) : null), [data])
  // the street layer exists once the data build has estimated street footfall
  const hasStreets = !!data && typeof data.grid.features[0]?.properties.street_footfall === 'number'
  const a = (cellA && cells?.get(cellA)?.properties) || null
  const b = (cellB && cells?.get(cellB)?.properties) || null
  // which block each boutique stands in, for counting the boutiques a walk reaches
  const storeCells = useMemo(
    () =>
      data
        ? new Map(data.stores.features.map((f) => [f.properties.id, cellAt(data.grid, f.geometry.coordinates as LonLat)]))
        : null,
    [data],
  )
  const zone = useMemo((): Zone | undefined => {
    if (!data || !cellA || !cells || !storeCells) return undefined
    const reach = reachOf(data.catchments, cellA)
    if (!reach.length) return undefined
    const inReach = new Set(reach)
    const sum = (key: string) =>
      reach.reduce((t, c) => {
        const v = cells.get(c)?.properties[key]
        return t + (typeof v === 'number' ? v : 0)
      }, 0)
    const groups = data.groups.map((g) => ({ label: g.label, total: sum(`demand_${g.key}`) }))
    const all = groups.reduce((t, g) => t + g.total, 0) || 1
    const shops = data.stores.features.filter(
      (f) => f.properties.profile === profile && inReach.has(storeCells.get(f.properties.id) ?? ''),
    )
    return {
      minutes: data.catchments.minutes,
      blocks: reach.length,
      demand: sum('demand') / 100,
      split: groups.map((g) => ({ label: g.label, share: g.total / all })),
      boutiques: shops.length,
      brands: new Set(shops.map((f) => f.properties.brand)).size,
    }
  }, [data, cellA, cells, storeCells, profile])

  useEffect(() => {
    if (!ready) return
    pin.current?.remove()
    pin.current = null
    if (address && address.cell === cellA) {
      const el = document.createElement('span')
      el.className = 'address-pin'
      el.setAttribute('aria-hidden', 'true')
      pin.current = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(address.at).addTo(map.current!)
    }
  }, [ready, address, cellA])

  const focusBlock = (cell: string) => {
    const f = cells?.get(cell)
    setSelected(null)
    setPicking(false)
    setCellA(cell)
    setCellB(null)
    if (f) map.current?.flyTo({ center: centroid(f.geometry.coordinates[0]), zoom: raised ? 13.9 : 14.6 })
  }

  const onFound = (found: Address) => {
    const cell = data ? cellAt(data.grid, found.at) : null
    if (!cell) {
      setSearchNote(tr(`${found.label} est hors des blocs que nous notons.`, `${found.label} is outside the blocks we score.`))
      return
    }
    setSearchNote('')
    setAddress({ ...found, cell })
    focusBlock(cell)
  }

  const closeMemo = useCallback(() => setMemo(false), [])
  const closeMethod = useCallback(() => setMethod(false), [])
  const closeAsk = useCallback(() => setAsk(null), [])
  const closePlan = useCallback(() => setPlan(null), [])
  const onAsked = useCallback((id: string) => setAsk(id), [])

  const showAnswer = (ans: AskAnswer, withMemo = false) => {
    if (ans.profile) setProfile(ans.profile)
    setLayer(SCORE)
    setSelected(null)
    setPicking(false)
    setCellA(ans.cells[0] ?? null)
    setCellB(ans.compare ? (ans.cells[1] ?? null) : null)
    setAnswerCells(ans.cells)
    setMemo(withMemo)
    const points = ans.cells.flatMap((c) => {
      const f = cells?.get(c)
      return f ? [centroid(f.geometry.coordinates[0])] : []
    })
    if (points.length && map.current) {
      const bounds = points.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(points[0], points[0]))
      map.current.fitBounds(bounds, { maxZoom: 15, padding: fitPadding() })
    }
    // on a phone the drawer covers the map, so step aside; a shared link still reopens it
    if (phone()) setAsk(null)
  }

  const isScore = layer === SCORE
  const key = atlasKey(layer, profile)
  const breaks = useMemo(
    () => (isScore ? SCORE_BREAKS : data && key ? quantileBreaks(data.grid, key) : []),
    [data, key, isScore],
  )
  const allInfo = useMemo(() => [...(data?.demand ?? []), ...(data?.meta.features ?? [])], [data])
  const info = isScore ? undefined : allInfo.find((f) => f.key === layer)
  const layerName = ATLAS.find((l) => l.id === layer)?.label ?? info?.label ?? tr('Sans couleur', 'No colour')
  const colours = useMemo(() => coloursOf(rampFor(key || SCORE)), [key])
  const format = useCallback(
    (v: number) => (isScore ? `${Math.round(v)}` : formatValue(v, info?.unit ?? '')),
    [isScore, info],
  )
  // Plan and Ask draw outlines and numbered pins on the ground, so they use the flat map
  const raised = threeD && plan === null && ask === null
  const reach = useMemo(
    () => (cellA && !cellB && data ? reachOf(data.catchments, cellA) : []),
    [cellA, cellB, data],
  )

  useEffect(() => {
    if (!ready) return
    const m = map.current!
    const shown = !!key
    m.setLayoutProperty('grid-fill', 'visibility', shown && !raised ? 'visible' : 'none')
    m.setLayoutProperty('grid-3d', 'visibility', shown && raised ? 'visible' : 'none')
    // in 3D the selected block is raised in coral; its outline on the ground would only confuse
    m.setLayoutProperty('grid-selected', 'visibility', shown && raised ? 'none' : 'visible')
    if (!shown) return
    let color = colourExpr(key, breaks, colours, { cell: raised ? cellA : null, reach })
    // in the open-space view, blocks where luxury already is (or shops or spending are missing) go grey and flat
    const openOnly = isScore && fresh && !reach.length
    const isOpen: ExpressionSpecification = ['==', ['get', openKey(key)], 1]
    // flat and faded where luxury already is or the street is weak, so the free spots stand up from the city
    if (openOnly && !raised) color = ['case', isOpen, color, cssVar('--quiet')]
    // the bottom half of Paris on the potential layer stays clear, so only the opportunities stand out
    const visible: ExpressionSpecification = isScore
      ? ['all', ['has', key], ['>=', ['get', key], SCORE_BREAKS[0]]]
      : ['has', key]
    m.setPaintProperty('grid-fill', 'fill-color', color)
    m.setPaintProperty('grid-fill', 'fill-opacity', ['case', visible, FILL_OPACITY, 0])
    m.setFilter('grid-3d', visible)
    m.setPaintProperty('grid-3d', 'fill-extrusion-color', color)
    let height: ExpressionSpecification = stepExpr(key, breaks, HEIGHTS)
    if (openOnly) height = ['case', isOpen, height, 0]
    // outside the walk the blocks lie flat, so the walk stands out
    m.setPaintProperty(
      'grid-3d',
      'fill-extrusion-height',
      reach.length ? ['case', ['in', ['get', 'cell'], ['literal', reach]], height, 0] : height,
    )
  }, [ready, key, breaks, colours, isScore, raised, cellA, reach, fresh])

  useEffect(() => {
    if (ready) map.current!.easeTo({ pitch: raised ? (phone() ? 40 : 50) : 0, bearing: raised ? -12 : 0, duration: 600 })
  }, [ready, raised])

  // stations sit under the boutiques; the circle grows with the daily entries
  useEffect(() => {
    if (!ready || !stations) return
    const m = map.current!
    if (!m.getSource('stations')) {
      m.addSource('stations', { type: 'geojson', data: stations })
      const size = (small: number, big: number): ExpressionSpecification => [
        'interpolate',
        ['linear'],
        ['sqrt', ['get', 'entries']],
        30,
        small,
        300,
        big,
      ]
      m.addLayer(
        {
          id: 'stations',
          type: 'circle',
          source: 'stations',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, size(1.5, 7), 15, size(4, 16)],
            'circle-color': cssVar('--ink'),
            'circle-opacity': 0.6,
            'circle-stroke-color': cssVar('--surface'),
            'circle-stroke-width': 1.5,
          },
        },
        'stores-halo',
      )
    }
    m.setLayoutProperty('stations', 'visibility', showStations ? 'visible' : 'none')
  }, [ready, stations, showStations])

  // the busiest streets, loaded the first time the layer is turned on; lines thicken with footfall
  useEffect(() => {
    if (showStreets && !streets) loadStreets().then(setStreets, () => setStreets(null))
  }, [showStreets, streets])
  useEffect(() => {
    if (!ready || !streets) return
    const m = map.current!
    if (!m.getSource('streets')) {
      m.addSource('streets', { type: 'geojson', data: streets })
      const ramp = coloursOf(rampFor('street_footfall'))
      m.addLayer(
        {
          id: 'streets',
          type: 'line',
          source: 'streets',
          layout: { visibility: 'none', 'line-cap': 'round' },
          paint: {
            'line-color': ['match', ['get', 'level'], 3, ramp[4], 2, ramp[3], ramp[2]],
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              11,
              ['match', ['get', 'level'], 3, 2, 2, 1.2, 0.6],
              16,
              ['match', ['get', 'level'], 3, 7, 2, 4.5, 2.5],
            ],
            'line-opacity': 0.9,
          },
        },
        'stores-halo',
      )
    }
    m.setLayoutProperty('streets', 'visibility', showStreets ? 'visible' : 'none')
  }, [ready, streets, showStreets])

  // the free spots are spread across Paris, so the map steps back to show them all
  useEffect(() => {
    if (!ready || !data || !fresh || cellA || plan !== null || ask !== null) return
    const k = openKey(scoreKey(profile))
    const points = data.grid.features
      .filter((f) => f.properties[k] === 1)
      .map((f) => centroid(f.geometry.coordinates[0]))
    if (!points.length) return
    const bounds = points.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(points[0], points[0]))
    // one move with the tilt, so the 3D tilt that runs at the same time does not cancel it
    const m = map.current!
    const camera = m.cameraForBounds(bounds, { padding: fitPadding(), maxZoom: 14 })
    if (camera) m.easeTo({ ...camera, pitch: raised ? (phone() ? 40 : 50) : 0, bearing: raised ? -12 : 0, duration: 800 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data, profile, fresh])

  // a tooltip in plain words follows the pointer
  const keyRef = useRef({ key, isScore, name: layerName, format })
  keyRef.current = { key, isScore, name: layerName, format }
  useEffect(() => {
    if (!ready) return
    const m = map.current!
    // the tooltip is written straight into its element: a React render of the whole page on every mouse move made the map stutter
    const setTip = (t: Tip | null) => {
      const el = tipEl.current
      if (!el) return
      el.hidden = !t
      if (!t) return
      el.style.transform = `translate(${t.x + 14}px, ${t.y}px) translateY(-50%)`
      el.firstElementChild!.textContent = t.title
      el.lastElementChild!.textContent = t.text
    }
    // at most one lookup per frame, and none while the map moves
    let frame = 0
    let last: maplibregl.MapMouseEvent | null = null
    const onMove = (e: maplibregl.MapMouseEvent) => {
      last = e
      if (!frame) frame = requestAnimationFrame(update)
    }
    const update = () => {
      frame = 0
      const e = last
      if (!e) return
      if (m.isMoving()) return setTip(null)
      const k = keyRef.current
      const onStations = m.getLayer('stations') && m.getLayoutProperty('stations', 'visibility') === 'visible'
      const station = onStations ? m.queryRenderedFeatures(e.point, { layers: ['stations'] })[0] : undefined
      if (station) {
        const sp = station.properties as { name: string; entries: number }
        return setTip({ x: e.point.x, y: e.point.y, title: sp.name, text: entriesText(sp.entries) })
      }
      const onStreets = m.getLayer('streets') && m.getLayoutProperty('streets', 'visibility') === 'visible'
      const street = onStreets ? m.queryRenderedFeatures(e.point, { layers: ['streets'] })[0] : undefined
      if (street) {
        const sp = street.properties as StreetProps
        return setTip({ x: e.point.x, y: e.point.y, title: streetTitle(sp.level), text: footfallText(sp.index) })
      }
      const layers = ['grid-3d', 'grid-hit'].filter((l) => m.getLayoutProperty(l, 'visibility') !== 'none')
      const p = m.queryRenderedFeatures(e.point, { layers })[0]?.properties as CellProps | undefined
      if (!p || !k.key) return setTip(null)
      const v = p[k.key]
      const text =
        typeof v !== 'number'
          ? tr('Pas de donnée ici', 'No data here')
          : k.isScore
            ? `${k.name}: ${Math.round(v)} / 100 · ${SCORE_WORDS[SCORE_BREAKS.filter((x) => v >= x).length]}`
            : `${k.name}: ${k.format(v)}`
      setTip({ x: e.point.x, y: e.point.y, title: placeOf(p).replace(/^Paris /, ''), text })
    }
    const onLeave = () => {
      last = null
      setTip(null)
    }
    m.on('mousemove', onMove)
    m.on('movestart', onLeave)
    m.getCanvas().addEventListener('mouseleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      m.off('mousemove', onMove)
      m.off('movestart', onLeave)
      m.getCanvas().removeEventListener('mouseleave', onLeave)
    }
  }, [ready])

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
  const tab = method ? 'method' : plan !== null ? 'plan' : ask !== null ? 'ask' : 'explore'
  const openTab = (t: Tab) => {
    setMethod(t === 'method')
    if (t === 'method') return
    setAsk(t === 'ask' ? (ask ?? '1') : null)
    setPlan(t === 'plan' ? (plan ?? NEW_BRAND) : null)
  }
  const clearSelection = () => {
    setSelected(null)
    setCellA(null)
    setCellB(null)
    setPicking(false)
    setAnswerCells([])
  }
  const tested = validation ? ordinal(validation.model.mean_percentile) : '–'

  const places = useMemo(
    () => (data ? (fresh ? openPlaces : bestPlaces)(data.grid, scoreKey(profile), 5) : []),
    [data, profile, fresh],
  )
  const openCount = useMemo(() => (data ? countOpen(data.grid, scoreKey(profile)) : 0), [data, profile])
  const legendWords = isScore ? SCORE_WORDS.slice(1) : [tr('Plus bas', 'Lowest'), '', '', '', tr('Plus haut', 'Highest')]
  const legendColours = isScore ? colours.slice(1) : colours.slice(0, breaks.length + 1)

  // the five best places carry their number on the map, so the list and the map read together
  const spotMarkers = useRef<maplibregl.Marker[]>([])
  useEffect(() => {
    if (!ready || !cells) return
    spotMarkers.current.forEach((mk) => mk.remove())
    spotMarkers.current = []
    if (plan !== null || ask !== null) return
    spotMarkers.current = places.flatMap((t, i) => {
      const f = cells.get(t.cell)
      if (!f) return []
      const el = document.createElement('button')
      el.className = 'spot-marker'
      el.innerHTML = `<b>${i + 1}</b><span>${t.place}</span>`
      el.setAttribute('aria-label', `${i + 1} : ${arr(t.place)}, ${t.text} / 100`)
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        focusBlock(t.cell)
      })
      return [new maplibregl.Marker({ element: el, anchor: 'left', offset: [-11, 0] }).setLngLat(centroid(f.geometry.coordinates[0])).addTo(map.current!)]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cells, places, plan, ask])

  return (
    <div className="app">
      <aside className="rail" aria-label={tr('Réglages', 'Controls')}>
        <p className="wordmark">
          <span className="wordmark-dot" aria-hidden="true" />
          Adresse
        </p>
        <h1>{tr('Où une marque de luxe doit-elle ouvrir sa prochaine boutique à Paris ?', 'Where should a luxury brand open next in Paris?')}</h1>
        <div className="profiles" role="radiogroup" aria-label={tr('Type de marque', 'Type of brand')}>
          {PROFILES.map((p) => (
            <button
              key={p.id}
              id={`profile-${p.id}`}
              role="radio"
              aria-checked={profile === p.id}
              onClick={() => {
                setProfile(p.id)
                setSelected(null)
                setLayer(SCORE)
              }}
            >
              {SHORT[p.id]}
              <span className="profile-count">{counts ? counts[p.id] : ''}</span>
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label={tr('Quels lieux', 'Which places')}>
          <button aria-pressed={fresh} onClick={() => setFresh(true)}>
            {tr('Places libres', 'Free spots')}
          </button>
          <button aria-pressed={!fresh} onClick={() => setFresh(false)}>
            {tr('Déjà présents', 'Already there')}
          </button>
        </div>
        {error ? (
          <p className="error">{error}</p>
        ) : fresh ? (
          <div className="stat">
            <span className="stat-value">{openCount}</span>
            <p className="answer">
              {tr('blocs ressemblent aux rues que choisissent ', 'blocks look like the streets ')}
              {NOUN[profile]}
              {tr(', ', ' choose, with ')}
              <strong>{tr('sans boutique de luxe pour l’instant', 'no luxury boutique yet')}</strong>.
            </p>
            <details className="stat-why">
              <summary>{tr('Comment sont-ils choisis ?', 'How are they picked?')}</summary>
              <p className="answer">
                {tr(
                  'Chacun a une boutique vide de 300 m² ou plus à proximité, dans une rue où peu de vitrines sont vides, avec déjà des clients et du pouvoir d’achat.',
                  'Each has an empty shop of 300 m² or more nearby, on a street where few shops stand empty, with shoppers and spending already there.',
                )}
              </p>
            </details>
          </div>
        ) : (
          <p className="answer">
            {tr(
              `Plus le bloc est foncé, plus il ressemble aux adresses où ${NOUN[profile]} sont déjà. Ces rues ont fait leurs preuves, mais elles sont prises.`,
              `The darker the block, the more it looks like where ${NOUN[profile]} already are. These streets are proven, but crowded.`,
            )}
          </p>
        )}
        <ol className="places">
          {places.map((t, i) => (
            <li key={t.cell}>
              <button onClick={() => focusBlock(t.cell)} aria-current={cellA === t.cell ? 'true' : undefined}>
                <span className="top-n">{i + 1}</span>
                <span className="top-place">{arr(t.place)}</span>
                <span className="top-value">
                  {t.text}
                  <span className="top-max"> / 100</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <Search onFound={onFound} />
        {searchNote && <p className="muted small">{searchNote}</p>}
        <nav className="nav" aria-label={tr('Vues', 'Views')}>
          {TABS.map((t) => (
            <button
              key={t.id}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => openTab(t.id)}
              disabled={!data}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <p className="rail-foot">
          <span>{tr('Paris, données ouvertes', 'Paris, from open data only')}</span>
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
            aria-label={
              isDark() ? tr('Passer au thème clair', 'Switch to the light theme') : tr('Passer au thème sombre', 'Switch to the dark theme')
            }
            title={isDark() ? tr('Thème clair', 'Light theme') : tr('Thème sombre', 'Dark theme')}
          >
            <span aria-hidden="true">{isDark() ? '☀' : '☾'}</span>
          </button>
        </p>
      </aside>

      <main className="stage" aria-label={tr('Carte', 'Map')}>
        <div className="map-card">
          <div ref={container} className="map" aria-label={tr('Carte des boutiques de luxe à Paris', 'Map of luxury boutiques in Paris')} role="region" />
            <div className="map-legend" aria-label={`${tr('Légende', 'Map legend')} : ${layerName}`}>
              <span className="legend-title">{layerName}</span>
              {key && (
                <span className="legend-row">
                  {legendColours.map((c, i) => (
                    <span key={c} className="legend-step">
                      <span className="legend-swatch" style={{ background: c }} aria-hidden="true" />
                      {legendWords[i] && <span className="legend-word">{legendWords[i]}</span>}
                    </span>
                  ))}
                </span>
              )}
              {isScore && fresh && !reach.length && (
                <span className="legend-row">
                  <span className="legend-step">
                    {!raised && <span className="legend-swatch" style={{ background: 'var(--quiet)' }} aria-hidden="true" />}
                    <span className="legend-word">
                      {raised
                        ? tr('En relief : places libres. À plat : déjà pris ou rue faible', 'Raised: free spots. Flat: taken or weak streets')
                        : tr('Luxe déjà là, ou rue peu commerçante', 'Luxury already there, or not a shopping street')}
                    </span>
                  </span>
                </span>
              )}
              {showStreets && streets && (
                <span className="legend-row">
                  <span className="legend-step">
                    <span className="legend-line" aria-hidden="true" />
                    <span className="legend-word">
                      {tr('Rue passante : plus le trait est épais, plus il y a de passage', 'Busy street: the thicker, the more people walk past')}
                    </span>
                  </span>
                </span>
              )}
              {showStations && stations && (
                <span className="legend-row">
                  <span className="legend-step">
                    <span className="legend-dot legend-station" aria-hidden="true" />
                    <span className="legend-word">
                      {tr('Gare : plus le rond est gros, plus il y a de monde par jour', 'Station: the bigger, the more people a day')}
                    </span>
                  </span>
                </span>
              )}
              <span className="legend-row">
                <span className="legend-step">
                  <span className="legend-dot" style={{ background: profileColour(profile) }} aria-hidden="true" />
                  <span className="legend-word">
                    {tr(
                      `Boutique ${PROFILES.find((p) => p.id === profile)?.label.toLowerCase()}`,
                      `${PROFILES.find((p) => p.id === profile)?.label} boutique`,
                    )}
                  </span>
                </span>
              </span>
            </div>
            {plan === null && ask === null && (
              <div className="view-toggle" role="group" aria-label={tr('Vue de la carte', 'Map view')}>
                <button aria-pressed={!threeD} onClick={() => setThreeD(false)}>
                  2D
                </button>
                <button aria-pressed={threeD} onClick={() => setThreeD(true)}>
                  3D
                </button>
              </div>
            )}
            {plan === null && ask === null && (
              <div className="layer-toggles" role="group" aria-label={tr('Couches en plus', 'Extra map layers')}>
                {stations && (
                  <button className="layer-toggle" aria-pressed={showStations} onClick={() => setShowStations((v) => !v)}>
                    <span className="legend-dot legend-station" aria-hidden="true" />
                    {tr('Gares', 'Stations')}
                  </button>
                )}
                {hasStreets && (
                  <button className="layer-toggle" aria-pressed={showStreets} onClick={() => setShowStreets((v) => !v)}>
                    <span className="legend-line" aria-hidden="true" />
                    {tr('Rues passantes', 'Busy streets')}
                  </button>
                )}
              </div>
            )}
            {!hintSeen && !a && plan === null && ask === null && (
              <div className="hint" role="note">
                <span>{tr('Cliquez sur un bloc coloré pour voir pourquoi il ressort.', 'Tap a coloured block to see why it scores well.')}</span>
                <button onClick={dismissHint} aria-label={tr('Fermer l’astuce', 'Close the hint')}>
                  ×
                </button>
              </div>
            )}
            <div className="tip" ref={tipEl} hidden aria-hidden="true">
              <strong />
              <span />
            </div>
          </div>
        <ul className="figures" aria-label={tr('Ce type de marque en chiffres', 'This type of brand in numbers')}>
          <li>
            <span className="figure-value accent">{openCount}</span>
            <span className="figure-label">{tr('places libres', 'free spots')}</span>
          </li>
          <li>
            <span className="figure-value">{counts ? counts[profile] : '–'}</span>
            <span className="figure-label">{tr('boutiques aujourd’hui', 'boutiques today')}</span>
          </li>
          <li>
            <span className="figure-value">{brands || '–'}</span>
            <span className="figure-label">{tr('marques', 'brands')}</span>
          </li>
          <li
            title={tr(
              'Nous avons caché des marques entières au modèle ; leurs vraies boutiques arrivent quand même aussi haut en moyenne',
              'We hid whole brands from the model; their real boutiques still landed this high on average',
            )}
          >
            <span className="figure-value">{tested}</span>
            <span className="figure-label">{tr('centile en test à l’aveugle', 'percentile in a blind test')}</span>
          </li>
        </ul>
      </main>

      <section className="panel" aria-label={tr('Détails', 'Details')}>
        {ask !== null && data && answers ? (
          <Ask
            answers={answers}
            first={ask}
            onAsked={onAsked}
            onShow={(x) => showAnswer(x)}
            onMemo={(x) => showAnswer(x, true)}
            onMethod={() => setMethod(true)}
            onClose={closeAsk}
          />
        ) : plan !== null && data && planner ? (
          <Plan
            planner={planner[0]}
            backtest={planner[1]}
            profile={profile}
            brand={plan}
            count={planCount}
            placeOf={(c) => {
              const p = cells?.get(c)?.properties
              return p
                ? placeOf(p)
                    .replace(/^Paris /, '')
                    .replace('Arrondissement', 'arrondissement')
                : c
            }}
            onProfile={(p) => {
              setProfile(p)
              setPlan(NEW_BRAND)
            }}
            onBrand={setPlan}
            onCount={setPlanCount}
            onPick={(c) => {
              setCellA(c)
              setCellB(null)
            }}
            onMethod={() => setMethod(true)}
            onClose={closePlan}
          />
        ) : (selected || a) && data ? (
          <section className="card selected" aria-live="polite">
            <button className="back" onClick={clearSelection}>
              <span aria-hidden="true">←</span> {tr('Tout Paris', 'All of Paris')}
            </button>
            {selected && (
              <div className="store">
                <p className="brand">{selected.brand}</p>
                <p className="muted small">
                  {selected.segment}
                  {selected.osm_confirmed !== undefined &&
                    (selected.osm_confirmed
                      ? tr('. Aussi présente dans OpenStreetMap à moins de 75 m.', '. Also mapped in OpenStreetMap within 75 m.')
                      : tr(
                          '. Absente d’OpenStreetMap : adresse à prendre avec précaution.',
                          '. Not found in OpenStreetMap, so treat this location with care.',
                        ))}
                </p>
              </div>
            )}
            {a && !b && (
              <CellScore
                cell={a}
                grid={data.grid}
                zone={zone}
                address={address?.cell === a.cell ? address.label.replace(/ \d{5} Paris$/, '') : undefined}
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
          </section>
        ) : data ? (
          <>
            <Atlas
              grid={data.grid}
              profile={profile}
              layer={layer}
              cell={cellA}
              onLayer={setLayer}
              onBlock={focusBlock}
            />
            <select
              className="more-data"
              aria-label={tr('Une autre couche', 'Another layer')}
              value={ATLAS.some((l) => l.id === layer) ? '' : layer}
              onChange={(e) => setLayer(e.target.value || SCORE)}
            >
              <option value="">{tr('Une autre couche…', 'Another layer…')}</option>
              {allInfo
                .filter((f) => !ATLAS.some((l) => atlasKey(l.id, profile) === f.key))
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
            </select>
          </>
        ) : null}
      </section>

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
