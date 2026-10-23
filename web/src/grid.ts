import type { FeatureCollection, Polygon } from 'geojson'

export type FeatureInfo = {
  key: string
  label: string
  unit: string
  source: string
  description: string
}

export type GridMeta = { sources: string[]; features: FeatureInfo[] }

export type CellProps = { cell: string; arrondissement?: string } & Record<string, number | string | undefined>

export type Grid = FeatureCollection<Polygon, CellProps>

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${path}`)
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`)
  return res.json()
}

export const loadGrid = () => getJson<Grid>('paris_h3.geojson')
export const loadGridMeta = () => getJson<GridMeta>('features.json')

/** Upper bounds of `classes` equal-count classes over the values present in the grid. */
export function quantileBreaks(grid: Grid, key: string, classes = 5): number[] {
  const values = grid.features
    .map((f) => f.properties[key])
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b)
  if (values.length === 0) return []
  const breaks = Array.from({ length: classes - 1 }, (_, i) => values[Math.floor(((i + 1) * values.length) / classes)])
  return [...new Set(breaks)]
}

export function formatValue(value: number, unit: string): string {
  if (unit === 'share') return `${Math.round(value * 100)}%`
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  const text = rounded.toLocaleString('en-GB')
  return `${text} ${unit}`
}
