# Network planner

Kevin's decision on 2026-10-24: before launch, take Adresse from a lookalike map to a network planner. The question changes from "which blocks look like luxury?" to "if brand X opens here, what does it gain, and how much does it take from its own boutiques?"

Large retailers answer that question with private data: phone-location footfall panels, card spending, and their own store sales. We use the same methods on open stand-ins, and say on screen which stand-in each number comes from.

## Phases

Each phase is one PR with its own check.

| # | Phase | Output | Check |
|---|-------|--------|-------|
| 1 | Walking catchments | `walk.py`: Overture street network, walking minutes between block centres up to 20 min. The map shades the selected block's 10-minute walk. | Tests on synthetic streets: river, shortest path, islands, motorways. Spot checks: Vendôme to Opéra 8.8 min for 656 m straight, Louvre to Orsay across the Seine 12.4 min for 863 m. |
| 2 | Demand | Spending potential per block from three groups: residents (INSEE income × population), workers (office places) and visitors (hotels, station entries). | The weights are written down and the sensitivity is shown. Spot check of the top blocks per group. |
| 3 | Huff model | The probability that demand in block i walks to boutique j, decaying with walking time. Capture and cannibalisation for a brand at a candidate block. | Decay calibrated against where the existing boutiques are, then a spot check of one brand. |
| 4 | Planner | Greedy location-allocation: the k next sites that add the most net demand for a brand. | Deterministic, with tests on a toy city. |
| 5 | Validation | Hide each brand's real boutiques one at a time and measure how close the planner's picks land, against the lookalike score and nearest-luxury baselines. | Published on the method page whatever the result. |
| 6 | Planner screen | Pick a brand and a number of new boutiques, then see the sites, the gain and the cannibalisation. | Seen at 1440 px and 390 px. |

## Limits we state up front

- No real sales or footfall. Demand is an index built from open data, not euros.
- Luxury shoppers also come by car and taxi. Walking time stands for local access only.
- Boutique attractiveness is equal for every boutique, because there is no open data on store size or sales.
