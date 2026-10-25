import type { FeatureCollection, Polygon } from 'geojson'

/** An arrondissement carries its number and where to print it; the city's outline carries `city`. */
export type BorderProps = { n?: number; label?: [number, number]; city?: true }
export type Borders = FeatureCollection<Polygon, BorderProps>

/** The 20 arrondissements and the city's edge (pipeline: overture.arrondissements_geojson); the map works without them. */
export async function loadBorders(): Promise<Borders | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/arrondissements.geojson`)
  if (!res.ok) return null
  return res.json()
}

const signedArea = (ring: number[][]) =>
  ring.reduce((s, [x, y], i) => {
    const [x2, y2] = ring[(i + 1) % ring.length]
    return s + x * y2 - x2 * y
  }, 0)

/**
 * The world with Paris cut out, to fade everything beyond the city. MapLibre reads a ring wound
 * like the outer one as a second polygon, so the hole is turned the other way when it needs to be.
 */
export function outsideParis(borders: Borders): Polygon | null {
  const city = borders.features.find((f) => f.properties.city)
  if (!city) return null
  const world = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ]
  const hole = city.geometry.coordinates[0]
  const turned = Math.sign(signedArea(hole)) === Math.sign(signedArea(world)) ? [...hole].reverse() : hole
  return { type: 'Polygon', coordinates: [world, turned] }
}
