import { scoreKey } from './scores'
import type { ProfileId } from './stores'

/** The nine maps of the atlas: what the big map can show, each in its own colour. */
export const ATLAS = [
  { id: 'score', label: 'Potential', note: 'Looks like where luxury succeeds' },
  { id: 'demand', label: 'Spending', note: 'Residents, workers, hotel guests' },
  { id: 'street_footfall', label: 'Footfall', note: 'People on the pavement' },
  { id: 'transit_entries_r2', label: 'Stations', note: 'Metro and RER entries a day' },
  { id: 'fashion_stores_r1', label: 'Fashion shops', note: 'All fashion stores around' },
  { id: 'luxury', label: 'Luxury already', note: 'Boutiques of this type around' },
  { id: 'upscale_rooms_r1', label: 'Hotels', note: 'Upscale hotel rooms around' },
  { id: 'offices_r1', label: 'Offices', note: 'Companies around' },
  { id: 'commercial_price_m2', label: 'Shop prices', note: 'Price of shops per m²' },
] as const

/** The grid property a layer reads; potential and luxury depend on the type of brand. */
export function atlasKey(id: string, profile: ProfileId) {
  if (id === 'score') return scoreKey(profile)
  if (id === 'luxury') return `luxury_${profile}_r1`
  return id
}
