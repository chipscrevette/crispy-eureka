import type { FeatureCollection, LineString } from 'geojson'

export type StreetProps = { level: 1 | 2 | 3; index: number }
export type Streets = FeatureCollection<LineString, StreetProps>

/** The busiest 5% of Paris street pieces, from the walking network; fetched only when the layer is turned on. */
export async function loadStreets(): Promise<Streets | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/streets.geojson`)
  if (!res.ok) return null
  return res.json()
}

export const footfallText = (index: number) =>
  `About ${index.toFixed(1)}× the walks past a typical Paris street`
