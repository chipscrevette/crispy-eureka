import { PROFILES, loadStores, type Stores } from './stores'
import { loadGrid, loadGridMeta, type FeatureInfo, type Grid, type GridMeta } from './grid'
import { loadScores, scoreKey, withScores, type Scores } from './scores'
import { loadCatchments, type Catchments } from './catchments'
import { demandLayers, loadDemand, withDemand, type Demand } from './demand'
import { withOpenSpaces } from './dashboardData'
import { featureLabel, localFeatures } from './i18n'

/** Everything the map and the dashboard read, in the visitor's language. */
export type Data = {
  stores: Stores
  grid: Grid
  meta: GridMeta
  scores: Scores
  catchments: Catchments
  demand: FeatureInfo[]
  groups: Demand['groups']
}

export async function loadData(): Promise<Data> {
  const [stores, grid, meta, scores, catchments, demand] = await Promise.all([
    loadStores(),
    loadGrid(),
    loadGridMeta(),
    loadScores(),
    loadCatchments(),
    loadDemand(),
  ])
  return {
    stores,
    grid: withOpenSpaces(
      withDemand(withScores(grid, scores), demand),
      PROFILES.map((p) => scoreKey(p.id)),
    ),
    meta: { ...meta, features: localFeatures(meta.features) },
    scores: { ...scores, features: localFeatures(scores.features) },
    catchments,
    demand: localFeatures(demandLayers(demand)),
    groups: demand.groups.map((g) => ({ ...g, label: featureLabel(`demand_${g.key}`, g.label) })),
  }
}
