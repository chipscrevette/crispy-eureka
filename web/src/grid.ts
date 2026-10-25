import type { FeatureCollection, Polygon } from 'geojson'
import { locale, unitLabel } from './i18n'

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

export async function getJson<T>(path: string): Promise<T> {
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
  const breaks = equalCount(values, classes)
  // when the lowest value fills the first class (most blocks have no tourist zone, no hotel),
  // give it a class of its own and split the rest, otherwise it would share a colour with them
  if (breaks[0] !== values[0]) return breaks
  const above = values.filter((v) => v > values[0])
  return above.length ? [...new Set([above[0], ...equalCount(above, classes - 1)])] : []
}

function equalCount(sorted: number[], classes: number): number[] {
  const breaks = Array.from({ length: classes - 1 }, (_, i) => sorted[Math.floor(((i + 1) * sorted.length) / classes)])
  return [...new Set(breaks)]
}

export function formatValue(value: number, unit: string): string {
  // French puts a space before the percent sign
  if (unit === 'share') return `${Math.round(value * 100)}${locale() === 'fr-FR' ? ' %' : '%'}`
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded.toLocaleString(locale())} ${unitLabel(unit)}`
}
