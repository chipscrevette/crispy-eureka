import type { FeatureCollection, Point } from 'geojson'

export type StationProps = { name: string; entries: number }
export type Stations = FeatureCollection<Point, StationProps> & { period: string }

/** Rail stations with their average daily entries (Île-de-France Mobilités); null until the data build has made them. */
export async function loadStations(): Promise<Stations | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/stations.geojson`)
  if (!res.ok) return null
  return res.json()
}

export const entriesText = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k entries a day` : `${Math.round(n)} entries a day`
