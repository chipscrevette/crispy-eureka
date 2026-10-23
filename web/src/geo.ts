import type { Grid } from './grid'

export type LonLat = [number, number]

/** Metres east and north of `origin`. Good enough at city scale. */
export function toMetres([lon, lat]: LonLat, [lon0, lat0]: LonLat): [number, number] {
  return [(lon - lon0) * 111_320 * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * 110_540]
}

export function distanceM(a: LonLat, b: LonLat) {
  const [x, y] = toMetres(a, b)
  return Math.hypot(x, y)
}

export function centroid(ring: number[][]): LonLat {
  const pts = ring.slice(0, -1)
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
}

export function cellIndex(grid: Grid) {
  return new Map(grid.features.map((f) => [f.properties.cell, f]))
}
