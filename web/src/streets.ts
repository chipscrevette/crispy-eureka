import type { FeatureCollection, LineString } from 'geojson'

export type StreetProps = { level: 1 | 2 | 3; index: number }
export type Streets = FeatureCollection<LineString, StreetProps>

/** The busiest 5% of Paris streets, from the walking network; fetched only when the layer is turned on. */
export async function loadStreets(): Promise<Streets | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/streets.geojson`)
  if (!res.ok) return null
  return res.json()
}

/** Each level's share of Paris street pieces, from footfall.MAP_LEVELS. */
const SHARE = { 1: '5%', 2: '2%', 3: '0.5%' } as const

export const streetTitle = (level: StreetProps['level']) => `Among the busiest ${SHARE[level]} of Paris streets`

/** A line's index is the least any of its pieces reaches. */
export const footfallText = (index: number) =>
  `At least ${index.toFixed(1)}× the walks past a typical Paris street`
