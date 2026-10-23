import type { FeatureInfo, Grid } from './grid'
import type { ProfileId } from './stores'

/** [feature key, SHAP contribution in log-odds, the cell's value] */
export type Driver = [string, number, number | null]

type Validation = {
  mean_percentile: number
  top10_hit_rate: number
  held_out_cells: number
}

export type Scores = {
  positives: string
  features: FeatureInfo[]
  profiles: Record<ProfileId, { boutique_cells: number; cells: Record<string, [number, Driver[]]> }>
  validation: Record<ProfileId, Record<'model' | 'luxury neighbours' | 'apartment price', Validation>>
}

/** Score classes on the map: the top half, quarter, tenth and twentieth of Paris. */
export const SCORE_BREAKS = [50, 75, 90, 95]

export const scoreKey = (profile: ProfileId) => `score_${profile}`

export async function loadScores(): Promise<Scores> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/scores.json`)
  if (!res.ok) throw new Error(`Could not load scores (HTTP ${res.status})`)
  return res.json()
}

/** Copies every profile's score onto the grid cells, so the map can style by it. */
export function withScores(grid: Grid, scores: Scores): Grid {
  return {
    ...grid,
    features: grid.features.map((f) => {
      const props = { ...f.properties }
      for (const [profile, s] of Object.entries(scores.profiles)) {
        const cell = s.cells[f.properties.cell]
        if (cell) props[scoreKey(profile as ProfileId)] = cell[0]
      }
      return { ...f, properties: props }
    }),
  }
}
