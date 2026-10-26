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

/** The data with its layer names in the page's language; the files carry the English ones. */
export const localData = (d: Data): Data => ({
  ...d,
  meta: { ...d.meta, features: localFeatures(d.meta.features) },
  scores: { ...d.scores, features: localFeatures(d.scores.features) },
  demand: localFeatures(d.demand),
  groups: d.groups.map((g) => ({ ...g, label: featureLabel(`demand_${g.key}`, g.label) })),
})

export const loadData = async () => localData(await loadRawData())

/** The data as the files have it, in English, for a page that switches language in place. */
export async function loadRawData(): Promise<Data> {
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
    meta,
    scores,
    catchments,
    demand: demandLayers(demand),
    groups: demand.groups,
  }
}
