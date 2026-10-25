import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellProps, Grid } from './grid'
import { placeOf, scoreKey } from './scores'
import { ATLAS, atlasKey, cssVar as css, fills, sizeCanvas, useOutline } from './atlasLayers'
import { openKey } from './dashboardData'
import { coloursOf, rampFor } from './palette'
import type { ProfileId } from './stores'
import { tr } from './i18n'

type Props = {
  grid: Grid
  profile: ProfileId
  layer: string
  cell: string | null
  onLayer: (id: string) => void
  onBlock: (cell: string) => void
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
    ctx.fillText(tr('Moyenne de Paris', 'Paris average'), avg + 4, height - pad.b - 6)
    ctx.fillText(tr('Plus de pouvoir d’achat →', 'More spending →'), pad.l, height - 6)
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
        {tr('Pouvoir d’achat et potentiel, un point par bloc', 'Spending and potential, one dot per block')}
        <span className="scatter-key">
          <span className="key-dot accent" aria-hidden="true" /> {tr('place libre', 'free spot')}
          <span className="key-dot ink" aria-hidden="true" /> {tr('luxe déjà là', 'luxury already there')}
        </span>
      </figcaption>
      <div className="scatter-plot">
        <canvas
          ref={ref}
          role="img"
          aria-label={tr('Chaque bloc de Paris selon son pouvoir d’achat et son potentiel luxe', 'Each block of Paris by spending and luxury potential')}
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
    <section className="atlas" aria-label={tr('Ce que la carte peut montrer', 'What the map can show')}>
      <p className="atlas-kicker">
        {tr(
          'Pourquoi : neuf cartes de données ouvertes. Cliquez-en une pour l’afficher sur la grande carte.',
          'Why: nine maps of open data. Click one to put it on the big map.',
        )}
      </p>
      <div className="atlas-grid" role="radiogroup" aria-label={tr('Couche de la carte', 'Map layer')}>
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
