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

/** The blocks within `minutes` of a block; the bands nest, so a zone is every band up to it. */
export function zoneOf(z: WalkZones, cell: string, minutes: number): Set<string> {
  const i = z.cells.indexOf(cell)
  if (i < 0) return new Set([cell])
  const out = new Set<string>()
  z.bands.forEach((b, k) => {
    if (b <= minutes) for (const j of z.zones[i][k]) out.add(z.cells[j])
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
