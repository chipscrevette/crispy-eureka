import { useEffect, useMemo, useRef, useState } from 'react'
import { quantileBreaks, type CellProps, type Grid } from './grid'
import { SCORE_BREAKS, placeOf, scoreKey } from './scores'
import { ATLAS, atlasKey } from './atlasLayers'
import { openKey } from './dashboardData'
import { coloursOf, rampFor } from './palette'
import type { ProfileId } from './stores'

type Props = {
  grid: Grid
  profile: ProfileId
  layer: string
  cell: string | null
  onLayer: (id: string) => void
  onBlock: (cell: string) => void
}

type Projected = { cell: string; ring: [number, number][]; at: [number, number] }

/** Every block's outline in 0..1 x 0..1/aspect, north up, so each canvas only scales it. */
function useOutline(grid: Grid) {
  return useMemo(() => {
    const all = grid.features.flatMap((f) => f.geometry.coordinates[0])
    const lons = all.map((c) => c[0])
    const lats = all.map((c) => c[1])
    const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180)
    const w = (x1 - x0) * k
    const p = (c: number[]): [number, number] => [((c[0] - x0) * k) / w, (y1 - c[1]) / w]
    const blocks: Projected[] = grid.features.map((f) => {
      const ring = f.geometry.coordinates[0].map(p)
      const n = ring.length - 1
      const at: [number, number] = [ring.slice(0, n).reduce((s, q) => s + q[0], 0) / n, ring.slice(0, n).reduce((s, q) => s + q[1], 0) / n]
      return { cell: f.properties.cell, ring, at }
    })
    return { blocks, aspect: (y1 - y0) / w }
  }, [grid])
}

function sizeCanvas(canvas: HTMLCanvasElement) {
  const r = Math.min(window.devicePixelRatio || 1, 2)
  const { width, height } = canvas.getBoundingClientRect()
  canvas.width = Math.round(width * r)
  canvas.height = Math.round(height * r)
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(r, 0, 0, r, 0, 0)
  return { ctx, width, height }
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Colour of each block on one layer, with the same classes as the big map; empty blocks stay neutral. */
function fills(grid: Grid, key: string, isScore: boolean): Map<string, string | null> {
  const colours = coloursOf(rampFor(key))
  const breaks = isScore ? SCORE_BREAKS : quantileBreaks(grid, key)
  const out = new Map<string, string | null>()
  for (const f of grid.features) {
    const v = f.properties[key]
    if (typeof v !== 'number' || v <= 0 || (isScore && v < SCORE_BREAKS[0])) {
      out.set(f.properties.cell, null)
      continue
    }
    const c = breaks.filter((b) => v >= b).length
    out.set(f.properties.cell, colours[Math.min(c, colours.length - 1)])
  }
  return out
}

function MiniMap(props: { grid: Grid; outline: ReturnType<typeof useOutline>; mapKey: string; isScore: boolean; cell: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { grid, outline, mapKey, isScore, cell } = props
  const colours = useMemo(() => fills(grid, mapKey, isScore), [grid, mapKey, isScore])
  useEffect(() => {
    const { ctx, width, height } = sizeCanvas(ref.current!)
    const s = Math.min(width, height / outline.aspect)
    const ox = (width - s) / 2
    const oy = (height - s * outline.aspect) / 2
    const quiet = css('--quiet')
    ctx.clearRect(0, 0, width, height)
    for (const b of outline.blocks) {
      ctx.beginPath()
      b.ring.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * s, oy + y * s) : ctx.moveTo(ox + x * s, oy + y * s)))
      ctx.fillStyle = colours.get(b.cell) ?? quiet
      ctx.fill()
    }
    const sel = cell ? outline.blocks.find((b) => b.cell === cell) : undefined
    if (sel) {
      ctx.beginPath()
      ctx.arc(ox + sel.at[0] * s, oy + sel.at[1] * s, 5, 0, 2 * Math.PI)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = css('--ink')
      ctx.stroke()
    }
  }, [outline, colours, cell])
  return <canvas ref={ref} className="atlas-map" aria-hidden="true" />
}

const SPEND_MAX = 400

/** Spending against potential, one dot per block: free spots in the accent, luxury already there in ink. */
function Scatter(props: { grid: Grid; profile: ProfileId; cell: string | null; onBlock: (cell: string) => void }) {
  const { grid, profile, cell, onBlock } = props
  const ref = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; p: CellProps } | null>(null)
  const geo = useRef({ w: 0, h: 0, pad: { l: 30, r: 8, t: 8, b: 22 } })
  const key = scoreKey(profile)
  const lux = atlasKey('luxury', profile)
  const points = useMemo(
    () =>
      grid.features
        .map((f) => f.properties)
        .filter((p) => typeof p[key] === 'number')
        .map((p) => ({
          p,
          spend: Math.min(typeof p.demand === 'number' ? p.demand : 0, SPEND_MAX),
          score: p[key] as number,
          kind: p[openKey(key)] === 1 ? 'open' : (p[lux] as number) > 0 ? 'luxury' : 'other',
        }))
        // the accent dots are drawn last, so they sit on top
        .sort((a, b) => (a.kind === 'open' ? 1 : 0) - (b.kind === 'open' ? 1 : 0)),
    [grid, key, lux],
  )
  const xy = (spend: number, score: number): [number, number] => {
    const { w, h, pad } = geo.current
    return [pad.l + (spend / SPEND_MAX) * (w - pad.l - pad.r), pad.t + (1 - score / 100) * (h - pad.t - pad.b)]
  }

  useEffect(() => {
    const { ctx, width, height } = sizeCanvas(ref.current!)
    geo.current.w = width
    geo.current.h = height
    const { pad } = geo.current
    const [ink, muted, rule, accent] = [css('--ink'), css('--muted'), css('--rule'), css('--accent')]
    ctx.clearRect(0, 0, width, height)
    ctx.strokeStyle = rule
    ctx.lineWidth = 1
    const avg = xy(100, 0)[0]
    ctx.beginPath()
    ctx.moveTo(pad.l, height - pad.b + 0.5)
    ctx.lineTo(width - pad.r, height - pad.b + 0.5)
    ctx.moveTo(avg + 0.5, pad.t)
    ctx.lineTo(avg + 0.5, height - pad.b)
    ctx.stroke()
    ctx.fillStyle = muted
    ctx.font = `500 11px ${css('--ui')}`
    ctx.textAlign = 'right'
    ctx.fillText('100', pad.l - 6, pad.t + 8)
    ctx.fillText('0', pad.l - 6, height - pad.b)
    ctx.textAlign = 'left'
    ctx.fillText('Paris average', avg + 4, height - pad.b - 6)
    ctx.fillText('More spending →', pad.l, height - 6)
    for (const d of points) {
      const [x, y] = xy(d.spend, d.score)
      ctx.beginPath()
      ctx.arc(x, y, d.kind === 'open' ? 3.4 : 2.2, 0, 2 * Math.PI)
      ctx.globalAlpha = d.kind === 'other' ? 0.35 : 1
      ctx.fillStyle = d.kind === 'open' ? accent : d.kind === 'luxury' ? ink : muted
      ctx.fill()
    }
    ctx.globalAlpha = 1
    const sel = cell ? points.find((d) => d.p.cell === cell) : undefined
    if (sel) {
      const [x, y] = xy(sel.spend, sel.score)
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, 2 * Math.PI)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = ink
      ctx.stroke()
    }
  }, [points, cell])

  const nearest = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    let best: { d: number; x: number; y: number; p: CellProps } | null = null
    for (const d of points) {
      const [x, y] = xy(d.spend, d.score)
      const dist = Math.hypot(x - mx, y - my)
      if (dist < 8 && (!best || dist < best.d)) best = { d: dist, x, y, p: d.p }
    }
    return best
  }

  return (
    <figure className="scatter">
      <figcaption className="atlas-kicker">
        Spending and potential, one dot per block
        <span className="scatter-key">
          <span className="key-dot accent" aria-hidden="true" /> free spot
          <span className="key-dot ink" aria-hidden="true" /> luxury already there
        </span>
      </figcaption>
      <div className="scatter-plot">
        <canvas
          ref={ref}
          role="img"
          aria-label="Each block of Paris by spending and luxury potential"
          onMouseMove={(e) => setHover(nearest(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const hit = nearest(e)
            if (hit) onBlock(hit.p.cell)
          }}
          style={{ cursor: hover ? 'pointer' : 'default' }}
        />
        {hover && (
          <span className="scatter-tip" style={{ left: hover.x, top: hover.y }}>
            {placeOf(hover.p).replace(/^Paris /, '')}
            <span className="muted">
              {' '}
              · {Math.round(hover.p[key] as number)} / 100
            </span>
          </span>
        )}
      </div>
    </figure>
  )
}

export default function Atlas(props: Props) {
  const { grid, profile, layer, cell } = props
  const outline = useOutline(grid)
  return (
    <section className="atlas" aria-label="What the map can show">
      <p className="atlas-kicker">Why: nine maps of open data. Click one to put it on the big map.</p>
      <div className="atlas-grid" role="radiogroup" aria-label="Map layer">
        {ATLAS.map((l) => {
          const key = atlasKey(l.id, profile)
          const swatch = coloursOf(rampFor(key))[3]
          return (
            <button
              key={l.id}
              role="radio"
              aria-checked={layer === l.id}
              className="atlas-tile"
              onClick={() => props.onLayer(l.id)}
            >
              <span className="atlas-title">
                <span className="key-dot" style={{ background: swatch }} aria-hidden="true" />
                {l.label}
              </span>
              <MiniMap grid={grid} outline={outline} mapKey={key} isScore={l.id === 'score'} cell={cell} />
              <span className="atlas-note">{l.note}</span>
            </button>
          )
        })}
      </div>
      <Scatter grid={grid} profile={profile} cell={cell} onBlock={props.onBlock} />
    </section>
  )
}
