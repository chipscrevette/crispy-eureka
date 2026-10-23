import type { FeatureCollection, Point } from 'geojson'

export const PROFILES = [
  { id: 'jewellery-watches', label: 'Jewellery & watches' },
  { id: 'fashion-house', label: 'Fashion house' },
  { id: 'beauty', label: 'Beauty' },
] as const

export type ProfileId = (typeof PROFILES)[number]['id']

export type StoreProps = {
  id: string
  brand: string
  segment: string
  osm_confirmed?: boolean
  profile: ProfileId
  name: string | null
}

export type Stores = FeatureCollection<Point, StoreProps> & {
  metadata: { source: string; license: string }
}

export async function loadStores(): Promise<Stores> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/luxury_stores.geojson`)
  if (!res.ok) throw new Error(`Could not load boutiques (HTTP ${res.status})`)
  return res.json()
}

export function countByProfile(stores: Stores): Record<ProfileId, number> {
  const counts = Object.fromEntries(PROFILES.map((p) => [p.id, 0])) as Record<ProfileId, number>
  for (const f of stores.features) counts[f.properties.profile] += 1
  return counts
}
