# Adresse

**Where should a luxury brand open its next Paris boutique, and why?**

Adresse is an open-source location-intelligence studio for luxury retail. It scores every street block in Paris for a brand profile (jewellery & watches, fashion house, beauty), explains each score, compares two addresses side by side, and writes a one-page site memo. It is built only from open data.

> **Live demo: [chipscrevette.github.io/crispy-eureka](https://chipscrevette.github.io/crispy-eureka/)** (desktop and phone).
>
> Status: **Week 6 of 8.** Every one of Paris's 1,118 H3 blocks has a 0–100 opportunity score for each brand profile, with the drivers behind it. You can compare two blocks driver by driver, open a one-page site memo that prints to PDF, share any view as a link, ask Adresse ten questions whose answers show the queries behind them, and read a "How it works" page that explains the data, the model and its validation with the live numbers. Tested on brands the model never saw, their boutiques land around the 90th percentile. See the [roadmap](#roadmap).

## What it will do

- **Opportunity map:** Paris on an H3 grid (about 0.1 km² cells), coloured by a 0–100 site score.
- **Explain any block:** the top drivers behind each score, for example tourist flow, prestige neighbours, affluent residents and rent level.
- **Compare two addresses**, with walking-time catchments.
- **Site memo:** a clean one-page summary, ready for a real-estate committee.
- **Ask Adresse:** ten curated questions, answered at build time by running the project's own queries (`pipeline/src/adresse_pipeline/ask.py`). Each answer lists the queries it ran and their results, and a test checks that every number in an answer comes from one of them. No API key or hosting is needed.

## Method

There is no public data on boutique sales, so Adresse learns from where luxury brands *already chose* to open. Their existing stores are positive examples, and every other block is unlabelled. A gradient-boosted model (LightGBM) learns what those surroundings share, and SHAP explains each score. To validate, whole brands are held out and we check that their real stores rank high. 

How well it works, with brands held out (mean percentile of their boutiques among blocks with no training boutique; 100 is best):

| Profile | Model | Baseline: nearby luxury boutiques | Baseline: apartment price |
|---------|------:|------:|------:|
| Fashion house | **89** | 68 | 83 |
| Beauty | **92** | 62 | 88 |
| Jewellery & watches | 89 | **96** | 90 |

For jewellery and watches the simple baseline wins: those brands cluster so tightly around Place Vendôme and rue de la Paix that "go next to the others" is hard to beat. The app says so next to the map. Full numbers are in `pipeline/output/model_report.json`.

Satellite embeddings from Google AlphaEarth and Ai2 OlmoEarth were tested as extra features. Neither improves the score, and the result is published on the How it works page.

## Data

| Source | Used for |
|--------|----------|
| Overture Maps Places | Luxury boutiques, hotels, restaurants, culture |
| DVF (property sales, Etalab) | Price levels |
| INSEE Filosofi 200 m grid | Resident income and population |
| Île-de-France Mobilités ridership | Footfall proxy |
| AlphaEarth / OlmoEarth embeddings | Satellite benchmark: does the urban fabric seen from space add anything? (neither helps, see the How it works page) |

Licences and attribution: [DATA_LICENSES.md](DATA_LICENSES.md).

## Run it

```bash
# data pipeline
cd pipeline && pip install -e ".[dev]" && pytest
python -m adresse_pipeline.build --overture-release 2026-10-21.0
python -m adresse_pipeline.model   # scores, drivers and the validation report
python -m adresse_pipeline.alphaearth && python -m adresse_pipeline.benchmark   # satellite benchmark
# add `--skip dvf insee` if your network can't reach data.gouv.fr or insee.fr

# web app
cd web && npm ci && npm run dev
```

The basemap is OpenFreeMap Positron. To use another one, set `VITE_BASEMAP_STYLE` to a style URL, or to `blank` for no basemap.

## Roadmap

The [Build data](.github/workflows/data.yml) workflow rebuilds every layer from the original sources and commits the result.

| Week | Milestone |
|------|-----------|
| 0 | Brief, design direction, brand catalogue, boutique layer, repo and CI |
| 1–2 | All data sources on the Paris H3 grid |
| 3 | Lookalike scoring model, SHAP drivers, hold-out validation |
| 4–5 | Opportunity map, compare view, site memo |
| 6 | Ask Adresse (pre-recorded answers), AlphaEarth vs OlmoEarth benchmark |
| 7 | Mobile, accessibility, performance, demo video |
| 8 | Public v1 and case study |

## How this is built

The project follows the poteto method ([pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan): plan before code, test first, prove it works in the real app, and keep PRs small. It is developed with Claude Code, and the method is vendored in `.claude/`.

## Licence

Code: [MIT](LICENSE). Data stays under its original licences ([DATA_LICENSES.md](DATA_LICENSES.md)). Adresse is not affiliated with any brand shown on the map.
