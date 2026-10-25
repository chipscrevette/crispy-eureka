import type { Grid } from './grid'

/** One row of the top-blocks list. */
export type TopBlock = { cell: string; place: string; text: string; detail: string }

const short = (a: string) => a.replace(/^Paris /, '').replace(/ Arrondissement$/, '')

/** The blocks with the highest value on the layer; ties go to the block with more spending demand. */
function topBlocks(grid: Grid, key: string, format: (v: number) => string, n = 5): TopBlock[] {
  return grid.features
    .filter((f) => typeof f.properties[key] === 'number')
    .sort(
      (x, y) =>
        (y.properties[key] as number) - (x.properties[key] as number) ||
        ((y.properties.demand as number) ?? 0) - ((x.properties.demand as number) ?? 0),
    )
    .slice(0, n)
    .map((f) => ({
      cell: f.properties.cell,
      place: short(f.properties.arrondissement ?? 'Paris'),
      text: format(f.properties[key] as number),
      detail: typeof f.properties.demand === 'number' ? `spending ${Math.round(f.properties.demand)}` : '',
    }))
}

/** The best block of each of the best arrondissements, so a first look spreads across Paris. */
export function bestPlaces(grid: Grid, key: string, n = 3): TopBlock[] {
  const seen = new Set<string>()
  const out: TopBlock[] = []
  for (const b of topBlocks(grid, key, (v) => `${Math.round(v)}`, grid.features.length)) {
    if (seen.has(b.place)) continue
    seen.add(b.place)
    out.push(b)
    if (out.length === n) break
  }
  return out
}

/**
 * An open space: a block that looks like where the brand type already is, but has no luxury
 * boutique around it yet, people with money to spend, shops on the street already, an empty
 * shopfront of 300 m² or more to move into, and a healthy street: no more of its shopfronts
 * empty than in three quarters of Paris (Apur's census of ground floors).
 */
export const OPEN_RULE = { score: 85, spending: 100, shops: 20, bigEmpty: 1, weakStreet: 0.75 }
export const EMPTY = 'vacant_shops_r1'
export const BIG_EMPTY = 'large_vacant_r1'
export const VACANCY = 'vacancy_r1'
export const WEAK_KEY = 'weak_street'

/** The empty-shopfront share above which a street counts as weak: Paris's top quarter. */
function weakAbove(grid: Grid): number {
  const v = grid.features
    .map((f) => f.properties[VACANCY])
    .filter((x): x is number => typeof x === 'number')
    .sort((a, b) => a - b)
  return v.length ? v[Math.floor(OPEN_RULE.weakStreet * (v.length - 1))] : Infinity
}
// catalogue boutiques of each profile in the block and its six neighbours, the same as the map's dots
export const LUXURY = ['luxury_jewellery-watches_r1', 'luxury_fashion-house_r1', 'luxury_beauty_r1']
export const openKey = (key: string) => `open_${key}`

/** Marks every block with open_<score key> = 1 or 0, for each profile's score key. */
export function withOpenSpaces(grid: Grid, keys: string[]): Grid {
  const weak = weakAbove(grid)
  for (const f of grid.features) {
    const p = f.properties
    const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : 0)
    const base =
      LUXURY.every((k) => num(k) === 0) &&
      num('demand') >= OPEN_RULE.spending &&
      num('fashion_stores_r1') + num('beauty_stores_r1') >= OPEN_RULE.shops &&
      num(BIG_EMPTY) >= OPEN_RULE.bigEmpty &&
      num(VACANCY) <= weak
    p[WEAK_KEY] = num(VACANCY) > weak ? 1 : 0
    for (const k of keys) p[openKey(k)] = base && num(k) >= OPEN_RULE.score ? 1 : 0
  }
  return grid
}

/** The best open space of each arrondissement, best first. */
export function openPlaces(grid: Grid, key: string, n = 3): TopBlock[] {
  const open = { ...grid, features: grid.features.filter((f) => f.properties[openKey(key)] === 1) }
  return bestPlaces(open, key, n)
}

export const countOpen = (grid: Grid, key: string) =>
  grid.features.filter((f) => f.properties[openKey(key)] === 1).length
