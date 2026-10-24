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
