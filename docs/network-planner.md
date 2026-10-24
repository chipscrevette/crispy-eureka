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
| 4 | Planner | Greedy location-allocation: the k next sites that add the most net demand for a brand. | Deterministic, with tests on a toy city. |
| 5 | Validation | Hide each brand's real boutiques one at a time and measure how close the planner's picks land, against the lookalike score and nearest-luxury baselines. | Published on the method page whatever the result. |
| 6 | Planner screen | Pick a brand and a number of new boutiques, then see the sites, the gain and the cannibalisation. | Seen at 1440 px and 390 px. |

## Limits we state up front

- No real sales or footfall. Demand is an index built from open data, not euros.
- Luxury shoppers also come by car and taxi. Walking time stands for local access only.
- Boutique attractiveness is equal for every boutique, because there is no open data on store size or sales.
- Huff alone rewards empty blocks with high demand and ignores that luxury boutiques gain from clustering. The planner therefore only considers blocks that the lookalike score already rates as suitable for the profile.
