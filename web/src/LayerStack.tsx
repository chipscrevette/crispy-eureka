import { useEffect, useMemo, useRef } from 'react'
import type { CellProps, Grid } from './grid'
import { centroid, toMetres, type LonLat } from './geo'
import { atlasKey, cssVar, fills, sizeCanvas } from './atlasLayers'
import { coloursOf, rampFor } from './palette'
import type { ProfileId } from './stores'

/** How far around the block each layer shows, in metres: about a 15-minute walk across. */
const RADIUS_M = 1100
const ROW = 78
const MAP_W = 190

type Layer = { id: string; label: string; value: (v: number) => string }

/** Top to bottom: what drives a boutique, then where luxury already is, then the answer. */
const LAYERS: Layer[] = [
  { id: 'demand', label: 'Spending', value: (v) => `${(v / 100).toFixed(1)}× the Paris average` },
  { id: 'street_footfall', label: 'Footfall', value: (v) => `${v.toFixed(1)}× a typical street` },
  {
    id: 'transit_entries_r2',
    label: 'Stations',
    value: (v) => `${v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)} entries a day nearby`,
  },
  { id: 'fashion_stores_r1', label: 'Fashion shops', value: (v) => `${Math.round(v)} fashion stores around` },
  {
    id: 'luxury',
    label: 'Luxury already',
    value: (v) => (v ? `${v} boutique${v === 1 ? '' : 's'} of this type around` : 'None of this type around yet'),
  },
  { id: 'score', label: 'Potential', value: (v) => `${Math.round(v)} / 100` },
]

/** Where the block stands in Paris on one value, in plain words. */
function rankWords(grid: Grid, key: string, v: number) {
  const values = grid.features.map((f) => f.properties[key]).filter((x): x is number => typeof x === 'number')
  const above = values.filter((x) => x > v).length / values.length
  if (above < 0.005) return 'the highest in Paris'
  if (above <= 0.5) return `top ${Math.max(1, Math.round(above * 100))}% of Paris`
  return 'below the Paris median'
}

type Props = { grid: Grid; cell: CellProps; profile: ProfileId }

/**
 * The block's neighbourhood drawn once per layer and stacked like sheets of paper,
 * with a dotted line that runs through the block from the first sheet to the answer.
 */
export default function LayerStack({ grid, cell, profile }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
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
  const colours = useMemo(
    () => LAYERS.map((l, i) => fills(grid, keys[i], l.id === 'score')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, profile],
  )

  useEffect(() => {
    const { ctx, width } = sizeCanvas(ref.current!)
    const s = MAP_W / 2 / RADIUS_M
    const cx = width / 2
    // a quarter turn and a flattening: the sheet lies on a table seen from above and to the side
    const iso = ([x, y]: number[], row: number): [number, number] => [
      cx + (x - y) * 0.707 * s,
      ROW / 2 + 14 + row * ROW - (x + y) * 0.707 * 0.5 * s,
    ]
    const [quiet, ink, surface] = [cssVar('--quiet'), cssVar('--ink'), cssVar('--surface')]
    ctx.clearRect(0, 0, width, ROW * LAYERS.length + 40)
    LAYERS.forEach((_, row) => {
      for (const b of around) {
        ctx.beginPath()
        b.ring.forEach((p, i) => (i ? ctx.lineTo(...iso(p, row)) : ctx.moveTo(...iso(p, row))))
        ctx.fillStyle = colours[row].get(b.cell) ?? quiet
        ctx.fill()
        ctx.strokeStyle = surface
        ctx.lineWidth = 0.5
        ctx.stroke()
      }
      const home = around.find((b) => b.cell === cell.cell)
      if (home) {
        ctx.beginPath()
        home.ring.forEach((p, i) => (i ? ctx.lineTo(...iso(p, row)) : ctx.moveTo(...iso(p, row))))
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
    LAYERS.forEach((_, row) => {
      const [x, y] = iso([0, 0], row)
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI)
      ctx.fillStyle = surface
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.4
      ctx.stroke()
    })
  }, [around, colours, cell.cell])

  return (
    <figure className="stack" aria-label="This block, layer by layer">
      <figcaption className="atlas-kicker">Why, layer by layer</figcaption>
      <div className="stack-body" style={{ height: ROW * LAYERS.length + 28 }}>
        <canvas ref={ref} className="stack-maps" aria-hidden="true" />
        <ol className="stack-rows">
          {LAYERS.map((l, i) => {
            const v = cell[keys[i]]
            const hue = coloursOf(rampFor(keys[i]))[3]
            return (
              <li key={l.id} style={{ height: ROW }}>
                <span className="stack-label" style={{ color: l.id === 'score' ? 'var(--accent)' : hue }}>
                  {l.label}
                </span>
                <span className="stack-value">{typeof v === 'number' ? l.value(v) : 'No data here'}</span>
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
