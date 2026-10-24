import { getJson, type FeatureInfo, type Grid } from './grid'

/** Spending potential per block (pipeline: adresse_pipeline.demand). */
export type Demand = {
  weights: Record<string, number>
  groups: { key: string; label: string; inputs: string }[]
  scale: string
  sources: string[]
  top: number
  sensitivity: { weights: string; rank_correlation: number; top_overlap: number }[]
  /** Order of the values in `cells`: one per group, then the combined index. */
  columns: string[]
  cells: Record<string, number[]>
}

export const DEMAND = 'demand'
const UNIT = '(Paris average 100)'

export const loadDemand = () => getJson<Demand>('demand.json')

const keyOf = (column: string) => (column === DEMAND ? DEMAND : `demand_${column}`)

/** Map layers for the demand index and each of its groups. */
export function demandLayers(d: Demand): FeatureInfo[] {
  return [
    {
      key: DEMAND,
      label: 'Spending demand',
      unit: UNIT,
      source: 'INSEE Filosofi, INSEE Sirene, Overture Maps',
      description: `Residents' income, workers and visitors within the block, one third each`,
    },
    ...d.groups.map((g) => ({
      key: keyOf(g.key),
      label: g.label,
      unit: UNIT,
      source: g.inputs,
      description: `${g.label} within the block`,
    })),
  ]
}

export function withDemand(grid: Grid, d: Demand): Grid {
  return {
    ...grid,
    features: grid.features.map((f) => {
      const values = d.cells[f.properties.cell]
      if (!values) return f
      const extra = Object.fromEntries(d.columns.map((c, i) => [keyOf(c), values[i]]))
      return { ...f, properties: { ...f.properties, ...extra } }
    }),
  }
}
