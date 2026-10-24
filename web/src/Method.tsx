import { useEffect, useRef, useState } from 'react'
import type { GridMeta } from './grid'
import { describeValue, ordinal, type Scores } from './scores'
import { PROFILES, countByProfile, type Stores } from './stores'

type Props = { scores: Scores; stores: Stores; meta: GridMeta; cells: number; onClose: () => void }

const REPO = 'https://github.com/chipscrevette/crispy-eureka'

export default function Method({ scores, stores, meta, cells, onClose }: Props) {
  const page = useRef<HTMLDivElement>(null)
  useEffect(() => {
    page.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const counts = countByProfile(stores)
  const brands = new Set(stores.features.map((f) => f.properties.brand)).size
  const sizes = PROFILES.map((p) => scores.validation[p.id].model.held_out_cells)
  const heldOut = { min: Math.min(...sizes), max: Math.max(...sizes) }

  return (
    <div className="method" role="dialog" aria-modal="true" aria-labelledby="method-title" tabIndex={-1} ref={page}>
      <div className="method-bar">
        <span className="label">Adresse · How it works</span>
        <button className="button secondary" onClick={onClose}>
          Back to the map
        </button>
      </div>

      <article>
        <header>
          <h1 id="method-title">How Adresse scores a street</h1>
          <p className="lede">
            No one publishes boutique sales. So Adresse learns from where luxury brands have already chosen to be, and
            scores every block of Paris by how closely it resembles those choices.
          </p>
        </header>

        <section>
          <h2>1. Paris as {cells.toLocaleString('en-GB')} blocks</h2>
          <p>
            The city is cut into hexagons of the H3 grid at resolution 9, each about 0.1 km², roughly a street block.
            Every number in the app belongs to one of these blocks, so data from very different sources can be compared
            like for like.
          </p>
        </section>

        <section>
          <h2>2. Where luxury already is</h2>
          <p>
            A catalogue of luxury brands is matched against Overture Maps places, then cross-checked with OpenStreetMap.
            Concessions inside department stores are left out, because they are not a street location choice. That
            leaves <strong>{stores.features.length} street boutiques</strong> from {brands} brands:
          </p>
          <ul className="method-counts">
            {PROFILES.map((p) => (
              <li key={p.id}>
                <span className="big">{counts[p.id]}</span>
                <span className="muted">{p.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>3. What the model can see</h2>
          <p>Each block is described by the same facts, most of them summed over the block and its six neighbours.</p>
          <table className="method-table">
            <thead>
              <tr>
                <th scope="col">Fact</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {scores.features.map((f) => (
                <tr key={f.key}>
                  <th scope="row">
                    {f.label}
                    <span className="muted small">{f.description}</span>
                  </th>
                  <td className="muted small">{f.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>4. The model</h2>
          <p>
            For each brand profile, a gradient-boosted model (LightGBM) learns to tell the blocks that hold a boutique
            from all the others. The blocks without one are not “bad”, just unlabelled: some are simply places no brand
            has tried yet. That is exactly what the score looks for. The raw output is turned into a rank, so a score of
            90 means the block resembles the chosen places more than 90% of Paris does.
          </p>
          <p>
            One trap is avoided on purpose: a block's own boutiques are never among its inputs. Only the luxury
            boutiques in the six surrounding blocks count, otherwise the model would just learn to find the answers.
          </p>
        </section>

        <section>
          <h2>5. Does it work?</h2>
          <p>
            The test hides whole brands. The model is trained {scores.validation_setup.folds} times, each time without a
            fifth of the brands, and then asked to rank Paris. If it has learned something real, the hidden brands'
            boutiques should land near the top. Two simple rules are scored the same way, to show what the model adds.
          </p>
          <ValidationChart scores={scores} />
          <p>
            For fashion and beauty, the model clearly beats both rules. For jewellery and watches it does not: those
            houses cluster so tightly around Place Vendôme and rue de la Paix that “open next to the others” is very
            hard to beat. The test sets are small ({heldOut.min} to {heldOut.max} blocks per profile), so a gap of a few
            points is noise.
          </p>
        </section>

        <section>
          <h2>6. Do satellite images help?</h2>
          <p>
            Google DeepMind's AlphaEarth Foundations summarises a year of satellite and aerial observations into a
            64-number fingerprint for every 10 m of the planet. Averaged over each block, it describes the city's
            physical fabric: density, greenery, roofs, water. The same hold-out test was run with these fingerprints
            added, and with them in place of the open data, over several different splits of the brands.
          </p>
          <SatelliteBenchmark />
          <p>
            The fingerprints do not improve the score. On their own, with only the nearby luxury boutiques beside them,
            they come within a few points for fashion and beauty, so they do capture what a luxury street looks like.
            But the open data already holds that signal, and 64 extra numbers mostly add noise for a model trained on a
            few hundred boutiques.
          </p>
          <p>
            Ai2's OlmoEarth was then run on 2025 Sentinel-2 images of Paris and tested the same way. It gives the same
            answer: no profile gains more than the spread between splits, and fewer held-out boutiques reach the top 10%
            of blocks. For this question, what is around a street matters more than what it looks like from space.
          </p>
        </section>

        <section>
          <h2>7. What drives the score</h2>
          <p>
            Each block's score is broken down with SHAP values, which split a prediction into the push from each fact.
            Across Paris, these facts matter most:
          </p>
          <div className="method-importance">
            {PROFILES.map((p) => (
              <div key={p.id}>
                <h3 className="label">{p.label}</h3>
                <ol>
                  {scores.importance[p.id].slice(0, 4).map(([key]) => (
                    <li key={key}>{describeValue(scores, key, null).label}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>8. What it does not know</h2>
          <ul className="method-limits">
            <li>Rents, vacant units and lease terms. The score says where to look, not what to sign.</li>
            <li>A brand's own strategy, clientele or flagship plans.</li>
            <li>Footfall on the pavement. Station entries stand in for it.</li>
            <li>
              Anything after the data dates below. Store lists come from open data and can miss or misplace a boutique.
            </li>
          </ul>
        </section>

        <footer className="muted small">
          <p>Data: {meta.sources.join(' · ')} · OpenStreetMap contributors.</p>
          <p>
            Every number on this page is computed by the open-source pipeline at{' '}
            <a href={REPO} target="_blank" rel="noreferrer">
              github.com/chipscrevette/crispy-eureka
            </a>
            . No brand affiliation is implied.
          </p>
        </footer>
      </article>
    </div>
  )
}

const RULES = [
  { key: 'model', label: 'Adresse model', shape: 'dot' },
  { key: 'luxury neighbours', label: 'Rule: next to other luxury boutiques', shape: 'ring' },
  { key: 'apartment price', label: 'Rule: highest apartment prices', shape: 'square' },
] as const

const AXIS_MIN = 50

/** Dot plot: the mean percentile reached by held-out brands' boutiques, per profile and method. */
function ValidationChart({ scores }: { scores: Scores }) {
  const x = (v: number) => `${((v - AXIS_MIN) / (100 - AXIS_MIN)) * 100}%`
  return (
    <figure className="vchart">
      <figcaption>
        <strong>Where the hidden brands' boutiques landed</strong>
        <span className="muted small"> · average percentile among blocks without a training boutique (100 = best)</span>
      </figcaption>
      <ul className="vchart-legend" aria-hidden="true">
        {RULES.map((r) => (
          <li key={r.key}>
            <span className={`mark ${r.shape}`} />
            {r.label}
          </li>
        ))}
      </ul>
      <div className="vchart-rows">
        {PROFILES.map((p) => {
          const v = scores.validation[p.id]
          return (
            <div className="vchart-row" key={p.id}>
              <span className="vchart-label">{p.label}</span>
              <div className="vchart-track">
                {[60, 70, 80, 90].map((t) => (
                  <span key={t} className="tick" style={{ left: x(t) }} />
                ))}
                {RULES.map((r) => {
                  const value = v[r.key].mean_percentile
                  return (
                    <span
                      key={r.key}
                      className={`mark ${r.shape}`}
                      style={{ left: x(value) }}
                      title={`${p.label}, ${r.label.toLowerCase()}: ${ordinal(value)} percentile on average, ${v[r.key].held_out_cells} held-out blocks`}
                    />
                  )
                })}
                <span className="vchart-value" style={{ left: x(v.model.mean_percentile) }}>
                  {Math.round(v.model.mean_percentile)}
                </span>
              </div>
            </div>
          )
        })}
        <div className="vchart-row axis" aria-hidden="true">
          <span />
          <div className="vchart-track">
            {[50, 60, 70, 80, 90, 100].map((t) => (
              <span key={t} className="axis-label" style={{ left: x(t) }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
      <table className="visually-hidden">
        <caption>Mean percentile of held-out brands' boutiques</caption>
        <thead>
          <tr>
            <th scope="col">Profile</th>
            {RULES.map((r) => (
              <th scope="col" key={r.key}>
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PROFILES.map((p) => (
            <tr key={p.id}>
              <th scope="row">{p.label}</th>
              {RULES.map((r) => (
                <td key={r.key}>{scores.validation[p.id][r.key].mean_percentile}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

type Benchmark = {
  embeddings: Record<string, string>
  seeds: number[]
  sets: Record<string, Record<string, { mean_percentile: number; min: number; max: number }>>
}

/** The satellite benchmark table, read from the file the pipeline writes. */
function SatelliteBenchmark() {
  const [data, setData] = useState<Benchmark | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/benchmark.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData, () => setFailed(true))
  }, [])
  if (failed) return <p className="muted small">The benchmark results could not be loaded.</p>
  if (!data) return <p className="muted small">Loading the benchmark…</p>
  const sets = Object.entries(data.sets)
  return (
    <figure className="vchart">
      <figcaption>
        <strong>Held-out percentile with and without satellite fingerprints</strong>
        <span className="muted small">
          {' '}
          · mean over {data.seeds.length} brand splits, range in brackets; every set also sees nearby luxury boutiques
        </span>
      </figcaption>
      <div className="bench-wrap">
        <table className="method-table bench">
          <thead>
            <tr>
              <th scope="col">Features</th>
              {PROFILES.map((p) => (
                <th scope="col" key={p.id}>
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sets.map(([name, v]) => (
              <tr key={name}>
                <th scope="row">{name[0].toUpperCase() + name.slice(1)}</th>
                {PROFILES.map((p) => {
                  const r = v[p.id]
                  return (
                    <td key={p.id}>
                      {Math.round(r.mean_percentile)}
                      <span className="muted small">
                        {' '}
                        ({Math.round(r.min)}–{Math.round(r.max)})
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Embeddings: {Object.values(data.embeddings).join('; ')}. The AlphaEarth Foundations Satellite Embedding dataset
        is produced by Google and Google DeepMind (CC-BY 4.0).
        {'OlmoEarth' in data.embeddings && ' OlmoEarth by Ai2, under the OlmoEarth Artifact License.'}
      </p>
    </figure>
  )
}
