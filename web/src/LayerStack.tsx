import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellProps, Grid } from './grid'
import { centroid, toMetres, type LonLat } from './geo'
import { atlasKey, cssVar, fills, sizeCanvas } from './atlasLayers'
import { coloursOf, rampFor, useTheme } from './palette'
import type { ProfileId } from './stores'
import { fmt, lang, tr } from './i18n'

/** How far around the block each layer shows, in metres: about a 15-minute walk across. */
const RADIUS_M = 1100
/** Each sheet takes this share of its row; the rest is air between sheets, so each one reads alone. */
const SHEET = 0.64
/** Row height and sheet width when the stack does not fill a box. */
const ROW = 104
const MAP_W = 2 * SHEET * ROW

type Layer = { id: string; label: string; value: (v: number) => string }

/** Top to bottom: what drives a boutique, then where luxury already is, then the answer. */
const LAYERS: Layer[] = [
  {
    id: 'demand',
    get label() { return tr('Pouvoir d’achat', 'Spending') },
    value: (v) => tr(`${fmt(v / 100, 1)}× la moyenne de Paris`, `${(v / 100).toFixed(1)}× the Paris average`),
  },
  {
    id: 'street_footfall',
    get label() { return tr('Passage', 'Footfall') },
    value: (v) => tr(`${fmt(v, 1)}× une rue type`, `${v.toFixed(1)}× a typical street`),
  },
  {
    id: 'transit_entries_r2',
    get label() { return tr('Gares', 'Stations') },
    value: (v) => {
      const n = v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)
      return tr(`${n} entrées par jour`, `${n} entries a day nearby`)
    },
  },
  {
    id: 'fashion_stores_r1',
    get label() { return tr('Mode', 'Fashion shops') },
    value: (v) => tr(`${Math.round(v)} boutiques de mode`, `${Math.round(v)} fashion stores around`),
  },
  {
    id: 'luxury',
    get label() { return tr('Luxe déjà là', 'Luxury already') },
    value: (v) =>
      v
        ? tr(`${v} boutique${v === 1 ? '' : 's'} de ce type autour`, `${v} boutique${v === 1 ? '' : 's'} of this type around`)
        : tr('Aucune de ce type autour', 'None of this type around yet'),
  },
  { id: 'score', get label() { return tr('Potentiel', 'Potential') }, value: (v) => `${Math.round(v)} / 100` },
]

/** Where the block stands in Paris on one value, in plain words. */
function rankWords(grid: Grid, key: string, v: number) {
  const values = grid.features.map((f) => f.properties[key]).filter((x): x is number => typeof x === 'number')
  const above = values.filter((x) => x > v).length / values.length
  if (above < 0.005) return tr('le plus haut de Paris', 'the highest in Paris')
  const top = Math.max(1, Math.round(above * 100))
  if (above <= 0.5) return lang() === 'en' ? `top ${top}% of Paris` : `top ${top} % de Paris`
  return tr('sous la médiane de Paris', 'below the Paris median')
}

type Props = { grid: Grid; cell: CellProps; profile: ProfileId; fill?: boolean }

/**
 * The block's neighbourhood drawn once per layer and stacked like sheets of paper,
 * with a dotted line that runs through the block from the first sheet to the answer.
 */
export default function LayerStack({ grid, cell, profile, fill = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const body = useRef<HTMLDivElement>(null)
  // filling a box, the rows share its height and the sheets grow with them
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!fill) return
    const el = body.current!
    const obs = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    obs.observe(el)
    return () => obs.disconnect()
  }, [fill])
  const row = fill && box ? Math.max(56, box.h / LAYERS.length) : ROW
  // a sheet is half as tall as it is wide, seen at this angle
  const mapW = fill && box ? Math.min(2 * SHEET * row, box.w * 0.48, 300) : MAP_W
  const around = useMemo(() => {
    const home = grid.features.find((f) => f.properties.cell === cell.cell)
    if (!home) return []
    const origin = centroid(home.geometry.coordinates[0])
    return grid.features.flatMap((f) => {
      const [x, y] = toMetres(centroid(f.geometry.coordinates[0]), origin)
      if (Math.hypot(x, y) > RADIUS_M) return []
      return [{ cell: f.properties.cell, ring: f.geometry.coordinates[0].map((c) => toMetres(c as LonLat, origin)) }]
    })
  }, [grid, cell.cell])
  const keys = LAYERS.map((l) => atlasKey(l.id, profile))
  const theme = useTheme()
  const colours = useMemo(
    () => LAYERS.map((l, i) => fills(grid, keys[i], l.id === 'score')),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fills reads the theme
    [grid, profile, theme],
  )

  // the canvas reads the theme's CSS colours, so `theme` makes it redraw on a switch
  useEffect(() => {
    const { ctx, width } = sizeCanvas(ref.current!)
    const s = mapW / 2 / RADIUS_M
    const cx = width / 2
    // a quarter turn and a flattening: the sheet lies on a table seen from above and to the side
    const iso = ([x, y]: number[], i: number): [number, number] => [
      cx + (x - y) * 0.707 * s,
      row / 2 + i * row - (x + y) * 0.707 * 0.5 * s,
    ]
    const [quiet, ink, surface] = [cssVar('--quiet'), cssVar('--ink'), cssVar('--surface')]
    ctx.clearRect(0, 0, width, row * LAYERS.length)
    LAYERS.forEach((_, i) => {
      for (const b of around) {
        ctx.beginPath()
        b.ring.forEach((p, j) => (j ? ctx.lineTo(...iso(p, i)) : ctx.moveTo(...iso(p, i))))
        ctx.fillStyle = colours[i].get(b.cell) ?? quiet
        ctx.fill()
        ctx.strokeStyle = surface
        ctx.lineWidth = 0.5
        ctx.stroke()
      }
      const home = around.find((b) => b.cell === cell.cell)
      if (home) {
        ctx.beginPath()
        home.ring.forEach((p, j) => (j ? ctx.lineTo(...iso(p, i)) : ctx.moveTo(...iso(p, i))))
        ctx.closePath()
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.6
        ctx.stroke()
      }
    })
    ctx.beginPath()
    ctx.setLineDash([3, 3])
    ctx.moveTo(cx, iso([0, 0], 0)[1])
    ctx.lineTo(cx, iso([0, 0], LAYERS.length - 1)[1])
    ctx.strokeStyle = ink
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
    LAYERS.forEach((_, i) => {
      const [x, y] = iso([0, 0], i)
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI)
      ctx.fillStyle = surface
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.4
      ctx.stroke()
    })
  }, [around, colours, cell.cell, row, mapW, theme])

  return (
    <figure className={fill ? 'stack fill' : 'stack'} aria-label={tr('Ce bloc, couche par couche', 'This block, layer by layer')}>
      <figcaption className="atlas-kicker">{tr('Pourquoi, couche par couche', 'Why, layer by layer')}</figcaption>
      <div ref={body} className="stack-body" style={fill ? undefined : { height: row * LAYERS.length }}>
        <canvas ref={ref} className="stack-maps" style={{ width: mapW + 12 }} aria-hidden="true" />
        <ol className="stack-rows" style={{ paddingLeft: mapW + 28 }}>
          {LAYERS.map((l, i) => {
            const v = cell[keys[i]]
            const hue = coloursOf(rampFor(keys[i]))[3]
            return (
              <li key={l.id} style={{ height: row }}>
                <span className="stack-label" style={{ color: l.id === 'score' ? 'var(--accent)' : hue }}>
                  {l.label}
                </span>
                <span className="stack-value">{typeof v === 'number' ? l.value(v) : tr('Pas de donnée ici', 'No data here')}</span>
                {typeof v === 'number' && l.id !== 'luxury' && (
                  <span className="stack-rank">{rankWords(grid, keys[i], v)}</span>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </figure>
  )
}
