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
import Dashboard from './Dashboard'
import { areaBars, topBlocks, type AreaBar } from './dashboardData'
import { HEIGHTS, PROFILE_COLOUR, coloursOf, isDark, profileColour, rampFor, stepExpr } from './palette'

const PARIS: [number, number] = [2.3325, 48.8665]
const BASEMAP: string | StyleSpecification =
  import.meta.env.VITE_BASEMAP_STYLE === 'blank'
    ? {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#E4E8E6' } }],
      }
    : (import.meta.env.VITE_BASEMAP_STYLE ?? 'https://tiles.openfreemap.org/styles/positron')
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
  { id: 'explore', label: 'Explore' },
  { id: 'plan', label: 'Plan' },
  { id: 'ask', label: 'Ask' },
  { id: 'method', label: 'Method' },
]
const SHORT: Record<ProfileId, string> = { 'jewellery-watches': 'Jewellery', 'fashion-house': 'Fashion', beauty: 'Beauty' }

/** The layers anyone can read at a glance, in plain words. Every other layer sits under "More data". */
const QUICK: { key: string; label: string; help: string }[] = [
  {
    key: SCORE,
    label: 'Luxury potential',
    help: 'How much each block looks like the places luxury brands already chose. 100 is the best block of Paris.',
  },
  {
    key: 'demand',
    label: 'Spending power',
    help: "Residents' income, people working there and hotel guests, one third each. 100 is an average block.",
  },
  {
    key: 'living_standard_r1',
    label: 'Residents’ income',
    help: 'Disposable income per person of the people living around the block.',
  },
  {
    key: 'transit_entries_r2',
    label: 'Metro & RER traffic',
    help: 'People entering the stations around the block on an average day.',
  },
  { key: 'apartment_price_m2', label: 'Property prices', help: 'Median sale price of apartments around the block.' },
]
/** Plain names for the score classes (SCORE_BREAKS: top half, quarter, tenth, twentieth). */
const SCORE_WORDS = ['Below average', 'Good', 'Very good', 'Excellent', 'Best 5%']

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const phone = () => window.matchMedia('(max-width: 760px)').matches

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
  const markers = useRef<maplibregl.Marker[]>([])
  const pickingRef = useRef(picking)
  pickingRef.current = picking
  const [tip, setTip] = useState<Tip | null>(null)
  const [address, setAddress] = useState<(Address & { cell: string }) | null>(null)
  const [searchNote, setSearchNote] = useState('')
  const pin = useRef<maplibregl.Marker | null>(null)
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
          groups: demand.groups,
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
      attributionControl: {
        compact: true,
        customAttribution:
          'Places and streets © Overture Maps Foundation, OpenStreetMap contributors · INSEE · DGFiP · Île-de-France Mobilités · Addresses: BAN (IGN)',
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
    phone() ? { top: 40, bottom: 40, left: 30, right: 30 } : { top: 60, bottom: 60, left: 60, right: plan || ask ? 480 : 60 }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data, picks, plan])

  useEffect(
    () => writeHash({ profile, a: cellA, b: cellB, memo, method, ask, plan, k: planCount }),
    [profile, cellA, cellB, memo, method, ask, plan, planCount],
  )

  const cells = useMemo(() => (data ? cellIndex(data.grid) : null), [data])
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
      setSearchNote(`${found.label} is outside the blocks we score.`)
      return
    }
    setSearchNote('')
    setAddress({ ...found, cell })
    focusBlock(cell)
  }

  const onArea = (bar: AreaBar) => {
    const points = bar.cells.flatMap((c) => {
      const f = cells?.get(c)
      return f ? [centroid(f.geometry.coordinates[0])] : []
    })
    if (!points.length || !map.current) return
    const bounds = points.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(points[0], points[0]))
    map.current.fitBounds(bounds, { padding: fitPadding(), maxZoom: 15 })
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
  const key = isScore ? scoreKey(profile) : layer
  const breaks = useMemo(
    () => (isScore ? SCORE_BREAKS : data && key ? quantileBreaks(data.grid, key) : []),
    [data, key, isScore],
  )
  const allInfo = useMemo(() => [...(data?.demand ?? []), ...(data?.meta.features ?? [])], [data])
  const info = isScore ? undefined : allInfo.find((f) => f.key === layer)
  const quick = QUICK.find((q) => q.key === layer)
  const layerName = quick?.label ?? info?.label ?? 'No colour'
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
    const color = colourExpr(key, breaks, colours, { cell: raised ? cellA : null, reach })
    // the bottom half of Paris on the potential layer stays clear, so only the opportunities stand out
    const visible: ExpressionSpecification = isScore
      ? ['all', ['has', key], ['>=', ['get', key], SCORE_BREAKS[0]]]
      : ['has', key]
    m.setPaintProperty('grid-fill', 'fill-color', color)
    m.setPaintProperty('grid-fill', 'fill-opacity', ['case', visible, FILL_OPACITY, 0])
    m.setFilter('grid-3d', visible)
    m.setPaintProperty('grid-3d', 'fill-extrusion-color', color)
    const height = stepExpr(key, breaks, HEIGHTS)
    // outside the walk the blocks lie flat, so the walk stands out
    m.setPaintProperty(
      'grid-3d',
      'fill-extrusion-height',
      reach.length ? ['case', ['in', ['get', 'cell'], ['literal', reach]], height, 0] : height,
    )
  }, [ready, key, breaks, colours, isScore, raised, cellA, reach])

  useEffect(() => {
    if (ready) map.current!.easeTo({ pitch: raised ? (phone() ? 40 : 50) : 0, bearing: raised ? -12 : 0, duration: 600 })
  }, [ready, raised])

  // a tooltip in plain words follows the pointer
  const keyRef = useRef({ key, isScore, name: layerName, format })
  keyRef.current = { key, isScore, name: layerName, format }
  useEffect(() => {
    if (!ready) return
    const m = map.current!
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const k = keyRef.current
      const layers = ['grid-3d', 'grid-hit'].filter((l) => m.getLayoutProperty(l, 'visibility') !== 'none')
      const p = m.queryRenderedFeatures(e.point, { layers })[0]?.properties as CellProps | undefined
      if (!p || !k.key) return setTip(null)
      const v = p[k.key]
      const text =
        typeof v !== 'number'
          ? 'No data here'
          : k.isScore
            ? `${k.name}: ${Math.round(v)} / 100 · ${SCORE_WORDS[SCORE_BREAKS.filter((x) => v >= x).length]}`
            : `${k.name}: ${k.format(v)}`
      setTip({ x: e.point.x, y: e.point.y, title: placeOf(p).replace(/^Paris /, ''), text })
    }
    const onLeave = () => setTip(null)
    m.on('mousemove', onMove)
    m.getCanvas().addEventListener('mouseleave', onLeave)
    return () => {
      m.off('mousemove', onMove)
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

  // the dashboard follows the layer, the profile and the selected block
  const bars = useMemo(() => (data && key ? areaBars(data.grid, key, isScore, format) : []), [data, key, isScore, format])
  const top = useMemo(() => (data && key ? topBlocks(data.grid, key, format) : []), [data, key, format])
  // with no block selected, the donut shows the boutiques of each profile in Paris
  const cityMix = useMemo(() => {
    if (!counts) return []
    const all = PROFILES.reduce((t, p) => t + counts[p.id], 0) || 1
    return PROFILES.map((p) => ({ label: `${p.label} (${counts[p.id]})`, share: counts[p.id] / all }))
  }, [counts])
  const legendWords = isScore ? SCORE_WORDS.slice(1) : ['Lowest', '', '', '', 'Highest']
  const legendColours = isScore ? colours.slice(1) : colours.slice(0, breaks.length + 1)

  return (
    <div className={`app${ask !== null || plan !== null ? ' asking' : ''}${plan !== null ? ' planning' : ''}`}>
      <header className="topbar">
        <p className="wordmark">
          <span className="wordmark-dot" aria-hidden="true" />
          Adresse
        </p>
        <nav className="tabs" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="tab"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => openTab(t.id)}
              disabled={!data}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <p className="topbar-note">Paris, from open data only</p>
      </header>

      <main className="board">
        <aside className="side" aria-label="Controls and details">
          {!(selected || a) && (
            <>
              <section className="card hero">
                <h1>Where should a luxury brand open next in Paris?</h1>
                <Search onFound={onFound} />
                {searchNote && <p className="muted small">{searchNote}</p>}
                <div className="segmented" role="radiogroup" aria-label="Brand profile">
                  {PROFILES.map((p) => (
                    <button
                      key={p.id}
                      id={`profile-${p.id}`}
                      role="radio"
                      aria-checked={profile === p.id}
                      onClick={() => {
                        setProfile(p.id)
                        setSelected(null)
                      }}
                    >
                      <span
                        className="dot"
                        aria-hidden="true"
                        style={{ background: isDark() ? PROFILE_COLOUR[p.id].dark : PROFILE_COLOUR[p.id].light }}
                      />
                      {SHORT[p.id]}
                    </button>
                  ))}
                </div>
                {error ? (
                  <p className="error">{error}</p>
                ) : (
                  <ul className="tiles three" aria-label="This profile in numbers">
                    <li className="tile">
                      <span className="tile-value">{counts ? counts[profile] : '–'}</span>
                      <span className="tile-label">boutiques today</span>
                    </li>
                    <li className="tile">
                      <span className="tile-value">{brands || '–'}</span>
                      <span className="tile-label">brands</span>
                    </li>
                    <li
                      className="tile"
                      title="We hid whole brands from the model; their real boutiques still landed this high on average"
                    >
                      <span className="tile-value">{tested}</span>
                      <span className="tile-label">percentile in a blind test</span>
                    </li>
                  </ul>
                )}
              </section>

              <section className="card" aria-labelledby="layers-title">
                <h2 id="layers-title" className="card-title">
                  What the map shows
                </h2>
                <div className="layer-list" role="radiogroup" aria-labelledby="layers-title">
                  {QUICK.map((q) => {
                    const sw = coloursOf(rampFor(q.key === SCORE ? scoreKey(profile) : q.key))
                    return (
                      <button
                        key={q.key}
                        role="radio"
                        aria-checked={layer === q.key}
                        className="layer"
                        onClick={() => setLayer(q.key)}
                        disabled={!data}
                      >
                        <span
                          className="layer-swatch"
                          aria-hidden="true"
                          style={{ background: `linear-gradient(135deg, ${sw[1]}, ${sw[4]})` }}
                        />
                        <span>{q.label}</span>
                      </button>
                    )
                  })}
                </div>
                <label htmlFor="layer" className="label">
                  More data
                </label>
                <select
                  id="layer"
                  value={quick ? '' : layer}
                  onChange={(e) => setLayer(e.target.value || SCORE)}
                  disabled={!data}
                >
                  <option value="">Choose a layer…</option>
                  {allInfo
                    .filter((f) => !QUICK.some((q) => q.key === f.key))
                    .map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                </select>
                <p className="muted small">{quick?.help ?? (info ? `${info.description}. Source: ${info.source}.` : '')}</p>
                {isScore && validation && (
                  <p className="muted small">
                    Fair test: for brands the model never saw, their real boutiques landed at the{' '}
                    {ordinal(validation.model.mean_percentile)} percentile on average.
                  </p>
                )}
              </section>

              <details className="card sources small">
                <summary>Data sources</summary>
                <p className="muted">{data?.meta.sources.join(' · ') ?? 'Loading'}.</p>
              </details>
            </>
          )}

          {(selected || a) && data && (
            <section className="card selected" aria-live="polite">
              <button className="back" onClick={clearSelection}>
                <span aria-hidden="true">←</span> All of Paris
              </button>
              {selected && (
                <div className="store">
                  <p className="brand">{selected.brand}</p>
                  <p className="muted small">
                    {selected.segment}
                    {selected.osm_confirmed !== undefined &&
                      (selected.osm_confirmed
                        ? '. Also mapped in OpenStreetMap within 75 m.'
                        : '. Not found in OpenStreetMap, so treat this location with care.')}
                  </p>
                </div>
              )}
              {a && !b && (
                <CellScore
                  cell={a}
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
          )}
        </aside>

        <section className="stage" aria-label="Map and charts">
          <div className="map-card">
            <div ref={container} className="map" aria-label="Map of luxury boutiques in Paris" role="region" />
            <div className="map-legend" aria-label={`Map legend: ${layerName}`}>
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
              <span className="legend-row">
                <span className="legend-step">
                  <span className="legend-dot" style={{ background: profileColour(profile) }} aria-hidden="true" />
                  <span className="legend-word">{PROFILES.find((p) => p.id === profile)?.label} boutique</span>
                </span>
              </span>
            </div>
            {plan === null && ask === null && (
              <div className="view-toggle" role="group" aria-label="Map view">
                <button aria-pressed={!threeD} onClick={() => setThreeD(false)}>
                  2D
                </button>
                <button aria-pressed={threeD} onClick={() => setThreeD(true)}>
                  3D
                </button>
              </div>
            )}
            {tip && (
              <div className="tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
                <strong>{tip.title}</strong>
                <span>{tip.text}</span>
              </div>
            )}
          </div>

          {data && key && (
            <Dashboard
              title={isScore ? 'Best arrondissements' : `${layerName} by arrondissement`}
              bars={bars}
              barNote={isScore ? 'Blocks in the top 10% of Paris. Click to zoom.' : 'Average block. Click to zoom.'}
              colours={colours}
              mix={zone ? zone.split : cityMix}
              mixColours={zone ? [colours[4], colours[3], colours[1]] : PROFILES.map((p) => profileColour(p.id))}
              mixTitle={zone ? `Spending within a ${zone.minutes}-minute walk` : 'Luxury boutiques in Paris'}
              mixNote={
                zone
                  ? 'Share of the spending power in the walk. For Paris as a whole it is one third each.'
                  : 'Street boutiques of the catalogue brands, by profile.'
              }
              top={top}
              topTitle={isScore ? 'Best blocks for this profile' : `Highest blocks: ${layerName.toLowerCase()}`}
              onArea={onArea}
              onBlock={focusBlock}
            />
          )}
        </section>
      </main>

      {ask !== null && data && answers && (
        <Ask
          answers={answers}
          first={ask}
          onAsked={onAsked}
          onShow={(x) => showAnswer(x)}
          onMemo={(x) => showAnswer(x, true)}
          onMethod={() => setMethod(true)}
          onClose={closeAsk}
        />
      )}

      {plan !== null && data && planner && (
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
