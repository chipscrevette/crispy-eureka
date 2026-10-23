# Adresse: design direction

**Feeling:** a quiet, editorial luxury house, not a dashboard. Think of a Place Vendôme window: limestone, ink, one precious detail. The map is the hero, and everything else is calm around it.

## Principles

1. **Map first.** The map fills the screen. Panels are narrow and can be folded away.
2. **One accent.** The Seine-green accent is for data. Brass appears only on the selected place.
3. **Every number explains itself.** Hover or tap any score to see where it comes from.
4. **Phone ready.** Recruiters open LinkedIn links on a phone, so the panels become bottom sheets.
5. **Honest by design.** Show the data date and the method limits in the interface itself, not only in the README.

## Tokens (v0)

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--limestone` | `#EEF0EE` | `#0F1514` | Page and panel background |
| `--surface` | `#FFFFFF` | `#172020` | Cards, memo |
| `--ink` | `#121816` | `#E6ECEA` | Text |
| `--muted` | `#5A6866` | `#9AA9A6` | Labels, captions |
| `--seine` | `#1F5C63` | `#7FC2C6` | Accent, score ramp anchor |
| `--brass` | `#8A6A2E` | `#D3B57A` | Selected location only |

**Score ramp:** five classes of the Seine hue, from very light to deep. Low scores fade into the basemap, so only the opportunities stand out.

**Basemap:** a grey, low-contrast Protomaps style (light and dark), with labels drawn above the hexagons.

## Type

- **Display:** Newsreader (serif), for the brand name, the score number and memo headings.
- **Interface:** IBM Plex Sans.
- **Numbers and data:** IBM Plex Mono, with tabular figures.

## Key screens

1. **Explore:** the map plus a left panel (profile and weights) and a right panel (selected cell: score, drivers, nearby luxury neighbours).
2. **Compare:** two addresses side by side, with walking catchments drawn on the map and a driver-by-driver table.
3. **Site memo:** an A4-like page with a mini map, the score, its top five drivers, the catchment profile, data sources and the date.
4. **Ask Adresse:** a chat drawer. Every answer shows the queries it ran, and it can open a memo.
5. **Method:** a scroll story explaining the data, the model, the validation and its limits.

A first wireframe of the Explore screen is in the Phase 1 report.
