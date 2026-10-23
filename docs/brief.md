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
- Our list of 74 luxury brands (`pipeline/data/luxury_brands.csv`) matches **394 store-type places across 72 brands** in Paris, which become **382 boutiques** after removing duplicates within 40 m.
- **Week 2 cross-check:** OpenStreetMap confirmed only 142 of those 382. Of the 241 it did not confirm, 90 sat inside Galeries Lafayette, Printemps, Le Bon Marché, La Samaritaine or BHV, because Overture puts concessions at the store's address. With concessions left out, the layer holds **290 street boutiques**: 158 fashion house, 80 jewellery & watches, 52 beauty. OSM confirms 139 of them within 75 m, and OSM has 50 more catalogue boutiques that Overture misses. That is still enough positive examples for the model.
- **Data-quality warning:** Overture rarely has a brand Wikidata ID for these brands (only 7 of 74 do). Matching by name alone also catches false hits, like clinics run by someone named "Céline", or "Cartier" dental offices. We keep only shop categories, and the pipeline must also deduplicate stores and remove department-store concessions. OpenStreetMap `brand:wikidata` tags should be added in Week 1 to cross-check.
- The DuckDB extensions server is blocked from the build container, so the pipeline uses PyArrow for S3 reads. On a normal laptop, DuckDB works fine.

## Week 3: what the model learned

- One LightGBM model per profile, trained on 16 block features plus "luxury neighbours" (catalogue boutiques in the six surrounding blocks, never the block itself, so the label does not leak in).
- **Validation:** five folds, each holding out a fifth of the brands. The held-out brands' OSM-confirmed boutique blocks are ranked among all blocks with no training boutique.
  - Fashion house: model 89th percentile on average, nearby-luxury baseline 68th, apartment-price baseline 83rd (20 held-out blocks).
  - Beauty: model 92nd, baselines 62nd and 88th (12 blocks).
  - Jewellery & watches: model 89th, but the nearby-luxury baseline reaches 96th (15 blocks). The baseline wins here, and we show that in the app.
- Training on OSM-confirmed boutiques only, on Overture boutiques, or on Overture plus OSM gives the same average (89.8 to 89.9). The difference is noise, so we keep Overture: it has the most examples and does not depend on OSM coverage.
- Strongest drivers across Paris (mean |SHAP|): fashion stores nearby for all three profiles, then culture (jewellery), offices and dining (fashion), and resident living standard (beauty).
- The held-out sets are small (12 to 20 blocks), so treat differences of a few points as noise.

## Decision log

| # | Decision | Why | Date |
|---|----------|-----|------|
| 1 | Build concept A, "Adresse" | Best fit for luxury and retail recruiters, and the most distinctive | 2026-10-23 |
| 2 | Paris first | Rich French open data (DVF, INSEE, IGN), and close to Kevin's market | 2026-10-23 |
| 3 | Do not fork pstack; use its working method | It is AI-coding tooling, not geo code | 2026-10-23 |
| 4 | H3 resolution 9 as the analysis grid | Street-block scale, light enough for the browser | 2026-10-23 |
| 5 | Static PMTiles + small API, no paid map keys | Free live demo, fully open source | 2026-10-23 |
| 6 | Code under MIT; data licences listed per source in `DATA_LICENSES.md` | Open source, and respects ODbL and CC-BY attribution | 2026-10-23 |
| 7 | Leave department-store concessions out of the boutique layer | They are not street location choices, and they made up most of the boutiques OSM could not confirm | 2026-10-23 |
| 8 | Use station entries (IDFM, Q4 2025) as the footfall proxy | No open pedestrian counts exist for Paris; rail entries are measured, daily and citywide | 2026-10-23 |
| 9 | Show the score as a percentile within Paris (0–100), not a probability | Positive-unlabelled models are not calibrated; a rank is honest and easy to read | 2026-10-23 |
| 10 | Train on Overture boutiques (not OSM-confirmed only) | Same held-out accuracy, more examples | 2026-10-23 |
| 11 | Publish the baseline comparison in the app, including where it wins | "Honest by design"; a recruiter trusts a model that shows its limits | 2026-10-23 |
| 12 | Build the site memo in the browser and print it with the system dialog | No server, no PDF library; one A4 page, and every view is a shareable link (`#profile=…&a=…&memo=1`) | 2026-10-23 |

## Open questions for Kevin

- Name: keep "Adresse"? (Short, French, luxury feel. Check the GitHub and domain name before launch.)
- Should the three brand profiles stay as they are, or do you want another one (for example leather goods or eyewear)?
