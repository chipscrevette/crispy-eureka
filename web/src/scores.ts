import { formatValue, type CellProps, type FeatureInfo, type Grid } from './grid'
import type { ProfileId } from './stores'
import { lang, tr } from './i18n'

/** [feature key, SHAP contribution in log-odds, the cell's value] */
export type Driver = [string, number, number | null]

type Validation = { mean_percentile: number; top10_hit_rate: number; held_out_cells: number }

export const NEIGHBOURS = 'luxury_neighbours_r1'

export type Scores = {
  positives: string
  features: FeatureInfo[]
  profiles: Record<ProfileId, { boutique_cells: number; cells: Record<string, [number, Driver[]]> }>
  validation: Record<ProfileId, Record<'model' | 'luxury neighbours' | 'apartment price', Validation>>
  [NEIGHBOURS]: Record<string, number>
  importance: Record<ProfileId, [string, number][]>
  validation_setup: { folds: number; positives: string }
}

/** Score classes on the map: the top half, quarter, tenth and twentieth of Paris. */
export const SCORE_BREAKS = [50, 75, 90, 95]

export const scoreKey = (profile: ProfileId) => `score_${profile}`

export async function loadScores(): Promise<Scores> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/scores.json`)
  if (!res.ok) throw new Error(`Could not load scores (HTTP ${res.status})`)
  return res.json()
}

/** Copies every profile's score and the luxury-neighbour count onto the grid cells. */
export function withScores(grid: Grid, scores: Scores): Grid {
  return {
    ...grid,
    features: grid.features.map((f) => {
      const props: CellProps = { ...f.properties, [NEIGHBOURS]: scores[NEIGHBOURS][f.properties.cell] }
      for (const [profile, s] of Object.entries(scores.profiles)) {
        const cell = s.cells[f.properties.cell]
        if (cell) props[scoreKey(profile as ProfileId)] = cell[0]
      }
      return { ...f, properties: props }
    }),
  }
}

/** 1st, 2nd… in English; 1er, 2e… in French. */
export function ordinal(n: number) {
  const r = Math.round(n)
  if (lang() === 'fr') return r === 1 ? '1er' : `${r}e`
  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' }
  const suffix = r % 100 >= 11 && r % 100 <= 13 ? 'th' : (suffixes[r % 10] ?? 'th')
  return `${r}${suffix}`
}

export const placeOf = (p: CellProps) => p.arrondissement ?? 'Paris'
/** "Paris 1er Arrondissement" → "1er arr." for tight spaces. */
export const shortPlaceOf = (p: CellProps) =>
  placeOf(p)
    .replace(/^Paris /, '')
    .replace(/ Arrondissement$/, ' arr.')

export function cellScore(scores: Scores, profile: ProfileId, cell: string): [number, Driver[]] | undefined {
  return scores.profiles[profile].cells[cell]
}

export function describeValue(scores: Scores, key: string, value: number | string | null | undefined) {
  const f = scores.features.find((x) => x.key === key)
  return {
    label: f?.label ?? key,
    description: f?.description,
    text: typeof value === 'number' ? formatValue(value, f?.unit ?? '') : tr('pas de donnée', 'no data'),
  }
}

/** Plain-English rank: a percentile score of 100 is the top block, not "higher than 100%". */
export const rankText = (score: number) =>
  score >= 99.5
    ? tr('est dans le top 1 % de Paris', 'is in the top 1% of Paris')
    : tr(`fait mieux que ${Math.round(score)} % de Paris`, `scores higher than ${Math.round(score)}% of Paris`)
