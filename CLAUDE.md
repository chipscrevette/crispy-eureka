# Adresse

Open-source luxury retail site selection for Paris: where should a luxury brand open its next boutique, and why? Product brief: `docs/brief.md`. Design rules: `docs/design-direction.md`.

## Layout

- `pipeline/`: Python 3.11+ package `adresse_pipeline`. It turns open data into map layers and, later, the scoring model. Run `pip install -e "pipeline[dev]"`, then `pytest` and `ruff check` from `pipeline/`.
- `pipeline/data/luxury_brands.csv`: the curated brand catalogue. Each segment maps to one of three profiles (jewellery-watches, fashion-house, beauty).
- `web/`: Vite + React + TypeScript + MapLibre. Run `npm ci`, then `npm run dev`, `npm run build` and `npm run lint` from `web/`. Data layers live in `web/public/data/`.
- `.claude/skills/`, `.claude/agents/`: pstack, vendored (see below).

## How we work: the poteto method

This repo uses pstack by Lauren Tan (poteto), MIT licensed, vendored from the `backnotprop/pstack` mirror of `cursor/plugins/pstack` (v0.15.28, mirror commit e44668c). License: `.claude/skills/PSTACK-LICENSE`.

For any nontrivial task, read `.claude/skills/poteto-mode/SKILL.md` in full first and follow its playbook routing. Users can also start it with `/poteto-mode`. Its Harness section explains how the Cursor terms map to Claude Code.

These are the Adresse-specific readings of its principles:

- **Model the domain.** Brands, segments, profiles and places are typed values in `adresse_pipeline.brands`. Add a new data source as a typed reader at the boundary, never as raw dicts passed around.
- **Prove it works.** A pipeline change is done when the real layer is rebuilt and spot-checked: counts by profile, a random sample of matches, and a look at the map. A UI change is done when it has been seen in a browser at desktop and phone widths.
- **Explain the number.** Every score, count or metric shown in the UI or a LinkedIn post must trace to a script in this repo and a dated data release. Model metrics come with the validation setup that produced them (hold-out brands, not random rows).
- **Test behaviour, not implementation.** Brand matching is tested against real false-positive cases (clinics named Céline, dentists named Cartier), not against regexes.
- **Sequence verifiable units.** One data source or one screen per PR, each with its own check.
- **Experience first.** The demo is for recruiters on a phone. Never ship a screen that hasn't been looked at at 390 px width.

## Rules

- Data licences: when you add a source, add a row to `DATA_LICENSES.md` and keep the attribution in the map.
- The copilot must never state a number it did not get from a tool call on our data.
- No brand logos and no implied affiliation. Store locations come from open data only.
