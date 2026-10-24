import type { Grid } from './grid'

/** One bar of the "by arrondissement" chart. */
export type AreaBar = { name: string; value: number; text: string; cells: string[] }
/** One row of the top-blocks list. */
export type TopBlock = { cell: string; place: string; text: string; detail: string }
export type Slice = { label: string; share: number }

const short = (a: string) => a.replace(/^Paris /, '').replace(/ Arrondissement$/, '')

/**
 * The arrondissements ranked on the map's layer. For the luxury potential it counts the blocks
 * in the top tenth of Paris; for any other layer it averages the blocks' values.
 */
export function areaBars(grid: Grid, key: string, isScore: boolean, format: (v: number) => string): AreaBar[] {
  const groups = new Map<string, { sum: number; n: number; cells: string[] }>()
  for (const f of grid.features) {
    const a = f.properties.arrondissement
    const v = f.properties[key]
    if (!a || typeof v !== 'number') continue
    const g = groups.get(a) ?? { sum: 0, n: 0, cells: [] }
    g.sum += isScore ? (v >= 90 ? 1 : 0) : v
    g.n += 1
    g.cells.push(f.properties.cell)
    groups.set(a, g)
  }
  return [...groups.entries()]
    .map(([name, g]) => {
      const value = isScore ? g.sum : g.sum / g.n
      return { name: short(name), value, text: isScore ? String(value) : format(value), cells: g.cells }
    })
    .sort((x, y) => y.value - x.value || x.name.localeCompare(y.name))
    .slice(0, 6)
}

/** The blocks with the highest value on the layer; ties go to the block with more spending demand. */
export function topBlocks(grid: Grid, key: string, format: (v: number) => string, n = 5): TopBlock[] {
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
 * boutique around it yet, people with money to spend, and shops on the street already.
 */
export const OPEN_RULE = { score: 85, spending: 100, shops: 20 }
// catalogue boutiques of each profile in the block and its six neighbours, the same as the map's dots
export const LUXURY = ['luxury_jewellery-watches_r1', 'luxury_fashion-house_r1', 'luxury_beauty_r1']
export const openKey = (key: string) => `open_${key}`

/** Marks every block with open_<score key> = 1 or 0, for each profile's score key. */
export function withOpenSpaces(grid: Grid, keys: string[]): Grid {
  for (const f of grid.features) {
    const p = f.properties
    const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : 0)
    const base =
      LUXURY.every((k) => num(k) === 0) &&
      num('demand') >= OPEN_RULE.spending &&
      num('fashion_stores_r1') + num('beauty_stores_r1') >= OPEN_RULE.shops
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
