import { fmt, tr } from './i18n'
import { formatValue, type CellProps } from './grid'
import { openKey } from './dashboardData'
import { placeOf, scoreKey } from './scores'
import type { Data } from './appData'
import type { ProfileId } from './stores'
import type { LonLat } from './geo'

/** "Paris 8e Arrondissement" → "8e". */
export const short = (p: CellProps) => placeOf(p).replace(/^Paris /, '').replace(/ Arrondissement$/, '')
export const num = (p: CellProps, k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null)

/** A layer's value in words, with its unit. */
export function valueText(k: string, v: number | null) {
  if (v === null) return '–'
  if (k.startsWith('score')) return `${Math.round(v)} / 100`
  if (k === 'demand') return `${fmt(v / 100, 1)}×`
  if (k === 'street_footfall') return `${fmt(v, 1)}×`
  if (k === 'transit_entries_r2') return `${fmt(v / 1000)}k / ${tr('jour', 'day')}`
  if (k === 'commercial_price_m2') return `${fmt(v)} € / m²`
  if (k.startsWith('luxury')) return formatValue(v, 'boutiques')
  if (k === 'upscale_rooms_r1') return formatValue(v, 'rooms')
  return formatValue(v, 'places')
}


/** A station placed in its block, with where it stands. */
export type Placed = { p: { name: string; entries: number; lines?: string[] }; cell: string; at?: LonLat }

/**
 * What is within the walk of the chosen block: free spots, boutiques of the type and their brands,
 * stations with their daily entries, spending and the busiest street. Counts come from points placed
 * in blocks, never from the blocks' own neighbourhood sums, so nothing is counted twice.
 */
export function zoneStats(data: Data, profile: ProfileId, zone: Set<string>, placed: Map<string, string>, stations: Placed[]) {
  const key = scoreKey(profile)
  const blocks = data.grid.features.map((f) => f.properties).filter((p) => zone.has(p.cell))
  const brands = new Map<string, number>()
  for (const f of data.stores.features) {
    const at = placed.get(f.properties.id)
    if (f.properties.profile === profile && at && zone.has(at)) brands.set(f.properties.brand, (brands.get(f.properties.brand) ?? 0) + 1)
  }
  const near = stations.filter((s) => zone.has(s.cell)).sort((a, b) => b.p.entries - a.p.entries)
  const spend = blocks.map((p) => num(p, 'demand')).filter((v): v is number => v !== null)
  return {
    blocks: blocks.length,
    free: blocks.filter((p) => p[openKey(key)] === 1).length,
    brands,
    boutiques: [...brands.values()].reduce((a, b) => a + b, 0),
    near,
    entries: near.reduce((a, s) => a + s.p.entries, 0),
    spendAvg: spend.length ? spend.reduce((a, b) => a + b, 0) / spend.length : null,
    busiest: Math.max(0, ...blocks.map((p) => num(p, 'street_footfall') ?? 0)),
  }
}

export const kilo = (n: number) => (n >= 1000 ? `${fmt(n / 1000)}k` : fmt(n))
