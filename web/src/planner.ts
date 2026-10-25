import { getJson } from './grid'
import type { ProfileId } from './stores'
import { locale } from './i18n'

/** One more boutique: demand it wins, what the brand's own boutiques lose, and the net. */
export type Pick = { cell: string; gross: number; cannibalised: number; gain: number }

export type BrandPlan = { boutiques: number; capture: number; picks: Pick[] }

/** Greedy plans per brand (pipeline: adresse_pipeline.planner). */
export type Planner = {
  suitable: number
  steps: number
  profiles: Record<ProfileId, { beta: number; gamma: number; candidates: number; plans: Record<string, BrandPlan> }>
}

/** Hidden-brand test of the planner and its baselines (pipeline: adresse_pipeline.backtest). */
export type Backtest = {
  within_minutes: number
  profiles: Record<ProfileId, { brands: number; boutique_blocks: number; found_percent: Record<string, number> }>
}

export const NEW_BRAND = 'A new brand'

export const loadPlanner = () => Promise.all([getJson<Planner>('planner.json'), getJson<Backtest>('backtest.json')])

/** Demand index points as average Paris blocks: the index averages 100 per block. */
export const blocksOf = (points: number) => points / 100

export function formatBlocks(points: number) {
  const v = blocksOf(points)
  return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString(locale())
}

export function profileOfBrand(p: Planner, brand: string): ProfileId | undefined {
  return (Object.keys(p.profiles) as ProfileId[]).find((id) => brand in p.profiles[id].plans)
}
