# Adresse: project brief

**Question we answer:** where should a luxury brand open its next Paris boutique, and why?

**Audience:** store-network and retail-excellence teams at luxury houses, prime-retail brokers, and location-intelligence recruiters who will look at the repo and the demo.

**Owner:** Kevin (product owner). Tech lead: Claude.

## MVP (public v1, 8 weeks)

1. Opportunity map of Paris on an H3 grid (resolution 9, about 0.1 km² per cell), coloured by a 0–100 site score.
2. Three brand profiles: jewellery & watches, fashion house, beauty. Weights can be adjusted.
3. Click a cell to see its top score drivers (SHAP).
4. Compare two addresses, with walking-time catchments.
5. One-page site memo for an address.
6. "Ask Adresse" copilot: answers questions by calling our own queries, and cites every number.
7. Methodology page and a public notebook.

Out of scope for v1: other cities, change radar, cannibalization between a brand's own stores, accounts, private data upload.

## Method in one paragraph

We have no sales data, so we learn from where luxury brands already chose to be. Existing luxury stores are positive examples, all other cells are unlabelled (positive-unlabelled learning). A LightGBM model learns what the surroundings of those stores have in common, and the score shows "lookalike" cells. We validate by holding out whole brands and checking that their real stores rank high. Satellite embeddings (AlphaEarth, then OlmoEarth) are tested as extra features, and we publish whether they help.

## Week 0 facts we already checked

- **Overture Maps (release 2026-10-21.0)** has 315,635 places in the Paris bounding box. It is readable straight from its public S3 bucket, and the extraction takes about 8 seconds (`pipeline/src/adresse_pipeline/overture.py`).
- Our list of 74 luxury brands (`pipeline/data/luxury_brands.csv`) matches **394 store-type places across 72 brands** in Paris, which become **382 boutiques** after removing duplicates within 40 m. That is enough positive examples for the model.
- **Data-quality warning:** Overture rarely has a brand Wikidata ID for these brands (only 7 of 74 do). Matching by name alone also catches false hits, like clinics run by someone named "Céline", or "Cartier" dental offices. We keep only shop categories, and the pipeline must also deduplicate stores and remove department-store concessions. OpenStreetMap `brand:wikidata` tags should be added in Week 1 to cross-check.
- The DuckDB extensions server is blocked from the build container, so the pipeline uses PyArrow for S3 reads. On a normal laptop, DuckDB works fine.

## Decision log

| # | Decision | Why | Date |
|---|----------|-----|------|
| 1 | Build concept A, "Adresse" | Best fit for luxury and retail recruiters, and the most distinctive | 2026-10-23 |
| 2 | Paris first | Rich French open data (DVF, INSEE, IGN), and close to Kevin's market | 2026-10-23 |
| 3 | Do not fork pstack; use its working method | It is AI-coding tooling, not geo code | 2026-10-23 |
| 4 | H3 resolution 9 as the analysis grid | Street-block scale, light enough for the browser | 2026-10-23 |
| 5 | Static PMTiles + small API, no paid map keys | Free live demo, fully open source | 2026-10-23 |
| 6 | Code under MIT; data licences listed per source in `DATA_LICENSES.md` | Open source, and respects ODbL and CC-BY attribution | 2026-10-23 |

## Open questions for Kevin

- Name: keep "Adresse"? (Short, French, luxury feel. Check the GitHub and domain name before launch.)
- Should the three brand profiles stay as they are, or do you want another one (for example leather goods or eyewear)?
