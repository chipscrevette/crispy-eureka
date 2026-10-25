import { useEffect, useId, useState } from 'react'
import type { LonLat } from './geo'
import { tr } from './i18n'

/** France's national address search (Base Adresse Nationale, served by IGN's Géoplateforme). */
const GEOCODER = 'https://data.geopf.fr/geocodage/search'
const PARIS_CITY = '751' // INSEE codes of the 20 arrondissements

export type Address = { label: string; at: LonLat }

type Feature = { geometry: { coordinates: LonLat }; properties: { label: string; citycode: string } }

async function search(q: string, signal: AbortSignal): Promise<Address[]> {
  const url = `${GEOCODER}?${new URLSearchParams({ q, limit: '8', lat: '48.8566', lon: '2.3422' })}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Address search failed (HTTP ${res.status})`)
  const body: { features: Feature[] } = await res.json()
  return body.features
    .filter((f) => f.properties.citycode.startsWith(PARIS_CITY))
    .slice(0, 5)
    .map((f) => ({ label: f.properties.label, at: f.geometry.coordinates }))
}

export default function Search({ onFound }: { onFound: (a: Address) => void }) {
  const id = useId()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Address[]>([])
  const [active, setActive] = useState(-1)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (q.trim().length < 3) {
      setHits([])
      setStatus('')
      return
    }
    const ctrl = new AbortController()
    const t = window.setTimeout(() => {
      search(q, ctrl.signal).then(
        (found) => {
          setHits(found)
          setActive(-1)
          setStatus(
            found.length
              ? tr(`${found.length} adresses à Paris`, `${found.length} addresses in Paris`)
              : tr('Aucune adresse trouvée à Paris', 'No address found in Paris'),
          )
        },
        (e: Error) =>
          e.name !== 'AbortError' &&
          setStatus(tr('La recherche d’adresse est indisponible pour le moment', 'Address search is unavailable right now')),
      )
    }, 250)
    return () => {
      window.clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  const choose = (a: Address) => {
    onFound(a)
    setQ('')
    setHits([])
    setStatus('')
  }

  return (
    <div className="search">
      <label htmlFor={`${id}-q`} className="visually-hidden">
        {tr('Chercher une adresse à Paris', 'Search a Paris address')}
      </label>
      <input
        id={`${id}-q`}
        type="search"
        placeholder={tr('Chercher une adresse à Paris', 'Search a Paris address')}
        autoComplete="off"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && hits.length) {
            e.preventDefault()
            setActive((i) => (i + 1) % hits.length)
          } else if (e.key === 'ArrowUp' && hits.length) {
            e.preventDefault()
            setActive((i) => (i <= 0 ? hits.length - 1 : i - 1))
          } else if (e.key === 'Enter' && hits.length) {
            e.preventDefault()
            choose(hits[Math.max(active, 0)])
          } else if (e.key === 'Escape') {
            setHits([])
          }
        }}
      />
      {hits.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="search-hits">
          {hits.map((h, i) => (
            <li
              key={h.label}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(h)
              }}
            >
              {h.label}
            </li>
          ))}
        </ul>
      )}
      <p className="visually-hidden" aria-live="polite">
        {status}
      </p>
      {status && !hits.length && <p className="muted small search-status">{status}</p>}
    </div>
  )
}
