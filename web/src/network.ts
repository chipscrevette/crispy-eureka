import type { FeatureCollection, LineString, MultiLineString } from 'geojson'

/** One metro or RER line in its official colour (pipeline: adresse_pipeline.network). */
export type LineProps = { mode: 'metro' | 'rer'; line: string; colour: string; text: string }
export type Network = FeatureCollection<LineString | MultiLineString, LineProps>

export async function loadNetwork(): Promise<Network | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/network.geojson`)
  if (!res.ok) return null
  return res.json()
}

/** The station file names lines "3bis" and "RER B"; the network file "3B", and "B" with mode rer. */
export const lineName = (p: LineProps) => (p.mode === 'rer' ? `RER ${p.line}` : p.line.replace(/B$/, 'bis'))

export type LineColours = Map<string, { colour: string; text: string }>

export const lineColours = (n: Network): LineColours =>
  new Map(n.features.map((f) => [lineName(f.properties), { colour: f.properties.colour, text: f.properties.text }]))

/**
 * A line's badge, in its colour: a circle with the number for the metro, a rounded square with the
 * letter for the RER. Our own shapes, not the operator's logos.
 */
export function badgeHtml(name: string, colours: LineColours) {
  const c = colours.get(name)
  if (!c) return ''
  const rer = name.startsWith('RER ')
  const label = rer ? name.slice(4) : name.replace('bis', 'b')
  return `<span class="line-badge${rer ? ' rer' : ''}" style="background:${c.colour};color:${c.text}">${label}</span>`
}
