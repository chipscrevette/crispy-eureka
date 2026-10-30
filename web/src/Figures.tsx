import { ordinal } from './scores'
import { PROFILES, type ProfileId } from './stores'
import { profileColour } from './palette'
import { tr } from './i18n'

type Props = {
  openCount: number
  counts: Record<ProfileId, number> | null
  profile: ProfileId
  brands: number
  /** Mean percentile of held-out brands' boutiques: the model, and the rule "next to other luxury". */
  tested?: { model: number; neighbours: number }
}

/** More free spots than this are drawn as a full row and a "+". */
const MAX_HEXES = 30

const Hex = () => (
  <svg viewBox="0 0 10 11.5" aria-hidden="true">
    <path d="M5 0 10 2.9v5.7L5 11.5 0 8.6V2.9Z" />
  </svg>
)

/** The strip under the map: each figure with a small picture of what it counts. */
export default function Figures({ openCount, counts, profile, brands, tested }: Props) {
  const total = counts ? PROFILES.reduce((s, p) => s + counts[p.id], 0) : 0
  return (
    <ul className="figures" aria-label={tr('Ce type de marque en chiffres', 'This type of brand in numbers')}>
      <li>
        <span className="figure-label">{tr('Sites avec local vide (2023)', 'Sites with an empty shop (2023)')}</span>
        <span className="figure-row">
          <span className="figure-value accent">{openCount}</span>
          <span className="figure-hexes" aria-hidden="true">
            {Array.from({ length: Math.min(openCount, MAX_HEXES) }, (_, i) => (
              <Hex key={i} />
            ))}
            {openCount > MAX_HEXES && <span className="figure-more">+</span>}
          </span>
        </span>
      </li>
      <li>
        <span className="figure-label">{tr('Boutiques aujourd’hui', 'Boutiques today')}</span>
        <span className="figure-row">
          <span className="figure-value">{counts ? counts[profile] : '–'}</span>
          {counts && (
            <span className="figure-split">
              <span className="figure-bar" aria-hidden="true">
                {PROFILES.map((p) => (
                  <span
                    key={p.id}
                    style={{
                      flexGrow: counts[p.id],
                      background: p.id === profile ? profileColour(p.id) : 'var(--quiet)',
                    }}
                  />
                ))}
              </span>
              <span className="figure-note">
                {tr(`sur ${total} · ${brands} marques`, `of ${total} · ${brands} brands`)}
              </span>
            </span>
          )}
        </span>
      </li>
      {tested && (
        <li
          title={tr(
            'Nous avons caché des marques entières au modèle ; leurs vraies boutiques arrivent quand même aussi haut en moyenne. Le rond creux : suivre simplement les autres boutiques de luxe.',
            'We hid whole brands from the model; their real boutiques still landed this high on average. The open ring: simply following other luxury boutiques.',
          )}
        >
          <span className="figure-label">{tr('Test à l’aveugle', 'Blind test')}</span>
          <span className="figure-row">
            <span className="figure-value">{ordinal(tested.model)}</span>
            <span className="figure-split">
              <span className="figure-track" aria-hidden="true">
                <span className="figure-mark hollow" style={{ left: `${tested.neighbours}%` }} />
                <span className="figure-mark" style={{ left: `${tested.model}%` }} />
              </span>
              <span className="figure-note">{tr('centile, sur 100', 'percentile, out of 100')}</span>
            </span>
          </span>
        </li>
      )}
    </ul>
  )
}
