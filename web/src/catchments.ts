import { getJson } from './grid'

/** Blocks within a walk of each block, along streets (pipeline: adresse_pipeline.walk). */
export type Catchments = {
  minutes: number
  speed_m_per_min: number
  source: string
  cells: string[]
  /** For each block in `cells` order, the indexes of the blocks within `minutes`. */
  reach: number[][]
}

export const loadCatchments = () => getJson<Catchments>('catchments.json')

export function reachOf(c: Catchments, cell: string): string[] {
  const i = c.cells.indexOf(cell)
  return i < 0 ? [] : c.reach[i].map((j) => c.cells[j])
}
