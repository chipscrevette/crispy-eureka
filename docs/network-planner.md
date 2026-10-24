# Network planner

Kevin's decision on 2026-10-24: before launch, take Adresse from a lookalike map to a network planner. The question changes from "which blocks look like luxury?" to "if brand X opens here, what does it gain, and how much does it take from its own boutiques?"

Large retailers answer that question with private data: phone-location footfall panels, card spending, and their own store sales. We use the same methods on open stand-ins, and say on screen which stand-in each number comes from.

## Phases

Each phase is one PR with its own check.

| # | Phase | Output | Check |
|---|-------|--------|-------|
| 1 | Walking catchments | `walk.py`: Overture street network, walking minutes between block centres up to 20 min. The map shades the selected block's 10-minute walk. | Tests on synthetic streets: river, shortest path, islands, motorways. Spot checks: Vendôme to Opéra 8.8 min for 656 m straight, Louvre to Orsay across the Seine 12.4 min for 863 m. |
| 2 | Demand | `demand.py`: spending potential per block from three groups, each a share of the Paris total, one third each: residents (INSEE Filosofi income), workers (INSEE Sirene headcount bands, about 1.89 million in Paris) and visitors (hotels). Station entries are left out: most are commuters already counted as residents or workers. | Top blocks per group printed by the build. Sensitivity: dropping any one group keeps a rank correlation of 0.94 or more with the equal weights. |
| 3 | Huff model | `huff.py`: the probability that demand in block i walks to boutique j, decaying with walking time, against an outside option worth one boutique in the block. Capture, cannibalisation and net gain for a brand at every block. | Decay calibrated per profile: the pull halves every 2.3 to 3.5 minutes. The curve is flat near its peak (within 1.5 percentile points from 0.1 to 0.4 per minute), so the decay is only loosely pinned down. Spot check of the largest brand per profile. |
| 4 | Planner | `planner.py`: greedy location-allocation. Each step opens the block with the largest net gain given the earlier picks, among blocks with a lookalike score of 80 or more where the brand is not yet. Five steps for every brand and for a new brand, per profile, in `web/public/data/planner.json`. | Deterministic (ties go to the first block id), with tests on a toy street. |
| 5 | Validation | `backtest.py`: hide each brand in turn (same brand folds as the lookalike model, score retrained without the fold), let each method pick as many blocks as the brand really has, and count the brand's boutiques with a pick within a 5-minute walk. Equal-pull Huff with one boutique as the outside option found almost none (0 to 2%): it steers away from rivals, while real luxury boutiques cluster. Two settings fix that: a cluster pull, (1 + luxury boutiques within 5 min) ^ gamma, and a larger outside option (shoppers have many other choices, so one boutique wins a small share of each block). Both are chosen for each fold on the other folds only. | Found within 5 min, jewellery / fashion / beauty: planner 52.4 / 29.2 / 7.4%; lookalike score 20.2 / 23.4 / 14.8%; demand 23.8 / 19.3 / 14.8%; luxury neighbours 10.7 / 16.4 / 9.3%; random 0.9 / 1.0 / 1.0%. The planner beats every baseline for jewellery and fashion, and loses for beauty, where only 12 brands are tested and the chosen setting changes from fold to fold. The outside option was added after seeing the first backtest: nested selection protects the chosen values, not that design choice. |
| 6 | Planner screen | Pick a brand and a number of new boutiques, then see the sites, the gain and the cannibalisation. | Seen at 1440 px and 390 px. |

## Limits we state up front

- No real sales or footfall. Demand is an index built from open data, not euros.
- Luxury shoppers also come by car and taxi. Walking time stands for local access only.
- Boutique attractiveness is equal for every boutique, because there is no open data on store size or sales.
- Huff with equal pull rewards empty blocks with high demand and ignores that luxury boutiques gain from clustering. The planner gives boutiques in clusters more pull and only considers blocks that the lookalike score rates as suitable.
- The planner spreads its picks to avoid cannibalisation; real networks often cluster. Copying real networks is the only test open data allows. It checks that the picks are plausible, not that the gains are right: no open data can check those.
