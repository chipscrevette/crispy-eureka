# Data licences

Code in this repository is MIT. Data keeps its original licence. Each layer we publish lists its source and release.

| Source | Licence | Attribution | Status |
|--------|---------|-------------|--------|
| [Overture Maps Places](https://docs.overturemaps.org/) | CDLA-Permissive-2.0; some records ODbL (from OpenStreetMap) | "© Overture Maps Foundation" (and "© OpenStreetMap contributors" where applicable) | In use (`web/public/data/luxury_stores.geojson`) |
| [OpenFreeMap](https://openfreemap.org/) basemap | OpenStreetMap data under ODbL | "© OpenMapTiles © OpenStreetMap contributors" (shown by the style) | In use |
| DVF, Demandes de valeurs foncières (DGFiP / Etalab) | Licence Ouverte 2.0 | "DGFiP, DVF" | In use, 2021–2025 (`web/public/data/paris_h3.geojson`) |
| INSEE Filosofi, 200 m grid | Licence Ouverte 2.0 | "INSEE, Filosofi" | In use, Filosofi 2021 (`web/public/data/paris_h3.geojson`) |
| Île-de-France Mobilités rail validations (Q4 2025) and station locations | Licence Ouverte 2.0 (via data.gouv.fr) | "Île-de-France Mobilités" | In use (`transit_entries_r2`) |
| Overture Maps transportation segments (release 2026-10-21.0), walking network | ODbL (derived from OpenStreetMap) | "© OpenStreetMap contributors, Overture Maps Foundation" | In use: walking catchments (`pipeline/output/walk_times.parquet`, `web/public/data/catchments.json`) |
| INSEE Sirene, monthly establishment stock (Parquet, via data.gouv.fr), Paris rows | Licence Ouverte 2.0 | "INSEE, Sirene" | In use: workers per block in the demand index (`pipeline/output/demand.csv`, `web/public/data/demand.json`) |
| Base Adresse Nationale, via the IGN Géoplateforme geocoder (`data.geopf.fr/geocodage`) | Licence Ouverte 2.0 | "BAN (IGN)" | In use: address search, called from the visitor's browser; nothing is stored |
| OpenStreetMap shops (Overpass API) | ODbL | "© OpenStreetMap contributors" | In use, cross-check only (`pipeline/output/boutique_crosscheck.json`) |
| Google AlphaEarth Foundations satellite embeddings (annual 2025, public GCS bucket) | CC-BY 4.0 | "The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind." | In use: satellite benchmark (`pipeline/output/alphaearth_2025.csv`) |
| Ai2 OlmoEarth models | OlmoEarth Artifact License: no military, surveillance, policing or extractive use; cite Ai2; pass these restrictions on to anyone using our derivatives | "OlmoEarth by Ai2" | In use: satellite benchmark (`pipeline/output/olmoearth_2025.csv`); the restrictions apply to that file |
| Copernicus Sentinel-2 L2A (2025, via Microsoft Planetary Computer) | Copernicus open data licence | "Contains modified Copernicus Sentinel data 2025" | In use: input to OlmoEarth only, images are not redistributed |
| [APUR BDCOM 2023](https://opendata.apur.org/datasets/Apur::bdcom-2023), census of Paris ground-floor units and its tourist-zone perimeters | ODbL 1.0 | "Apur, BDCOM 2023" | In use: empty shops and international tourist zones per block (`vacant_shops_r1`, `vacancy_r1`, `large_vacant_r1`, `tourist_zone_r1` in `web/public/data/paris_h3.geojson`); those derived columns are shared under ODbL |
| [Atout France, classified tourist accommodation](https://www.data.gouv.fr/fr/datasets/59c36c6a88ee3826d5998a35/) (hotels of tourism in Paris, 4 and 5 stars), placed with the BAN batch geocoder (`data.geopf.fr/geocodage/search/csv`) | Licence Ouverte 2.0 (both) | "Atout France" · "BAN (IGN)" | In use: `upscale_rooms_r1`, a model feature (`web/public/data/paris_h3.geojson`) |
| Brand catalogue (`pipeline/data/luxury_brands.csv`) | Our own curation; Wikidata IDs are CC0 | None | In use |
