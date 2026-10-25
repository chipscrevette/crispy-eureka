import { quantileBreaks, type Grid } from './grid'
import { coloursOf, rampFor } from './palette'
import { SCORE_BREAKS, scoreKey } from './scores'
import type { ProfileId } from './stores'
import { tr } from './i18n'

/** The nine maps of the atlas: what the big map can show, each in its own colour. */
export const ATLAS = [
  { id: 'score', label: tr('Potentiel', 'Potential'), note: tr('Ressemble aux adresses du luxe', 'Looks like where luxury succeeds') },
  { id: 'demand', label: tr('Pouvoir d’achat', 'Spending'), note: tr('Habitants, actifs, clients d’hôtel', 'Residents, workers, hotel guests') },
  { id: 'street_footfall', label: tr('Passage', 'Footfall'), note: tr('Piétons sur le trottoir', 'People on the pavement') },
  { id: 'transit_entries_r2', label: tr('Gares', 'Stations'), note: tr('Entrées métro et RER par jour', 'Metro and RER entries a day') },
  { id: 'fashion_stores_r1', label: tr('Boutiques de mode', 'Fashion shops'), note: tr('Toutes les boutiques de mode autour', 'All fashion stores around') },
  { id: 'luxury', label: tr('Luxe déjà là', 'Luxury already'), note: tr('Boutiques de ce type autour', 'Boutiques of this type around') },
  { id: 'upscale_rooms_r1', label: tr('Hôtels', 'Hotels'), note: tr('Chambres haut de gamme autour', 'Upscale hotel rooms around') },
  { id: 'offices_r1', label: tr('Bureaux', 'Offices'), note: tr('Entreprises autour', 'Companies around') },
  { id: 'commercial_price_m2', label: tr('Prix des boutiques', 'Shop prices'), note: tr('Prix des locaux au m²', 'Price of shops per m²') },
] as const

/** The grid property a layer reads; potential and luxury depend on the type of brand. */
export function atlasKey(id: string, profile: ProfileId) {
  if (id === 'score') return scoreKey(profile)
  if (id === 'luxury') return `luxury_${profile}_r1`
  return id
}

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Colour of each block on one layer, with the same classes as the big map; empty blocks stay neutral. */
export function fills(grid: Grid, key: string, isScore: boolean): Map<string, string | null> {
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
