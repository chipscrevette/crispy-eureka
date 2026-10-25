import { useEffect, useRef, useState } from 'react'
import { useDialog } from './dialog'
import type { GridMeta } from './grid'
import { describeValue, ordinal, type Scores } from './scores'
import { PROFILES, countByProfile, type Stores } from './stores'
import { fmt, lang, tr } from './i18n'

type Props = { scores: Scores; stores: Stores; meta: GridMeta; cells: number; onClose: () => void }

const REPO = 'https://github.com/chipscrevette/crispy-eureka'

/** The benchmark's feature-set names come from the pipeline in English. */
const SET_WORDS_FR: [string, string][] = [
  ['open data', 'données ouvertes'],
  ['upscale hotel rooms', 'chambres d’hôtels haut de gamme'],
  ['international tourist zones', 'zones touristiques internationales'],
  ['street footfall', 'passage piéton'],
  ['luxury neighbours', 'luxe voisin'],
  ['components', 'composantes'],
  ['dims', 'dimensions'],
]
const setName = (name: string) =>
  lang() === 'en' ? name : SET_WORDS_FR.reduce((s, [en, fr]) => s.replace(en, fr), name)

export default function Method({ scores, stores, meta, cells, onClose }: Props) {
  const page = useRef<HTMLDivElement>(null)
  useDialog(page, onClose)

  const counts = countByProfile(stores)
  const brands = new Set(stores.features.map((f) => f.properties.brand)).size
  const sizes = PROFILES.map((p) => scores.validation[p.id].model.held_out_cells)
  const heldOut = { min: Math.min(...sizes), max: Math.max(...sizes) }

  return (
    <div className="method" role="dialog" aria-modal="true" aria-labelledby="method-title" tabIndex={-1} ref={page}>
      <div className="method-bar">
        <span className="label">Adresse · {tr('Comment ça marche', 'How it works')}</span>
        <button className="button secondary" onClick={onClose}>
          {tr('Retour à la carte', 'Back to the map')}
        </button>
      </div>

      <article>
        <header>
          <p className="kicker">{tr('Comment ça marche', 'How it works')}</p>
          <h1 id="method-title">{tr('Comment Adresse note une rue', 'How Adresse scores a street')}</h1>
          <p className="lede">
            {tr(
              'Personne ne publie les ventes des boutiques. Adresse apprend donc des adresses que les marques de luxe ont déjà choisies, et note chaque bloc de Paris selon sa ressemblance avec ces choix.',
              'No one publishes boutique sales. So Adresse learns from where luxury brands have already chosen to be, and scores every block of Paris by how closely it resembles those choices.',
            )}
          </p>
          <ul className="method-glance" aria-label={tr('Adresse en bref', 'Adresse at a glance')}>
            <li>
              <span className="big">{fmt(cells)}</span>
              <span className="muted">{tr('blocs de Paris notés', 'blocks of Paris scored')}</span>
            </li>
            <li>
              <span className="big">{stores.features.length}</span>
              <span className="muted">{tr('boutiques de luxe sur rue', 'luxury street boutiques')}</span>
            </li>
            <li>
              <span className="big">{brands}</span>
              <span className="muted">{tr('marques', 'brands')}</span>
            </li>
            <li>
              <span className="big">{meta.sources.length}</span>
              <span className="muted">{tr('jeux de données ouverts', 'open datasets')}</span>
            </li>
          </ul>
        </header>

        <section>
          <h2>
            <span className="h2-n">1</span>
            {tr(`Paris en ${fmt(cells)} blocs`, `Paris as ${fmt(cells)} blocks`)}
          </h2>
          <p>
            {tr(
              'La ville est découpée en hexagones de la grille H3 au niveau 9, d’environ 0,1 km² chacun, à peu près un pâté de maisons. Chaque chiffre de l’application appartient à l’un de ces blocs : des sources très différentes se comparent ainsi à égalité.',
              'The city is cut into hexagons of the H3 grid at resolution 9, each about 0.1 km², roughly a street block. Every number in the app belongs to one of these blocks, so data from very different sources can be compared like for like.',
            )}
          </p>
        </section>

        <section>
          <h2>
            <span className="h2-n">2</span>
            {tr('Où le luxe est déjà', 'Where luxury already is')}
          </h2>
          <p>
            {tr(
              'Un catalogue de marques de luxe est rapproché des lieux d’Overture Maps, puis vérifié avec OpenStreetMap. Les corners des grands magasins sont écartés : ce ne sont pas des choix d’emplacement sur rue. Il reste ',
              'A catalogue of luxury brands is matched against Overture Maps places, then cross-checked with OpenStreetMap. Concessions inside department stores are left out, because they are not a street location choice. That leaves ',
            )}
            <strong>
              {stores.features.length} {tr('boutiques sur rue', 'street boutiques')}
            </strong>{' '}
            {tr(`de ${brands} marques :`, `from ${brands} brands:`)}
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
          <h2>
            <span className="h2-n">3</span>
            {tr('Ce que voit le modèle', 'What the model can see')}
          </h2>
          <p>
            {tr(
              'Chaque bloc est décrit par les mêmes faits, la plupart additionnés sur le bloc et ses six voisins.',
              'Each block is described by the same facts, most of them summed over the block and its six neighbours.',
            )}
          </p>
          <table className="method-table">
            <thead>
              <tr>
                <th scope="col">{tr('Fait', 'Fact')}</th>
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
          <h2>
            <span className="h2-n">4</span>
            {tr('Le modèle', 'The model')}
          </h2>
          <p>
            {tr(
              'Pour chaque profil de marque, un modèle de gradient boosting (LightGBM) apprend à distinguer les blocs qui ont une boutique de tous les autres. Les blocs sans boutique ne sont pas « mauvais », juste sans étiquette : certains sont simplement des endroits qu’aucune marque n’a encore essayés. C’est exactement ce que la note cherche. La sortie brute devient un rang : une note de 90 veut dire que le bloc ressemble plus aux adresses choisies que 90 % de Paris.',
              'For each brand profile, a gradient-boosted model (LightGBM) learns to tell the blocks that hold a boutique from all the others. The blocks without one are not “bad”, just unlabelled: some are simply places no brand has tried yet. That is exactly what the score looks for. The raw output is turned into a rank, so a score of 90 means the block resembles the chosen places more than 90% of Paris does.',
            )}
          </p>
          <p>
            {tr(
              'Un piège est évité exprès : les boutiques d’un bloc ne font jamais partie de ses propres entrées. Seules comptent les boutiques de luxe des six blocs autour, sinon le modèle apprendrait juste à trouver les réponses.',
              "One trap is avoided on purpose: a block's own boutiques are never among its inputs. Only the luxury boutiques in the six surrounding blocks count, otherwise the model would just learn to find the answers.",
            )}
          </p>
        </section>

        <section>
          <h2>
            <span className="h2-n">5</span>
            {tr('Est-ce que ça marche ?', 'Does it work?')}
          </h2>
          <p>
            {tr(
              `Le test cache des marques entières. Le modèle est entraîné ${scores.validation_setup.folds} fois, chaque fois sans un cinquième des marques, puis doit classer Paris. S’il a appris quelque chose de réel, les boutiques des marques cachées doivent arriver vers le haut. Deux règles simples sont notées de la même façon, pour montrer ce qu’apporte le modèle.`,
              `The test hides whole brands. The model is trained ${scores.validation_setup.folds} times, each time without a fifth of the brands, and then asked to rank Paris. If it has learned something real, the hidden brands' boutiques should land near the top. Two simple rules are scored the same way, to show what the model adds.`,
            )}
          </p>
          <ValidationChart scores={scores} />
          <p>
            {tr(
              `Pour la mode et la beauté, le modèle bat nettement les deux règles. Pas pour la joaillerie et l’horlogerie : ces maisons sont si groupées autour de la place Vendôme et de la rue de la Paix qu’« ouvrir à côté des autres » est très dur à battre. Les jeux de test sont petits (${heldOut.min} à ${heldOut.max} blocs par profil) : un écart de quelques points n’est que du bruit.`,
              `For fashion and beauty, the model clearly beats both rules. For jewellery and watches it does not: those houses cluster so tightly around Place Vendôme and rue de la Paix that “open next to the others” is very hard to beat. The test sets are small (${heldOut.min} to ${heldOut.max} blocks per profile), so a gap of a few points is noise.`,
            )}
          </p>
        </section>

        <section>
          <h2>
            <span className="h2-n">6</span>
            {tr('Les images satellite aident-elles ?', 'Do satellite images help?')}
          </h2>
          <p>
            {tr(
              'AlphaEarth Foundations, de Google DeepMind, résume une année d’observations satellite et aériennes en une empreinte de 64 nombres pour chaque carré de 10 m de la planète. En moyenne sur chaque bloc, elle décrit le tissu physique de la ville : densité, verdure, toits, eau. Le même test à marques cachées a été lancé avec ces empreintes en plus, puis à la place des données ouvertes, sur plusieurs découpages des marques.',
              "Google DeepMind's AlphaEarth Foundations summarises a year of satellite and aerial observations into a 64-number fingerprint for every 10 m of the planet. Averaged over each block, it describes the city's physical fabric: density, greenery, roofs, water. The same hold-out test was run with these fingerprints added, and with them in place of the open data, over several different splits of the brands.",
            )}
          </p>
          <SatelliteBenchmark />
          <p>
            {tr(
              'Les empreintes n’améliorent pas la note. Seules, avec juste les boutiques de luxe voisines, elles arrivent à quelques points pour la mode et la beauté : elles captent donc bien à quoi ressemble une rue de luxe. Mais les données ouvertes contiennent déjà ce signal, et 64 nombres de plus ajoutent surtout du bruit pour un modèle entraîné sur quelques centaines de boutiques.',
              'The fingerprints do not improve the score. On their own, with only the nearby luxury boutiques beside them, they come within a few points for fashion and beauty, so they do capture what a luxury street looks like. But the open data already holds that signal, and 64 extra numbers mostly add noise for a model trained on a few hundred boutiques.',
            )}
          </p>
          <p>
            {tr(
              'OlmoEarth, d’Ai2, a ensuite été lancé sur des images Sentinel-2 de Paris de 2025 et testé de la même façon. Même réponse : aucun profil ne gagne plus que l’écart entre découpages, et moins de boutiques cachées atteignent les 10 % de blocs les mieux notés. Pour cette question, ce qui entoure une rue compte plus que son allure vue de l’espace.',
              "Ai2's OlmoEarth was then run on 2025 Sentinel-2 images of Paris and tested the same way. It gives the same answer: no profile gains more than the spread between splits, and fewer held-out boutiques reach the top 10% of blocks. For this question, what is around a street matters more than what it looks like from space.",
            )}
          </p>
        </section>

        <section>
          <h2>
            <span className="h2-n">7</span>
            {tr('Ce qui fait la note', 'What drives the score')}
          </h2>
          <p>
            {tr(
              'La note de chaque bloc est décomposée avec des valeurs SHAP, qui répartissent une prédiction entre la poussée de chaque fait. Sur tout Paris, ces faits comptent le plus :',
              "Each block's score is broken down with SHAP values, which split a prediction into the push from each fact. Across Paris, these facts matter most:",
            )}
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
          <h2>
            <span className="h2-n">8</span>
            {tr('Ce qu’il ne sait pas', 'What it does not know')}
          </h2>
          <ul className="method-limits">
            <li>
              {tr(
                'Les loyers et les baux. La note dit où chercher, pas quoi signer.',
                'Rents, vacant units and lease terms. The score says where to look, not what to sign.',
              )}
            </li>
            <li>{tr('La stratégie propre d’une marque, sa clientèle ou ses projets de flagship.', "A brand's own strategy, clientele or flagship plans.")}</li>
            <li>
              {tr(
                'Le passage réel sur le trottoir. Il est estimé à partir du réseau de rues et des entrées en gare, pas compté.',
                'Footfall on the pavement. It is estimated from the street network and station entries, not counted.',
              )}
            </li>
            <li>
              {tr(
                'Tout ce qui suit les dates des données ci-dessous. Les listes de boutiques viennent de données ouvertes et peuvent manquer ou mal placer une boutique.',
                'Anything after the data dates below. Store lists come from open data and can miss or misplace a boutique.',
              )}
            </li>
          </ul>
        </section>

        <footer className="muted small">
          <p>
            {tr('Données : ', 'Data: ')}
            {meta.sources.join(' · ')} · {tr('contributeurs OpenStreetMap.', 'OpenStreetMap contributors.')}
          </p>
          <p>
            {tr('Chaque chiffre de cette page est calculé par le pipeline open source sur', 'Every number on this page is computed by the open-source pipeline at')}{' '}
            <a href={REPO} target="_blank" rel="noreferrer">
              github.com/chipscrevette/crispy-eureka
            </a>
            . {tr('Aucune affiliation à une marque n’est sous-entendue.', 'No brand affiliation is implied.')}
          </p>
        </footer>
      </article>
    </div>
  )
}

const RULES = [
  { key: 'model', label: tr('Modèle Adresse', 'Adresse model'), shape: 'dot' },
  { key: 'luxury neighbours', label: tr('Règle : à côté d’autres boutiques de luxe', 'Rule: next to other luxury boutiques'), shape: 'ring' },
  { key: 'apartment price', label: tr('Règle : appartements les plus chers', 'Rule: highest apartment prices'), shape: 'square' },
] as const

const AXIS_MIN = 50

/** Dot plot: the mean percentile reached by held-out brands' boutiques, per profile and method. */
function ValidationChart({ scores }: { scores: Scores }) {
  const x = (v: number) => `${((v - AXIS_MIN) / (100 - AXIS_MIN)) * 100}%`
  return (
    <figure className="vchart">
      <figcaption>
        <strong>{tr('Où arrivent les boutiques des marques cachées', "Where the hidden brands' boutiques landed")}</strong>
        <span className="muted small">
          {' '}
          ·{' '}
          {tr(
            'centile moyen parmi les blocs sans boutique d’entraînement (100 = le mieux)',
            'average percentile among blocks without a training boutique (100 = best)',
          )}
        </span>
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
                      title={tr(
                        `${p.label}, ${r.label.toLowerCase()} : ${ordinal(value)} centile en moyenne, ${v[r.key].held_out_cells} blocs cachés`,
                        `${p.label}, ${r.label.toLowerCase()}: ${ordinal(value)} percentile on average, ${v[r.key].held_out_cells} held-out blocks`,
                      )}
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
        <caption>{tr('Centile moyen des boutiques des marques cachées', "Mean percentile of held-out brands' boutiques")}</caption>
        <thead>
          <tr>
            <th scope="col">{tr('Profil', 'Profile')}</th>
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
  if (failed) return <p className="muted small">{tr('Les résultats du banc d’essai n’ont pas pu être chargés.', 'The benchmark results could not be loaded.')}</p>
  if (!data) return <p className="muted small">{tr('Chargement du banc d’essai…', 'Loading the benchmark…')}</p>
  const sets = Object.entries(data.sets)
  return (
    <figure className="vchart">
      <figcaption>
        <strong>{tr('Centile des marques cachées pour chaque jeu de données', 'Held-out percentile for each set of features')}</strong>
        <span className="muted small">
          {' '}
          ·{' '}
          {tr(
            `moyenne sur ${data.seeds.length} découpages des marques, écart entre parenthèses ; chaque jeu voit aussi les boutiques de luxe voisines`,
            `mean over ${data.seeds.length} brand splits, range in brackets; every set also sees nearby luxury boutiques`,
          )}
        </span>
      </figcaption>
      <div className="bench-wrap" tabIndex={0} role="region" aria-label={tr('Tableau du banc d’essai, défile sur le côté', 'Benchmark table, scrolls sideways')}>
        <table className="method-table bench">
          <thead>
            <tr>
              <th scope="col">{tr('Données', 'Features')}</th>
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
                <th scope="row">{setName(name)[0].toUpperCase() + setName(name).slice(1)}</th>
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
        {tr('Empreintes : ', 'Embeddings: ')}
        {Object.values(data.embeddings).join('; ')}.{' '}
        {tr(
          'Le jeu de données AlphaEarth Foundations Satellite Embedding est produit par Google et Google DeepMind (CC-BY 4.0).',
          'The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind (CC-BY 4.0).',
        )}
        {'OlmoEarth' in data.embeddings &&
          tr(' OlmoEarth par Ai2, sous licence OlmoEarth Artifact License.', ' OlmoEarth by Ai2, under the OlmoEarth Artifact License.')}
      </p>
    </figure>
  )
}
