import { useMemo } from 'react'
import { quantileBreaks, type Grid } from './grid'
import { coloursOf, rampFor } from './palette'
import { SCORE_BREAKS, scoreKey } from './scores'
import type { ProfileId } from './stores'
import { tr } from './i18n'

/** The nine maps of the atlas: what the big map can show, each in its own colour. */
export const ATLAS = [
  { id: 'score', get label() { return tr('Potentiel', 'Potential') }, get note() { return tr('Ressemble aux adresses du luxe', 'Looks like where luxury succeeds') } },
  { id: 'demand', get label() { return tr('Pouvoir d’achat', 'Spending') }, get note() { return tr('Habitants, actifs, clients d’hôtel', 'Residents, workers, hotel guests') } },
  { id: 'street_footfall', get label() { return tr('Passage', 'Footfall') }, get note() { return tr('Piétons sur le trottoir', 'People on the pavement') } },
  { id: 'transit_entries_r2', get label() { return tr('Gares', 'Stations') }, get note() { return tr('Entrées métro et RER par jour', 'Metro and RER entries a day') } },
  { id: 'fashion_stores_r1', get label() { return tr('Boutiques de mode', 'Fashion shops') }, get note() { return tr('Toutes les boutiques de mode autour', 'All fashion stores around') } },
  { id: 'luxury', get label() { return tr('Luxe déjà là', 'Luxury already') }, get note() { return tr('Boutiques de ce type autour', 'Boutiques of this type around') } },
  { id: 'upscale_rooms_r1', get label() { return tr('Hôtels', 'Hotels') }, get note() { return tr('Chambres haut de gamme autour', 'Upscale hotel rooms around') } },
  { id: 'offices_r1', get label() { return tr('Bureaux', 'Offices') }, get note() { return tr('Entreprises autour', 'Companies around') } },
  { id: 'commercial_price_m2', get label() { return tr('Prix des boutiques', 'Shop prices') }, get note() { return tr('Prix des locaux au m²', 'Price of shops per m²') } },
] as const

/** The grid property a layer reads; potential and luxury depend on the type of brand. */
export function atlasKey(id: string, profile: ProfileId) {
  if (id === 'score') return scoreKey(profile)
  if (id === 'luxury') return `luxury_${profile}_r1`
  return id
}

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** The colour a value takes on one layer, with the same classes as the big map; null for empty blocks. */
export function shadeOf(grid: Grid, key: string, isScore: boolean): (v: unknown) => string | null {
  const colours = coloursOf(rampFor(key))
  const breaks = isScore ? SCORE_BREAKS : quantileBreaks(grid, key)
  return (v) => {
    if (typeof v !== 'number' || v <= 0 || (isScore && v < SCORE_BREAKS[0])) return null
    const c = breaks.filter((b) => v >= b).length
    return colours[Math.min(c, colours.length - 1)]
  }
}

/** Colour of each block on one layer; empty blocks stay neutral. */
export function fills(grid: Grid, key: string, isScore: boolean): Map<string, string | null> {
  const shade = shadeOf(grid, key, isScore)
  return new Map(grid.features.map((f) => [f.properties.cell, shade(f.properties[key])]))
}

/** Sizes a canvas to its box at the screen's sharpness (at most 2x) and returns a context drawing in CSS pixels. */
export function sizeCanvas(canvas: HTMLCanvasElement) {
  const r = Math.min(window.devicePixelRatio || 1, 2)
  const { width, height } = canvas.getBoundingClientRect()
  canvas.width = Math.round(width * r)
  canvas.height = Math.round(height * r)
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(r, 0, 0, r, 0, 0)
  return { ctx, width, height }
}

type Projected = { cell: string; ring: [number, number][]; at: [number, number] }

/** Every block's outline in 0..1 x 0..1/aspect, north up, so each canvas only scales it. */
export function useOutline(grid: Grid) {
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
    return { blocks, aspect: (y1 - y0) / w, project: p }
  }, [grid])
}
