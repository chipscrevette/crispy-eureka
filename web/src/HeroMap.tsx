import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from './appData'
import { atlasKey, cssVar as css, fills, sizeCanvas, useOutline } from './atlasLayers'
import type { Borders } from './borders'
import { num, short, valueText } from './blocks'
import { cellIndex, type LonLat } from './geo'
import type { CellProps } from './grid'
import { tr } from './i18n'
import type { Network } from './network'
import { profileColour, walkColour } from './palette'
import type { ProfileId } from './stores'

/** A line's badge on the map: its number or letter on its colour, round for the metro, square for the RER. */
export type Badge = { label: string; colour: string; ink: string; rer: boolean }
/**
 * A point of a detail view, `size` from 0 to 1 against the largest: a spike as tall as its value, or,
 * for a station with `badges`, its lines' badges as large as its crowd.
 */
export type Mark = { at: LonLat; size: number; colour: string; label?: string; badges?: Badge[] }

type View = { x: number; y: number; w: number; h: number }
const lerp = (a: View, b: View, k: number): View => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k })
const sameView = (a: View, b: View) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

type Pt = [number, number]

/** The outline of a set of blocks as closed loops: the edges no two of its blocks share, chained end to end. */
function loopsOf(blocks: { ring: Pt[] }[]): Pt[][] {
  const at = (q: Pt) => `${q[0].toFixed(6)},${q[1].toFixed(6)}`
  const edges = new Map<string, [Pt, Pt]>()
  for (const b of blocks)
    for (let i = 0; i + 1 < b.ring.length; i++) {
      const [p, q] = [b.ring[i], b.ring[i + 1]]
      const k = [at(p), at(q)].sort().join(' ')
      if (edges.has(k)) edges.delete(k)
      else edges.set(k, [p, q])
    }
  const from = new Map<string, [Pt, Pt][]>()
  for (const e of edges.values()) for (const q of e) from.set(at(q), [...(from.get(at(q)) ?? []), e])
  const used = new Set<[Pt, Pt]>()
  const loops: Pt[][] = []
  for (const first of edges.values()) {
    if (used.has(first)) continue
    used.add(first)
    const loop = [first[0]]
    let end = first[1]
    while (at(end) !== at(loop[0])) {
      const next = (from.get(at(end)) ?? []).find((e) => !used.has(e))
      if (!next) break
      used.add(next)
      loop.push(end)
      end = at(next[0]) === at(end) ? next[1] : next[0]
    }
    loops.push(loop)
  }
  return loops
}

/**
 * Turns a loop of hexagon edges into one soft line: the edges' midpoints, averaged with their
 * neighbours to iron out the hexagon steps, then rounded by cutting corners (Chaikin).
 */
function smooth(loop: Pt[]): Pt[] {
  const n = loop.length
  let pts: Pt[] = loop.map((p, i) => [(p[0] + loop[(i + 1) % n][0]) / 2, (p[1] + loop[(i + 1) % n][1]) / 2])
  for (let r = 0; r < 3; r++)
    pts = pts.map((_, i) => {
      const near = [-2, -1, 0, 1, 2].map((d) => pts[(i + d + n) % n])
      return [near.reduce((t, q) => t + q[0], 0) / 5, near.reduce((t, q) => t + q[1], 0) / 5]
    })
  for (let r = 0; r < 2; r++)
    pts = pts.flatMap((p, i) => {
      const q = pts[(i + 1) % pts.length]
      return [
        [p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25],
        [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75],
      ] as Pt[]
    })
  return pts
}

/**
 * Paris block by block, coloured like the big map; the free spots numbered, or the boutiques already there.
 * Around the chosen block, one ring per band of the walk; a searched address closes the view in on its walk.
 */
export default function HeroMap(props: {
  data: Data
  profile: ProfileId
  layer: string
  cell: string | null
  /** what the dots show: the numbered free spots, the boutiques of the type, or nothing */
  dots: 'free' | 'boutiques' | 'none'
  /** points of the detail views, as spikes as tall as their value */
  marks?: Mark[]
  /** the walk's blocks in this one pale tone and the rest neutral, so the marks are the subject */
  muted?: string
  /** the metro drawn bold, as on a transit map */
  transit?: boolean
  open: CellProps[]
  zone: Set<string> | null
  /** minutes to each block reached on foot from the chosen block */
  rings: Map<string, number> | null
  minutes: number
  /** the blocks to frame, or null for all of Paris */
  focus: Set<string> | null
  pin: LonLat | null
  brand: string | null
  placed: Map<string, string>
  borders: Borders | null
  network: Network | null
  /** a block clicked, or null for a click outside Paris, which lets the choice go */
  onBlock: (cell: string | null) => void
  onAllParis?: () => void
}) {
  const { data, profile, layer, cell, dots, marks, muted, transit, open, zone, rings, minutes, focus, pin, brand, placed, borders, network, onBlock } = props
  // the metro is there on demand: the map first reads as the layer
  const [metro, setMetro] = useState(false)
  const ref = useRef<HTMLCanvasElement>(null)
  const outline = useOutline(data.grid)
  const key = atlasKey(layer, profile)
  const colours = useMemo(() => fills(data.grid, key, layer === 'score'), [data, key, layer])
  const geo = useRef({ s: 1, ox: 0, oy: 0 })
  const [hover, setHover] = useState<{ x: number; y: number; p: CellProps } | null>(null)
  const byCell = useMemo(() => cellIndex(data.grid), [data])
  const rank = useMemo(() => new Map(open.map((p, i) => [p.cell, i + 1])), [open])

  // each band's ring: the soft outline of every block reached within its minutes, nearest first
  const lines = useMemo(() => {
    if (!rings) return []
    const bands = [...new Set(rings.values())].sort((a, b) => a - b)
    return bands.map((m, i) => {
      const loops = loopsOf(outline.blocks.filter((b) => (rings.get(b.cell) ?? Infinity) <= m)).map((l) => smooth(l))
      // the label sits on the ring's northernmost point
      const top = loops.flat().reduce((t, q) => (q[1] < t[1] ? q : t), [0, Infinity] as Pt)
      return { minutes: m, band: i, loops, top }
    })
  }, [rings, outline])
  const bandIndex = useMemo(() => new Map(lines.map((r) => [r.minutes, r.band])), [lines])

  // what the map frames: all of Paris, or the walk around a searched address with a margin
  const target = useMemo<View>(() => {
    const all = { x: 0, y: 0, w: 1, h: outline.aspect }
    const pts = focus ? outline.blocks.filter((b) => focus.has(b.cell)).flatMap((b) => b.ring) : []
    if (!pts.length) return all
    const [x0, x1] = [Math.min(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[0]))]
    const [y0, y1] = [Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))]
    // a margin around, and never closer than about a fifth of Paris
    const side = Math.max(x1 - x0, y1 - y0, 0.2)
    const pad = side * 0.18
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2]
    const [w, h] = [Math.max(x1 - x0, side / 2) + 2 * pad, Math.max(y1 - y0, side / 2) + 2 * pad]
    return { x: cx - w / 2, y: cy - h / 2, w, h }
  }, [focus, outline])
  const view = useRef<View | null>(null)
  // bumped to send the view back to its frame after the visitor zoomed or moved it
  const [home, setHome] = useState(0)
  const drawRef = useRef<() => void>(() => {})

  useEffect(() => {
    const draw = () => {
      const { ctx, width, height } = sizeCanvas(ref.current!)
      const v = view.current ?? target
      const s = Math.min(width / v.w, height / v.h) * 0.96
      const ox = (width - s * v.w) / 2 - v.x * s
      const oy = (height - s * v.h) / 2 - v.y * s
      geo.current = { s, ox, oy }
      const zoom = s / Math.min(width, height / outline.aspect)
      const quiet = css('--quiet')
      const ink = css('--ink')
      ctx.clearRect(0, 0, width, height)
      for (const b of outline.blocks) {
        ctx.beginPath()
        b.ring.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * s, oy + y * s) : ctx.moveTo(ox + x * s, oy + y * s)))
        ctx.fillStyle = b.cell === cell ? ink : muted ? (zone?.has(b.cell) ? muted : quiet) : (colours.get(b.cell) ?? quiet)
        // around a chosen block, the farther the walk the more the blocks step back; a picked brand's dots stand out
        const band = zone?.has(b.cell) ? bandIndex.get(rings?.get(b.cell) ?? 0) ?? 0 : null
        ctx.globalAlpha = (zone ? (band === null ? 0.3 : 1 - 0.12 * band) : 1) * (brand && dots === 'boutiques' ? 0.45 : 1)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      // landmarks: the arrondissements' edges, then the metro in its own colours, thin and quiet
      const path = (ring: number[][]) =>
        ring.forEach((c, i) => {
          const [x, y] = outline.project(c)
          if (i) ctx.lineTo(ox + x * s, oy + y * s)
          else ctx.moveTo(ox + x * s, oy + y * s)
        })
      // nothing beyond the city: the landmarks are cut at its edge
      const city = borders?.features.find((f) => f.properties.city)
      ctx.save()
      if (city) {
        ctx.beginPath()
        path(city.geometry.coordinates[0])
        ctx.clip()
      }
      if (borders) {
        ctx.strokeStyle = ink
        ctx.lineJoin = 'round'
        for (const f of borders.features) {
          ctx.globalAlpha = f.properties.city ? 0.25 : 0.1
          ctx.lineWidth = f.properties.city ? 1 : 0.7
          ctx.beginPath()
          path(f.geometry.coordinates[0])
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
      if (network && (metro || transit)) {
        ctx.lineWidth = transit ? Math.min(2.6 * Math.sqrt(zoom), 6) : Math.min(1.2 * Math.sqrt(zoom), 2.6)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.globalAlpha = transit ? 0.75 : zone ? 0.3 : 0.45
        for (const f of network.features) {
          ctx.strokeStyle = f.properties.colour
          ctx.beginPath()
          const g = f.geometry
          for (const line of g.type === 'LineString' ? [g.coordinates] : g.coordinates) path(line)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
      ctx.restore()
      // the walk's rings, the farthest first so the nearest lies on top
      ctx.lineJoin = 'round'
      const thick = Math.min(Math.max(Math.sqrt(zoom), 1), 1.6)
      for (const r of [...lines].reverse()) {
        if (r.minutes > minutes) continue
        ctx.strokeStyle = walkColour(r.band)
        ctx.lineWidth = (r.band === 0 ? 2 : 1.5) * thick
        ctx.beginPath()
        for (const loop of r.loops) {
          loop.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * s, oy + y * s) : ctx.moveTo(ox + x * s, oy + y * s)))
          ctx.closePath()
        }
        ctx.stroke()
      }
      ctx.font = `500 10px ${css('--ui')}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const surface = css('--surface')
      // labels from the outermost ring in, each only where it clears the ones already placed
      const labelled: [number, number][] = []
      for (const r of [...lines].reverse()) {
        if (r.minutes > minutes || !r.loops.length) continue
        const [x, y] = [ox + r.top[0] * s, oy + r.top[1] * s]
        // on all of Paris the rings are small: only the outermost is named
        if (labelled.length && zoom < 1.5) break
        if (labelled.some(([lx, ly]) => Math.abs(lx - x) < 52 && Math.abs(ly - y) < 18)) continue
        labelled.push([x, y])
        const text = `${r.minutes} min`
        const w = ctx.measureText(text).width + 10
        ctx.fillStyle = surface
        ctx.beginPath()
        ctx.roundRect(x - w / 2, y - 8, w, 16, 8)
        ctx.fill()
        ctx.fillStyle = walkColour(r.band)
        ctx.fillText(text, x, y + 0.5)
      }
      if (dots === 'boutiques') {
        // with a brand picked, its boutiques on top in colour and the rest stepped back
        const mine = (f: (typeof data.stores.features)[number]) => !brand || f.properties.brand === brand
        const r = Math.min(3 * Math.sqrt(zoom), 6)
        for (const pass of brand ? [false, true] : [true]) {
          ctx.fillStyle = pass ? profileColour(profile) : css('--muted')
          for (const f of data.stores.features) {
            const at = placed.get(f.properties.id)
            if (f.properties.profile !== profile || !at || mine(f) !== pass) continue
            ctx.globalAlpha = (zone && !zone.has(at) ? 0.4 : 1) * (pass ? 1 : 0.35)
            const [x, y] = outline.project(f.geometry.coordinates)
            ctx.beginPath()
            ctx.arc(ox + x * s, oy + y * s, pass && brand ? r + 2.5 : pass ? r : r * 0.7, 0, 2 * Math.PI)
            ctx.fill()
          }
        }
        ctx.globalAlpha = 1
      } else if (dots === 'free') {
        // the free spots, numbered as in the list, like the pins of the map page
        ctx.font = `500 11px ${css('--display')}`
        const accent = css('--accent')
        for (const b of outline.blocks) {
          const n = rank.get(b.cell)
          if (!n || (zone && !zone.has(b.cell))) continue
          const [x, y] = [ox + b.at[0] * s, oy + b.at[1] * s]
          ctx.beginPath()
          ctx.arc(x, y, 10, 0, 2 * Math.PI)
          ctx.fillStyle = b.cell === cell ? accent : ink
          ctx.fill()
          ctx.fillStyle = surface
          ctx.fillText(String(n), x, y + 0.5)
        }
      }
      if (marks?.length) {
        // the detail's points as a spike map: thin peaks rising from each place, as tall as its value,
        // drawn from the back so the nearer ones stand in front, a tinted body with an edge of the same colour
        const tall = 72 * Math.min(Math.max(Math.sqrt(zoom), 1), 1.5)
        const half = 5
        const tips = new Map<Mark, [number, number]>()
        // stations as their lines' badges side by side, the busiest the largest, a thin gap of paper around each
        const grow = Math.min(Math.max(Math.sqrt(zoom), 1), 1.4)
        for (const m of [...marks].filter((m) => m.badges?.length).sort((a, b) => a.size - b.size)) {
          const [x, y] = outline.project(m.at)
          const [px, py] = [ox + x * s, oy + y * s]
          const r = (5 + 5 * m.size) * grow
          const bs = m.badges!
          const step = 2 * r - 1
          const x0 = px - ((bs.length - 1) * step) / 2
          tips.set(m, [px, py - r - 2])
          ctx.font = `500 ${Math.round(r * 1.05)}px ${css('--display')}`
          ctx.textAlign = 'center'
          bs.forEach((b, k) => {
            const cx = x0 + k * step
            ctx.beginPath()
            if (b.rer) ctx.roundRect(cx - r, py - r, 2 * r, 2 * r, r * 0.35)
            else ctx.arc(cx, py, r, 0, 2 * Math.PI)
            ctx.fillStyle = b.colour
            ctx.fill()
            ctx.strokeStyle = surface
            ctx.lineWidth = 1.5
            ctx.stroke()
            ctx.fillStyle = b.ink
            ctx.fillText(b.label, cx, py + 0.5)
          })
        }
        for (const m of [...marks].filter((m) => !m.badges?.length).sort((a, b) => outline.project(a.at)[1] - outline.project(b.at)[1])) {
          const [x, y] = outline.project(m.at)
          const [px, py, h] = [ox + x * s, oy + y * s, Math.max(4, m.size * tall)]
          tips.set(m, [px, py - h])
          ctx.beginPath()
          ctx.moveTo(px - half, py)
          ctx.lineTo(px, py - h)
          ctx.lineTo(px + half, py)
          ctx.closePath()
          ctx.fillStyle = `${m.colour}a6`
          ctx.fill()
          ctx.strokeStyle = m.colour
          ctx.lineWidth = 1
          ctx.lineJoin = 'miter'
          ctx.stroke()
        }
        // names above the peaks, skipped where they would run into one already written
        ctx.font = `500 11px ${css('--ui')}`
        ctx.textAlign = 'left'
        ctx.lineJoin = 'round'
        const taken: [number, number, number, number][] = []
        for (const m of marks) {
          if (!m.label) continue
          const [tx, ty] = tips.get(m)!
          const w = ctx.measureText(m.label).width
          const [lx, ly] = [tx - w / 2, ty - (m.badges ? 13 : 9)]
          if (taken.some(([a, b, c, d]) => lx < c && lx + w > a && ly - 7 < d && ly + 7 > b)) continue
          taken.push([lx, ly - 7, lx + w, ly + 7])
          if (m.badges) {
            // a station's name on a small card above its badges
            ctx.beginPath()
            ctx.roundRect(lx - 7, ly - 9, w + 14, 18, 9)
            ctx.fillStyle = surface
            ctx.globalAlpha = 0.94
            ctx.fill()
            ctx.globalAlpha = 1
          } else {
            ctx.strokeStyle = surface
            ctx.lineWidth = 2.5
            ctx.strokeText(m.label, lx, ly)
          }
          ctx.fillStyle = ink
          ctx.fillText(m.label, lx, ly)
        }
        ctx.textAlign = 'center'
      }
      if (borders) {
        ctx.font = `500 ${Math.round(Math.min(10 * Math.sqrt(zoom), 16))}px ${css('--display')}`
        ctx.fillStyle = ink
        ctx.globalAlpha = 0.3
        for (const f of borders.features) {
          if (!f.properties.label || !f.properties.n) continue
          const [x, y] = outline.project(f.properties.label)
          ctx.fillText(f.properties.n === 1 ? '1er' : `${f.properties.n}e`, ox + x * s, oy + y * s)
        }
        ctx.globalAlpha = 1
      }
      if (pin) {
        // the searched address: a pin whose point is on the spot
        const [px, py] = outline.project(pin)
        const [x, y] = [ox + px * s, oy + py * s]
        ctx.fillStyle = css('--accent')
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.bezierCurveTo(x - 4, y - 7, x - 9, y - 11, x - 9, y - 17)
        ctx.arc(x, y - 17, 9, Math.PI, 0)
        ctx.bezierCurveTo(x + 9, y - 11, x + 4, y - 7, x, y)
        ctx.fill()
        ctx.fillStyle = surface
        ctx.beginPath()
        ctx.arc(x, y - 17, 3.5, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
    drawRef.current = draw
    draw()
    const obs = new ResizeObserver(draw)
    obs.observe(ref.current!)
    return () => obs.disconnect()
  }, [outline, colours, cell, dots, marks, profile, data, rank, zone, placed, lines, bandIndex, rings, minutes, pin, brand, target, borders, network, metro, muted, transit])

  // the view glides to its new frame
  useEffect(() => {
    const from = view.current
    if (!from || sameView(from, target) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      view.current = target
      drawRef.current()
      return
    }
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700)
      view.current = lerp(from, target, 1 - (1 - k) ** 3)
      drawRef.current()
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, home])

  // the wheel zooms around the pointer, a drag moves the map, like any web map
  const [moved, setMoved] = useState(false)
  const drag = useRef<{ x: number; y: number; far: boolean } | null>(null)
  useEffect(() => {
    const canvas = ref.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = view.current ?? target
      const r = canvas.getBoundingClientRect()
      const { s, ox, oy } = geo.current
      const [px, py] = [(e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s]
      // never wider than Paris, never closer than a few blocks
      const k = Math.min(Math.max(Math.exp(e.deltaY * 0.001), 0.02 / v.w), 1.4 / v.w)
      view.current = { x: px - (px - v.x) * k, y: py - (py - v.y) * k, w: v.w * k, h: v.h * k }
      setMoved(true)
      drawRef.current()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [target])

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const { s, ox, oy } = geo.current
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    let best: { d: number; cell: string; x: number; y: number } | null = null
    for (const b of outline.blocks) {
      const x = ox + b.at[0] * s
      const y = oy + b.at[1] * s
      const d = Math.hypot(x - mx, y - my)
      if (!best || d < best.d) best = { d, cell: b.cell, x, y }
    }
    // a block is about a fortieth of the city wide
    return best && best.d < s / 60 ? best : null
  }

  const value = hover ? num(hover.p, key) : null
  return (
    <div className="dash-map">
      <canvas
        ref={ref}
        role="img"
        aria-label={tr('Carte de Paris par bloc', 'Map of Paris by block')}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, far: false }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerUp={() => {
          // a click stays a click; the end of a drag does not choose a block
          window.setTimeout(() => (drag.current = null))
        }}
        onMouseMove={(e) => {
          const d = drag.current
          if (d && e.buttons === 1) {
            const [dx, dy] = [e.clientX - d.x, e.clientY - d.y]
            if (d.far || Math.hypot(dx, dy) > 4) {
              const v = view.current ?? target
              const { s } = geo.current
              view.current = { ...v, x: v.x - dx / s, y: v.y - dy / s }
              drag.current = { x: e.clientX, y: e.clientY, far: true }
              setMoved(true)
              setHover(null)
              drawRef.current()
              return
            }
          }
          const hit = pick(e)
          const p = hit && byCell.get(hit.cell)?.properties
          setHover(hit && p ? { x: hit.x, y: hit.y, p } : null)
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (drag.current?.far) return
          const hit = pick(e)
          onBlock(hit ? hit.cell : null)
        }}
        style={{ cursor: drag.current?.far ? 'grabbing' : hover ? 'pointer' : 'grab' }}
      />
      {hover && (
        <span className="dash-tip" style={{ left: hover.x, top: hover.y }}>
          {short(hover.p)}
          <span className="muted">
            {' '}
            · {layer === 'score' ? (value === null ? '–' : `${Math.round(value)} / 100`) : valueText(key, value)}
            {rings?.has(hover.p.cell) && ` · ${rings.get(hover.p.cell)} min ${tr('à pied', 'on foot')}`}
          </span>
        </span>
      )}
      {network && (
        <button className="dash-map-toggle" aria-pressed={metro} onClick={() => setMetro((m) => !m)}>
          <span className="dash-map-toggle-lines" aria-hidden="true" />
          {tr('Métro', 'Metro')}
        </button>
      )}
      {((focus && props.onAllParis) || moved) && (
        <button
          className="dash-map-reset"
          onClick={() => {
            setMoved(false)
            if (focus && props.onAllParis) props.onAllParis()
            else setHome((n) => n + 1)
          }}
        >
          {tr('Tout Paris', 'All of Paris')}
        </button>
      )}
    </div>
  )
}

