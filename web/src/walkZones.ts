import { getJson } from './grid'
import type { Catchments } from './catchments'

/** Blocks reached on foot from each block, by band of minutes along streets (pipeline: adresse_pipeline.walk). */
export type WalkZones = {
  bands: number[]
  speed_m_per_min: number
  source: string
  cells: string[]
  /** For each block in `cells` order, for each band, the blocks first reached in that band. */
  zones: number[][][]
}

export const loadWalkZones = () => getJson<WalkZones>('walk_zones.json')

/** The minutes of the band in which each block is first reached on foot from a block. */
export function bandsOf(z: WalkZones, cell: string): Map<string, number> {
  const i = z.cells.indexOf(cell)
  const out = new Map<string, number>([[cell, z.bands[0]]])
  if (i < 0) return out
  z.bands.forEach((b, k) => {
    for (const j of z.zones[i][k]) if (!out.has(z.cells[j])) out.set(z.cells[j], b)
  })
  return out
}

/** Until the data build has made the zones, the 10-minute catchment stands in as the only band. */
export const fromCatchments = (c: Catchments): WalkZones => ({
  bands: [c.minutes],
  speed_m_per_min: c.speed_m_per_min,
  source: c.source,
  cells: c.cells,
  zones: c.reach.map((r) => [r]),
})
