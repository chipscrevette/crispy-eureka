# Data licences

Code in this repository is MIT. Data keeps its original licence. Each layer we publish lists its source and release.

| Source | Licence | Attribution | Status |
|--------|---------|-------------|--------|
| [Overture Maps Places](https://docs.overturemaps.org/) | CDLA-Permissive-2.0; some records ODbL (from OpenStreetMap) | "© Overture Maps Foundation" (and "© OpenStreetMap contributors" where applicable) | In use (`web/public/data/luxury_stores.geojson`) |
| [OpenFreeMap](https://openfreemap.org/) basemap | OpenStreetMap data under ODbL | "© OpenMapTiles © OpenStreetMap contributors" (shown by the style) | In use |
| DVF, Demandes de valeurs foncières (DGFiP / Etalab) | Licence Ouverte 2.0 | "DGFiP, DVF" | In use, 2021–2025 (`web/public/data/paris_h3.geojson`) |
| INSEE Filosofi, 200 m grid | Licence Ouverte 2.0 | "INSEE, Filosofi" | In use, Filosofi 2021 (`web/public/data/paris_h3.geojson`) |
| Île-de-France Mobilités rail validations (Q4 2025) and station locations | Licence Ouverte 2.0 (via data.gouv.fr) | "Île-de-France Mobilités" | In use (`transit_entries_r2`) |
| OpenStreetMap shops (Overpass API) | ODbL | "© OpenStreetMap contributors" | In use, cross-check only (`pipeline/output/boutique_crosscheck.json`) |
| Google AlphaEarth Foundations satellite embeddings (annual 2025, public GCS bucket) | CC-BY 4.0 | "The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind." | In use: satellite benchmark (`pipeline/output/alphaearth_2025.csv`) |
| Ai2 OlmoEarth models | OlmoEarth Artifact License: no military, surveillance, policing or extractive use; cite Ai2; pass these restrictions on to anyone using our derivatives | "Ai2 OlmoEarth" | Planned (Week 6) |
| Brand catalogue (`pipeline/data/luxury_brands.csv`) | Our own curation; Wikidata IDs are CC0 | None | In use |
