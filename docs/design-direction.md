# Adresse: design direction

**Feeling:** a quiet, editorial luxury house, not a dashboard. Think of a Place Vendôme window: limestone, ink, one precious detail. The map is the hero, and everything else is calm around it.

**v1 (2026-10-24):** the same palette, made lighter and more visual. The map fills the screen, and the interface floats above it on rounded glass cards (blurred, see-through white or dark green). A pill top bar holds the four views: Explore, Plan, Ask and Method. Key numbers sit in tiles with a large serif figure and a short plain label. The score is shown as a ring. The bottom half of Paris is not coloured, so the streets show through.

**v2 (2026-10-24), a dashboard around a modern map.** Kevin asked for something clear to anyone, not only to specialists:
- **Layout.** The map sits in a rounded card. The controls are on its left, and three chart cards below it follow the map: the best arrondissements, a spending or boutique donut, and the top blocks.
- **3D.** By default the blocks rise in 3D by class. When a block is selected, its 10-minute walk stays raised and coloured, and the rest of Paris lies flat and grey.
- **Fonts.** Two rounded sans-serifs at one weight (500): **Outfit** for titles and figures, **Nunito** for text. Hierarchy comes only from size and colour.
- **Colours.** Each layer has its own colour family:
  - potential: mint to deep blue;
  - spending: sand to wine;
  - income: greens;
  - metro and RER traffic: violets;
  - prices: blues.

  Each profile has its own boutique colour: gold for jewellery, violet for fashion, rose for beauty. The selected block is coral. Tokens are in `web/src/palette.ts` and `web/src/styles.css`.
- **Plain words.** Layers are called "Luxury potential", "Spending power", "Residents' income", "Metro & RER traffic" and "Property prices". The legend uses words ("Good", "Very good", "Excellent", "Best 5%"), and a tooltip follows the pointer.

**v4 (2026-10-24), a modern PC app.** Kevin asked for a more modern look inspired by the best tools in the field (Placer.ai, Kepler.gl, Felt, and Linear-style product apps), designed for PC first:
- **Layout.** The map fills the whole window. The top bar, the controls panel, the legend and the drawers float above it as near-opaque cards with a 1 px hairline border. There is no backdrop blur: blurring a live map costs a redraw of the blur on every frame, and the map must never lag. The map centre is shifted right of the panel.
- **Themes.** Light ("porcelain": warm white `#f6f6f3`, ink `#0f1419`, teal accent `#0f766e`) and dark ("midnight": `#0a0e13`, surfaces `#121821`, mint accent `#5eead4`). The dark theme uses the OpenFreeMap dark basemap. The visitor switches with the sun/moon button; the choice is kept in the browser, else the system setting applies.
- **Fonts.** Outfit for titles and figures, Figtree for text, both at weight 500.
- **Phone.** No longer a target (Kevin, 2026-10-24); it must only not break.

**v5 (2026-10-25), the atlas.** Kevin asked to rethink the UI from scratch: hyper-visual, minimalist, simple but complete. He sent ten references: a 3×3 site-analysis board, an exploded layer stack, hex-bin maps, a 3D spike map and a map linked to a scatter plot. Three concepts were drawn from real data (`/mnt/project-files/geoai/screens/v5-concepts/`). Kevin chose to combine them:
- **Layout.** Three columns on paper, no floating cards. The **rail** on the left asks the question and answers it: brand type, free spots or already there, the big count, the five best places and the address search, then the views (Explore, Plan, Ask, Method). The **map** sits in the middle with four key figures under it. The **panel** on the right explains: the atlas by default, the block when one is clicked, and Plan or Ask when open.
- **Atlas.** Nine small maps of Paris (potential, spending, footfall, stations, fashion shops, luxury already there, hotels, offices, shop prices), each in its own colour family and with the same classes as the big map. A click puts one on the big map. Under them, a scatter of every block (spending against potential) marks the free spots in the accent colour and blocks with luxury already in ink; a click on a dot opens that block.
- **Map.** The five best places carry numbered labels. In 3D the free spots stand up from a flat coloured city, which is concept C's idea of peaks on a ground.
- **Colour.** Paper `#f4f3ef`, ink `#16191d`, accent wine-terracotta `#b2432f` (dark: `#101317`, `#eef0f2`, `#ec986b`). Potential runs sand to wine. Every other layer has its own hue (`web/src/palette.ts`).
- **Next.** Clicking a block will show its layers stacked (concept B).

The v0 to v4 notes below are kept for history; where they differ, the latest version wins.

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
| `--glass` | `#FFFFFF` at 95% | `#121821` at 94% | Floating cards, no blur |
| `--seine-soft` | `#E3EEEE` | `#1D3234` | Tracks, bar backgrounds, notes |
| `--radius` | 20 px (cards), 12 px (tiles, inputs), pill (buttons, tabs) | | |

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
