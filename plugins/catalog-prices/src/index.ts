import { define } from "@missingstudio/eva-sdk"
import { Effect } from "effect"
import { PRICES } from "./prices.js"

export { CHECKED_AT, PRICES, SOURCE, type PriceSeed } from "./prices.js"

/**
 * The vendor's published rates, from a snapshot of models.dev this package
 * vendors. Boot does no network: a rate Eva shows is one a reader can see in
 * the diff, and `fixtures/generate.ts` takes a fresh snapshot deliberately.
 *
 * A price reaches an estimate and never a Cost. The Catalog is a Domain, so
 * nothing here is a record, and `costTicks` stays what a Provider reported.
 */
export const catalogPrices = define({
  id: "eva.catalog.prices",
  effect: Effect.fn("eva.catalog.prices")(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      for (const { provider, model: named, ...price } of PRICES) {
        // Prices what the Catalog already holds. A rate for a model nothing
        // offers would add a row no Run can reach.
        if (catalog.model.get(provider, named) === undefined) continue
        // Everything the seed says that is not the model it names is the
        // rate. Naming the fields instead dropped `reasoningTicks`, so the
        // one counter a rate exists to charge could never be charged.
        catalog.model.update(provider, named, (model) => void (model.price = price))
      }
    })
  }),
})
