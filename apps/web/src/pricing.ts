import { estimateTicks, type CostSummary } from "@missingstudio/eva-schema"
import type { PickRow } from "./eva.js"

/**
 * What a Session cost, when nobody reported what it cost.
 *
 * A Provider's own figure is the only thing that is ever a Cost. Most Runs
 * report none — the counters arrive and the money does not — and a page that
 * showed `cost unreported` and stopped there left a reader with two numbers
 * they could not turn into the third, while the rate to do it with was on the
 * same page, in the picker.
 *
 * So the rate is applied here. The Catalog is the one place a rate comes from:
 * it feeds the picker's rows and it feeds this, over one wire, so what a model
 * costs has one answer on this side. Nothing here invents a rate for a model
 * the Catalog does not price, and nothing here is ever written to the Trace.
 *
 * The estimate goes in `estimatedCostTicks` and never in `costTicks`, which is
 * what keeps `spendOf` drawing it as `~$0.0012 est` rather than as a bill. A
 * figure Eva worked out is never shown as one a Provider gave.
 */
export const priced = (
  cost: CostSummary,
  rows: readonly PickRow[],
  chosen: string | undefined,
): CostSummary => {
  // A reported figure is the answer. Pricing over the top of one would be a
  // second answer to a question the Provider already settled.
  if (cost.costTicks !== null) return cost

  const price = rows.find((row) => row.id === chosen)?.price
  if (price === undefined) return cost

  const ticks = estimateTicks(cost, price)
  // Counters nobody reported price to nothing, and nothing is not an estimate
  // of zero — it is the same silence the page started with.
  return ticks === 0 ? cost : { ...cost, estimatedCostTicks: ticks }
}
